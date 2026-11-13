import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync.js';
import { chatService } from '../services/chatService.js';
import { sendSuccess, sendPaginated } from '../utils/response.js';
import { ChatActor, IConversation } from '../types/index.js';
import { ConversationQueryInput } from '../validations/chatValidation.js';
import {
  emitToConversation,
  emitToConversationParticipants,
  emitToSupportAgents,
} from '../socket/index.js';
import { Message } from '../models/Message.js';
import { Conversation } from '../models/Conversation.js';
import { CHAT_USER_PROJECTION } from '../config/constants.js';

async function emitLatestSystemMessage(
  conversation:
    IConversation | { _id: unknown; user?: unknown; guestId?: string | null }
): Promise<void> {
  const conversationId = String(conversation._id);
  const sysMsg = await Message.findOne({
    conversation: conversationId,
    senderType: 'system',
  })
    .sort({ createdAt: -1 })
    .populate('senderUser', CHAT_USER_PROJECTION);

  if (sysMsg) {
    const payload = { conversationId, message: sysMsg };
    emitToConversationParticipants(conversation, 'chat:message', payload);
  }
}

export function extractChatActor(req: Request): ChatActor {
  if (req.user) {
    return {
      userId: String(req.user._id),
      role: req.user.role,
    };
  }

  const guestIdHeader = req.headers['x-guest-id'];
  const guestId = Array.isArray(guestIdHeader)
    ? guestIdHeader[0]
    : (guestIdHeader as string | undefined);

  return {
    guestId: guestId?.trim(),
    role: 'guest',
  };
}

export const createConversation = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const actor = extractChatActor(req);
    const result = await chatService.createOrGetConversation(actor, req.body);

    if (result.initialMessage) {
      const convId = String(result.conversation._id);
      emitToSupportAgents('chat:message', {
        conversationId: convId,
        message: result.initialMessage,
      });
      emitToSupportAgents('support:queue_updated', {
        conversationId: convId,
        status: result.conversation.status,
        mode: result.conversation.mode,
      });
    }

    sendSuccess(res, result, 201);
  }
);

export const getConversations = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const actor = extractChatActor(req);
    const query = req.query as unknown as ConversationQueryInput;
    const result = await chatService.getConversations(actor, query);
    sendPaginated(res, 'conversations', result, 200);
  }
);

export const getConversation = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const actor = extractChatActor(req);
    const conversation = await chatService.getConversationById(
      actor,
      req.params.id as string
    );
    sendSuccess(res, { conversation }, 200);
  }
);

export const getMessages = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const actor = extractChatActor(req);
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 30;
    const result = await chatService.getMessages(
      actor,
      req.params.id as string,
      page,
      limit
    );
    sendPaginated(res, 'messages', result, 200);
  }
);

export const sendMessage = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const actor = extractChatActor(req);
    const conversationId = req.params.id as string;
    const result = await chatService.sendMessage(
      actor,
      conversationId,
      req.body
    );

    const conversation = await Conversation.findById(conversationId).select(
      'user guestId status mode'
    );

    // Broadcast messages to Socket room, customer room, and online support agents
    const msgPayload = {
      conversationId,
      message: result.message,
    };
    if (conversation) {
      emitToConversationParticipants(conversation, 'chat:message', msgPayload);
    } else {
      emitToConversation(conversationId, 'chat:message', msgPayload);
      emitToSupportAgents('chat:message', msgPayload);
    }
    emitToSupportAgents('support:queue_updated', {
      conversationId,
    });

    if (result.aiReply) {
      const aiPayload = {
        conversationId,
        message: result.aiReply,
      };
      if (conversation) {
        emitToConversationParticipants(conversation, 'chat:message', aiPayload);
      } else {
        emitToConversation(conversationId, 'chat:message', aiPayload);
        emitToSupportAgents('chat:message', aiPayload);
      }
    }

    sendSuccess(res, result, 201);
  }
);

export const requestHandoff = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const actor = extractChatActor(req);
    const conversationId = req.params.id as string;
    const conversation = await chatService.requestHandoff(
      actor,
      conversationId,
      req.body.reason
    );

    emitToConversationParticipants(conversation, 'chat:handoff_occurred', {
      conversationId,
      status: conversation.status,
      mode: conversation.mode,
      reason: conversation.handoffReason,
    });
    await emitLatestSystemMessage(conversation);
    emitToSupportAgents('support:queue_updated', {
      conversationId,
      status: conversation.status,
      mode: conversation.mode,
      handoffReason: conversation.handoffReason,
    });

    sendSuccess(res, { conversation }, 200);
  }
);

export const assignConversation = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const conversationId = req.params.id as string;
    const conversation = await chatService.assignConversation(
      req.user!,
      conversationId
    );

    const assignedAgent = {
      _id: String(req.user!._id),
      firstName: req.user!.firstName,
      lastName: req.user!.lastName,
      email: req.user!.email,
      role: req.user!.role,
      avatar: req.user!.avatar,
    };

    emitToConversationParticipants(conversation, 'chat:assigned', {
      conversationId,
      status: conversation.status,
      mode: conversation.mode,
      assignedAgent,
    });
    await emitLatestSystemMessage(conversation);
    emitToSupportAgents('support:queue_updated', {
      conversationId,
      status: conversation.status,
      mode: conversation.mode,
      assignedAgent,
    });

    sendSuccess(res, { conversation }, 200);
  }
);

export const updateConversationStatus = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const actor = extractChatActor(req);
    const conversationId = req.params.id as string;
    const conversation = await chatService.updateConversationStatus(
      actor,
      conversationId,
      req.body.status
    );

    emitToConversationParticipants(conversation, 'chat:status_updated', {
      conversationId,
      status: conversation.status,
      mode: conversation.mode,
    });
    await emitLatestSystemMessage(conversation);
    emitToSupportAgents('support:queue_updated', {
      conversationId,
      status: conversation.status,
      mode: conversation.mode,
    });

    sendSuccess(res, { conversation }, 200);
  }
);

export const markConversationRead = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const actor = extractChatActor(req);
    const conversationId = req.params.id as string;
    await chatService.markConversationRead(actor, conversationId);

    emitToConversation(conversationId, 'chat:read_receipt', {
      conversationId,
      readerRole: actor.role,
    });

    sendSuccess(res, { message: 'Conversation marked as read' }, 200);
  }
);

export const mergeGuestChat = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const mergedCount = await chatService.mergeGuestConversations(
      String(req.user!._id),
      req.body.guestId
    );
    sendSuccess(res, { mergedConversations: mergedCount }, 200);
  }
);
