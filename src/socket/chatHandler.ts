import { Server } from 'socket.io';
import { AuthenticatedSocket } from './socketAuth.js';
import {
  chatService,
  assertConversationAccess,
} from '../services/chatService.js';
import { Conversation } from '../models/Conversation.js';
import { aiChatService } from '../services/aiChatService.js';
import { logger } from '../config/logger.js';
import { ChatActor } from '../types/index.js';
import { isValidObjectId } from '../utils/objectId.js';

export const registerChatHandlers = (
  io: Server,
  socket: AuthenticatedSocket
) => {
  const actor: ChatActor = {
    userId: socket.data.userId,
    guestId: socket.data.guestId,
    role: socket.data.role,
  };

  // If user is admin or seller, join the support agents broadcast room
  if (socket.data.role === 'admin' || socket.data.role === 'seller') {
    socket.join('support:agents');
  }

  // Automatically join actor-specific rooms so events reach customer/guest even before explicit chat:join
  if (socket.data.userId) {
    socket.join(`user:${socket.data.userId}`);
    Conversation.find({ user: socket.data.userId })
      .select('_id')
      .lean()
      .then((convs) => {
        convs.forEach((c) => socket.join(`conversation:${String(c._id)}`));
      })
      .catch(() => {});
  } else if (socket.data.guestId) {
    socket.join(`guest:${socket.data.guestId}`);
    Conversation.find({ guestId: socket.data.guestId })
      .select('_id')
      .lean()
      .then((convs) => {
        convs.forEach((c) => socket.join(`conversation:${String(c._id)}`));
      })
      .catch(() => {});
  }

  // Join a conversation room
  socket.on(
    'chat:join',
    async (
      payload: { conversationId: string },
      callback?: (res: { success: boolean; error?: string }) => void
    ) => {
      try {
        const { conversationId } = payload;
        if (!conversationId || !isValidObjectId(conversationId)) {
          if (callback)
            callback({ success: false, error: 'Invalid conversationId' });
          return;
        }

        const conversation = await Conversation.findById(conversationId);
        if (!conversation) {
          if (callback)
            callback({ success: false, error: 'Conversation not found' });
          return;
        }

        assertConversationAccess(conversation, actor);

        socket.join(`conversation:${conversationId}`);
        if (callback) callback({ success: true });
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : 'Failed to join conversation';
        if (callback) callback({ success: false, error: message });
      }
    }
  );

  // Leave a conversation room
  socket.on('chat:leave', (payload: { conversationId: string }) => {
    if (payload?.conversationId) {
      socket.leave(`conversation:${payload.conversationId}`);
    }
  });

  // Send message over WebSocket
  socket.on(
    'chat:send_message',
    async (
      payload: {
        conversationId: string;
        content: string;
        contextCards?: Array<{
          cardType: 'product' | 'order';
          productId?: string;
          orderId?: string;
          note?: string;
        }>;
      },
      callback?: (res: {
        success: boolean;
        data?: unknown;
        error?: string;
      }) => void
    ) => {
      try {
        const { conversationId, content, contextCards } = payload;
        if (!content || !content.trim()) {
          if (callback)
            callback({ success: false, error: 'Message cannot be empty' });
          return;
        }

        const conversation = await Conversation.findById(conversationId);
        if (!conversation) {
          if (callback)
            callback({ success: false, error: 'Conversation not found' });
          return;
        }

        assertConversationAccess(conversation, actor);

        // Send message
        const result = await chatService.sendMessage(actor, conversationId, {
          content,
          contextCards,
        });

        // Broadcast user message to room and support agents
        io.to(`conversation:${conversationId}`).emit('chat:message', {
          conversationId,
          message: result.message,
        });
        io.to('support:agents').emit('chat:message', {
          conversationId,
          message: result.message,
        });
        io.to('support:agents').emit('support:queue_updated', {
          conversationId,
          mode: conversation.mode,
          status: conversation.status,
        });

        // If conversation is bot_active and sender is customer/guest, stream AI response
        if (
          conversation.mode === 'ai' &&
          conversation.status === 'bot_active' &&
          socket.data.role !== 'admin' &&
          socket.data.role !== 'seller'
        ) {
          io.to(`conversation:${conversationId}`).emit('chat:ai_typing', {
            conversationId,
            isTyping: true,
          });

          const onChunk = (chunk: string) => {
            io.to(`conversation:${conversationId}`).emit('chat:ai_chunk', {
              conversationId,
              chunk,
            });
          };

          const aiReply = await aiChatService.generateReply(
            conversation,
            result.message,
            actor,
            onChunk
          );

          io.to(`conversation:${conversationId}`).emit('chat:ai_typing', {
            conversationId,
            isTyping: false,
          });

          if (aiReply) {
            io.to(`conversation:${conversationId}`).emit('chat:message', {
              conversationId,
              message: aiReply,
            });
          }
        }

        if (callback) callback({ success: true, data: result });
      } catch (err: unknown) {
        logger.error('Error handling chat:send_message socket event:', err);
        const message =
          err instanceof Error ? err.message : 'Failed to send message';
        if (callback) callback({ success: false, error: message });
      }
    }
  );

  // Live typing indicator
  socket.on(
    'chat:typing',
    (payload: { conversationId: string; isTyping: boolean }) => {
      if (payload?.conversationId) {
        socket
          .to(`conversation:${payload.conversationId}`)
          .emit('chat:typing', {
            conversationId: payload.conversationId,
            senderRole: socket.data.role,
            isTyping: Boolean(payload.isTyping),
          });
      }
    }
  );

  // Mark conversation read
  socket.on('chat:mark_read', async (payload: { conversationId: string }) => {
    try {
      if (!payload?.conversationId) return;
      await chatService.markConversationRead(actor, payload.conversationId);
      io.to(`conversation:${payload.conversationId}`).emit(
        'chat:read_receipt',
        {
          conversationId: payload.conversationId,
          readerRole: socket.data.role,
        }
      );
    } catch (err) {
      logger.warn('Error marking conversation read via socket:', err);
    }
  });

  // Request handoff
  socket.on(
    'chat:handoff',
    async (
      payload: { conversationId: string; reason?: string },
      callback?: (res: { success: boolean; error?: string }) => void
    ) => {
      try {
        if (!payload?.conversationId) {
          if (callback)
            callback({ success: false, error: 'Invalid conversationId' });
          return;
        }

        const conversation = await chatService.requestHandoff(
          actor,
          payload.conversationId,
          payload.reason
        );

        io.to(`conversation:${payload.conversationId}`).emit(
          'chat:handoff_occurred',
          {
            conversationId: payload.conversationId,
            status: conversation.status,
            mode: conversation.mode,
            reason: conversation.handoffReason,
          }
        );

        // Notify all online support agents
        io.to('support:agents').emit('support:queue_updated', {
          conversationId: payload.conversationId,
          mode: conversation.mode,
          status: conversation.status,
        });

        if (callback) callback({ success: true });
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : 'Failed to request handoff';
        if (callback) callback({ success: false, error: message });
      }
    }
  );
};
