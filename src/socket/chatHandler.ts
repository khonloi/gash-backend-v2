import { Server } from 'socket.io';
import { AuthenticatedSocket } from './socketAuth.js';
import {
  chatService,
  assertConversationAccess,
} from '../services/chatService.js';
import { Conversation } from '../models/Conversation.js';
import { logger } from '../config/logger.js';
import { ChatActor } from '../types/index.js';
import { AppError } from '../utils/AppError.js';
import {
  socketHandoffSchema,
  socketSendMessageSchema,
  socketTypingSchema,
} from '../validations/chatValidation.js';
import { idParamSchema } from '../validations/commonValidation.js';
import {
  emitToConversationParticipants,
  emitToSupportAgents,
} from './index.js';

const SOCKET_MSG_WINDOW_MS = 10_000;
const SOCKET_MSG_MAX_PER_WINDOW = 20;

function toSafeSocketError(err: unknown, fallbackMessage: string): string {
  if (err instanceof AppError) {
    return err.message;
  }
  return fallbackMessage;
}

export const registerChatHandlers = (
  io: Server,
  socket: AuthenticatedSocket
): void => {
  const actor: ChatActor = {
    userId: socket.data.userId,
    guestId: socket.data.guestId,
    role: socket.data.role,
  };

  // Per-socket sliding-window rate limiter for chat:send_message
  const sendTimestamps: number[] = [];
  const checkSocketRateLimit = (): boolean => {
    const now = Date.now();
    while (
      sendTimestamps.length > 0 &&
      now - sendTimestamps[0] > SOCKET_MSG_WINDOW_MS
    ) {
      sendTimestamps.shift();
    }
    if (sendTimestamps.length >= SOCKET_MSG_MAX_PER_WINDOW) {
      return false;
    }
    sendTimestamps.push(now);
    return true;
  };

  // Staff join support agents room
  if (socket.data.role === 'admin' || socket.data.role === 'seller') {
    void socket.join('support:agents');
  }

  // Auto-join actor room and bounded active conversations
  if (socket.data.userId) {
    void socket.join(`user:${socket.data.userId}`);
    Conversation.find({
      user: socket.data.userId,
      status: { $in: ['bot_active', 'queued', 'assigned'] },
    })
      .sort({ lastMessageAt: -1 })
      .limit(50)
      .select('_id')
      .lean()
      .then((convs) => {
        if (!socket.connected) return;
        for (const c of convs) {
          void socket.join(`conversation:${String(c._id)}`);
        }
      })
      .catch((err) => {
        logger.warn('Failed to auto-join user conversation rooms:', err);
      });
  } else if (socket.data.guestId) {
    void socket.join(`guest:${socket.data.guestId}`);
    Conversation.find({
      guestId: socket.data.guestId,
      status: { $in: ['bot_active', 'queued', 'assigned'] },
    })
      .sort({ lastMessageAt: -1 })
      .limit(50)
      .select('_id')
      .lean()
      .then((convs) => {
        if (!socket.connected) return;
        for (const c of convs) {
          void socket.join(`conversation:${String(c._id)}`);
        }
      })
      .catch((err) => {
        logger.warn('Failed to auto-join guest conversation rooms:', err);
      });
  }

  // Join a conversation room
  socket.on(
    'chat:join',
    async (
      payload: unknown,
      callback?: (res: { success: boolean; error?: string }) => void
    ) => {
      try {
        const parsed = idParamSchema.safeParse({
          id: (payload as { conversationId?: unknown } | null)?.conversationId,
        });
        if (!parsed.success) {
          callback?.({ success: false, error: 'Invalid conversationId' });
          return;
        }
        const conversationId = parsed.data.id;

        const conversation = await Conversation.findById(conversationId);
        if (!conversation) {
          callback?.({ success: false, error: 'Conversation not found' });
          return;
        }

        assertConversationAccess(conversation, actor);
        await socket.join(`conversation:${conversationId}`);
        callback?.({ success: true });
      } catch (err: unknown) {
        callback?.({
          success: false,
          error: toSafeSocketError(err, 'Failed to join conversation'),
        });
      }
    }
  );

  // Leave a conversation room
  socket.on('chat:leave', (payload: unknown) => {
    const parsed = idParamSchema.safeParse({
      id: (payload as { conversationId?: unknown } | null)?.conversationId,
    });
    if (parsed.success) {
      void socket.leave(`conversation:${parsed.data.id}`);
    }
  });

  // Send message over WebSocket (single unified AI reply path)
  socket.on(
    'chat:send_message',
    async (
      payload: unknown,
      callback?: (res: {
        success: boolean;
        data?: unknown;
        error?: string;
      }) => void
    ) => {
      try {
        if (!checkSocketRateLimit()) {
          callback?.({
            success: false,
            error: 'Rate limit exceeded. Please slow down.',
          });
          return;
        }

        const parsed = socketSendMessageSchema.safeParse(payload);
        if (!parsed.success) {
          const errorMsg = parsed.error.issues[0]?.message || 'Invalid payload';
          callback?.({ success: false, error: errorMsg });
          return;
        }

        const { conversationId, content, contextCards } = parsed.data;

        const result = await chatService.sendMessage(
          actor,
          conversationId,
          { content, contextCards },
          {
            onAiStart: () => {
              io.to(`conversation:${conversationId}`).emit('chat:ai_typing', {
                conversationId,
                isTyping: true,
              });
            },
            onChunk: (chunk) => {
              io.to(`conversation:${conversationId}`).emit('chat:ai_chunk', {
                conversationId,
                chunk,
              });
            },
            onAiEnd: () => {
              io.to(`conversation:${conversationId}`).emit('chat:ai_typing', {
                conversationId,
                isTyping: false,
              });
            },
          }
        );

        emitToConversationParticipants(result.conversation, 'chat:message', {
          conversationId,
          message: result.message,
        });

        if (result.aiReply) {
          emitToConversationParticipants(result.conversation, 'chat:message', {
            conversationId,
            message: result.aiReply,
          });
        }

        if (result.escalated) {
          emitToConversationParticipants(
            result.conversation,
            'chat:handoff_occurred',
            {
              conversationId,
              status: result.conversation.status,
              mode: result.conversation.mode,
              reason: result.conversation.handoffReason,
            }
          );
          if (result.systemMessage) {
            emitToConversationParticipants(
              result.conversation,
              'chat:message',
              {
                conversationId,
                message: result.systemMessage,
              }
            );
          }
        }

        if (result.conversation.status !== 'bot_active') {
          emitToSupportAgents('support:queue_updated', {
            conversationId,
            mode: result.conversation.mode,
            status: result.conversation.status,
          });
        }

        callback?.({
          success: true,
          data: {
            message: result.message,
            ...(result.aiReply ? { aiReply: result.aiReply } : {}),
          },
        });
      } catch (err: unknown) {
        logger.error('Error handling chat:send_message socket event:', err);
        callback?.({
          success: false,
          error: toSafeSocketError(err, 'Failed to send message'),
        });
      }
    }
  );

  // Live typing indicator (strictly guarded by room membership + Zod schema)
  socket.on('chat:typing', (payload: unknown) => {
    const parsed = socketTypingSchema.safeParse(payload);
    if (!parsed.success) return;

    const room = `conversation:${parsed.data.conversationId}`;
    if (!socket.rooms.has(room)) return;

    socket.to(room).emit('chat:typing', {
      conversationId: parsed.data.conversationId,
      senderRole: socket.data.role,
      isTyping: parsed.data.isTyping,
    });
  });

  // Mark conversation read
  socket.on('chat:mark_read', async (payload: unknown) => {
    try {
      const parsed = idParamSchema.safeParse({
        id: (payload as { conversationId?: unknown } | null)?.conversationId,
      });
      if (!parsed.success) return;

      const conversationId = parsed.data.id;
      await chatService.markConversationRead(actor, conversationId);
      io.to(`conversation:${conversationId}`).emit('chat:read_receipt', {
        conversationId,
        readerRole: socket.data.role,
      });
    } catch (err) {
      logger.warn('Error marking conversation read via socket:', err);
    }
  });

  // Request handoff
  socket.on(
    'chat:handoff',
    async (
      payload: unknown,
      callback?: (res: { success: boolean; error?: string }) => void
    ) => {
      try {
        const parsed = socketHandoffSchema.safeParse(payload);
        if (!parsed.success) {
          callback?.({ success: false, error: 'Invalid conversationId' });
          return;
        }

        const { conversationId, reason } = parsed.data;
        const { conversation, systemMessage } =
          await chatService.requestHandoff(actor, conversationId, reason);

        emitToConversationParticipants(conversation, 'chat:handoff_occurred', {
          conversationId,
          status: conversation.status,
          mode: conversation.mode,
          reason: conversation.handoffReason,
        });
        emitToConversationParticipants(conversation, 'chat:message', {
          conversationId,
          message: systemMessage,
        });
        emitToSupportAgents('support:queue_updated', {
          conversationId,
          mode: conversation.mode,
          status: conversation.status,
          handoffReason: conversation.handoffReason,
        });

        callback?.({ success: true });
      } catch (err: unknown) {
        callback?.({
          success: false,
          error: toSafeSocketError(err, 'Failed to request handoff'),
        });
      }
    }
  );
};
