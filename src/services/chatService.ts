import mongoose from 'mongoose';
import { Conversation } from '../models/Conversation.js';
import { Message } from '../models/Message.js';
import { Product } from '../models/Product.js';
import { Order } from '../models/Order.js';
import {
  IConversation,
  IMessage,
  IChatContextCard,
  ChatActor,
  ConversationStatus,
  IUser,
  PaginatedResult,
} from '../types/index.js';
import {
  CHAT_PRODUCT_PROJECTION,
  CHAT_ORDER_PROJECTION,
  CHAT_USER_PROJECTION,
  VALID_CONVERSATION_STATUS_TRANSITIONS,
} from '../config/constants.js';
import { AppError } from '../utils/AppError.js';
import { assertObjectId, isValidObjectId } from '../utils/objectId.js';
import {
  ChatContextCardInput,
  CreateConversationInput,
  SendMessageInput,
  ConversationQueryInput,
} from '../validations/chatValidation.js';
import { aiChatService } from './aiChatService.js';

export function assertValidActor(actor: ChatActor): void {
  if (!actor.userId && !actor.guestId) {
    throw new AppError('Authentication or Guest ID is required', 401);
  }
}

export function assertConversationAccess(
  conversation: IConversation,
  actor: ChatActor
): void {
  if (actor.role === 'admin' || actor.role === 'seller') {
    return;
  }
  if (
    actor.userId &&
    conversation.user &&
    conversation.user.toString() === actor.userId
  ) {
    return;
  }
  if (actor.guestId && conversation.guestId === actor.guestId) {
    return;
  }
  throw new AppError('You do not have access to this conversation', 403);
}

export class ChatService {
  /**
   * Resolves and verifies Product and Order context cards.
   */
  async resolveContextCards(
    actor: ChatActor,
    cardsInput?: ChatContextCardInput[]
  ): Promise<IChatContextCard[]> {
    if (!cardsInput || cardsInput.length === 0) return [];

    const resolved: IChatContextCard[] = [];

    for (const card of cardsInput) {
      if (card.cardType === 'product' && card.productId) {
        if (!isValidObjectId(card.productId)) continue;
        const product = await Product.findById(card.productId).select('_id');
        if (product) {
          resolved.push({
            cardType: 'product',
            product: product._id,
            note: card.note,
          });
        }
      } else if (card.cardType === 'order' && card.orderId) {
        let order;
        const isId = /^[0-9a-fA-F]{24}$/.test(card.orderId);
        if (isId) {
          order = await Order.findById(card.orderId);
        } else {
          order = await Order.findOne({
            orderNumber: card.orderId.toUpperCase(),
          });
        }

        if (order) {
          // Verify order access: Admin/seller can reference any order; customer/guest must own it
          const isAgent = actor.role === 'admin' || actor.role === 'seller';
          const isOwner =
            actor.userId &&
            order.user &&
            order.user.toString() === actor.userId;

          if (isAgent || isOwner) {
            resolved.push({
              cardType: 'order',
              order: order._id,
              note: card.note,
            });
          }
        }
      }
    }

    return resolved;
  }

  /**
   * Starts a new conversation or retrieves an existing open one.
   */
  async createOrGetConversation(
    actor: ChatActor,
    input: CreateConversationInput
  ): Promise<{ conversation: IConversation; initialMessage?: IMessage }> {
    assertValidActor(actor);

    // Look for an existing open conversation for this actor if mode matches
    const baseQuery: Record<string, unknown> = {
      mode: input.mode,
      status: { $in: ['bot_active', 'queued', 'assigned'] },
    };

    if (actor.userId) {
      baseQuery.user = actor.userId;
    } else {
      baseQuery.guestId = actor.guestId;
    }

    let conversation = await Conversation.findOne(baseQuery);

    if (!conversation) {
      conversation = await Conversation.create({
        user: actor.userId ? actor.userId : undefined,
        guestId: !actor.userId ? actor.guestId : undefined,
        mode: input.mode,
        status: input.mode === 'ai' ? 'bot_active' : 'queued',
        subject: input.subject,
        unreadCountCustomer: 0,
        unreadCountAgent: 0,
      });
    }

    let initialMessage: IMessage | undefined;

    if (input.initialMessage) {
      const resolvedCards = await this.resolveContextCards(
        actor,
        input.contextCards
      );

      const senderType = actor.userId ? 'customer' : 'guest';

      initialMessage = await Message.create({
        conversation: conversation._id,
        senderType,
        senderUser: actor.userId || undefined,
        content: input.initialMessage,
        contextCards: resolvedCards,
      });

      conversation.lastMessageAt = new Date();
      conversation.lastMessagePreview = input.initialMessage.slice(0, 150);
      conversation.unreadCountAgent += 1;
      await conversation.save();

      // If in AI mode, trigger AI reply
      if (conversation.mode === 'ai') {
        const aiReply = await aiChatService.generateReply(
          conversation,
          initialMessage,
          actor
        );
        if (aiReply) {
          conversation.lastMessageAt = new Date();
          conversation.lastMessagePreview = aiReply.content.slice(0, 150);
          conversation.unreadCountCustomer += 1;
          await conversation.save();
        }
      }
    }

    await conversation.populate([
      { path: 'user', select: CHAT_USER_PROJECTION },
      { path: 'assignedAgent', select: CHAT_USER_PROJECTION },
    ]);

    return { conversation, initialMessage };
  }

  /**
   * Lists conversations for the current actor or support queue.
   */
  async getConversations(
    actor: ChatActor,
    query: ConversationQueryInput
  ): Promise<PaginatedResult<IConversation>> {
    assertValidActor(actor);

    const filter: Record<string, unknown> = {};

    if (actor.role === 'admin' || actor.role === 'seller') {
      if (query.status) {
        filter.status = query.status;
      } else {
        filter.status = { $ne: 'closed' };
      }
      if (query.mode) filter.mode = query.mode;
      if (query.assignedAgent) filter.assignedAgent = query.assignedAgent;
    } else {
      // Customer or Guest can only view their own
      if (actor.userId) {
        filter.user = actor.userId;
      } else {
        filter.guestId = actor.guestId;
      }
      if (query.status) filter.status = query.status;
      if (query.mode) filter.mode = query.mode;
    }

    const page = query.page || 1;
    const limit = query.limit || 30;
    const skip = (page - 1) * limit;

    const [conversations, totalResults] = await Promise.all([
      Conversation.find(filter)
        .populate('user', CHAT_USER_PROJECTION)
        .populate('assignedAgent', CHAT_USER_PROJECTION)
        .sort({ lastMessageAt: -1, updatedAt: -1 })
        .skip(skip)
        .limit(limit),
      Conversation.countDocuments(filter),
    ]);

    return {
      data: conversations,
      page,
      limit,
      totalPages: Math.ceil(totalResults / limit) || 1,
      totalResults,
    };
  }

  /**
   * Retrieves single conversation metadata.
   */
  async getConversationById(
    actor: ChatActor,
    conversationId: string
  ): Promise<IConversation> {
    assertValidActor(actor);
    assertObjectId(conversationId, 'conversation ID');

    const conversation = await Conversation.findById(conversationId)
      .populate('user', CHAT_USER_PROJECTION)
      .populate('assignedAgent', CHAT_USER_PROJECTION);

    if (!conversation) {
      throw new AppError('Conversation not found', 404);
    }

    assertConversationAccess(conversation, actor);
    return conversation;
  }

  /**
   * Retrieves paginated messages for a conversation.
   */
  async getMessages(
    actor: ChatActor,
    conversationId: string,
    page = 1,
    limit = 30
  ): Promise<PaginatedResult<IMessage>> {
    assertValidActor(actor);
    assertObjectId(conversationId, 'conversation ID');

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      throw new AppError('Conversation not found', 404);
    }

    assertConversationAccess(conversation, actor);

    const skip = (page - 1) * limit;

    const [messages, totalResults] = await Promise.all([
      Message.find({ conversation: conversationId })
        .populate('contextCards.product', CHAT_PRODUCT_PROJECTION)
        .populate('contextCards.order', CHAT_ORDER_PROJECTION)
        .populate('senderUser', CHAT_USER_PROJECTION)
        .sort({ createdAt: 1 })
        .skip(skip)
        .limit(limit),
      Message.countDocuments({ conversation: conversationId }),
    ]);

    return {
      data: messages,
      page,
      limit,
      totalPages: Math.ceil(totalResults / limit) || 1,
      totalResults,
    };
  }

  /**
   * Sends a message in a conversation and optionally handles AI response.
   */
  async sendMessage(
    actor: ChatActor,
    conversationId: string,
    input: SendMessageInput
  ): Promise<{ message: IMessage; aiReply?: IMessage }> {
    assertValidActor(actor);
    assertObjectId(conversationId, 'conversation ID');

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      throw new AppError('Conversation not found', 404);
    }

    assertConversationAccess(conversation, actor);

    if (conversation.status === 'closed') {
      throw new AppError(
        'This conversation has been closed. Please create a new conversation.',
        400
      );
    }

    const isStaff = actor.role === 'admin' || actor.role === 'seller';
    if (isStaff && conversation.status === 'bot_active') {
      throw new AppError(
        'Staff cannot message customers until they request human support.',
        400
      );
    }

    const resolvedCards = await this.resolveContextCards(
      actor,
      input.contextCards
    );

    let senderType: IMessage['senderType'] = 'guest';
    if (actor.role === 'admin' || actor.role === 'seller') {
      senderType = 'agent';
    } else if (actor.userId) {
      senderType = 'customer';
    }

    const message = await Message.create({
      conversation: conversation._id,
      senderType,
      senderUser: actor.userId || undefined,
      content: input.content,
      contextCards: resolvedCards,
    });

    // Populate the newly created message for return
    await message.populate([
      { path: 'contextCards.product', select: CHAT_PRODUCT_PROJECTION },
      { path: 'contextCards.order', select: CHAT_ORDER_PROJECTION },
      { path: 'senderUser', select: CHAT_USER_PROJECTION },
    ]);

    conversation.lastMessageAt = new Date();
    conversation.lastMessagePreview = input.content.slice(0, 150);

    if (senderType === 'agent') {
      conversation.unreadCountCustomer += 1;
    } else {
      conversation.unreadCountAgent += 1;
    }

    await conversation.save();

    let aiReply: IMessage | undefined;

    // Trigger AI response if conversation is currently in bot_active mode
    if (
      conversation.mode === 'ai' &&
      conversation.status === 'bot_active' &&
      (senderType === 'customer' || senderType === 'guest')
    ) {
      aiReply = await aiChatService.generateReply(conversation, message, actor);

      if (aiReply) {
        conversation.lastMessageAt = new Date();
        conversation.lastMessagePreview = aiReply.content.slice(0, 150);
        conversation.unreadCountCustomer += 1;
        await conversation.save();
      }
    }

    return { message, aiReply };
  }

  /**
   * Escalates an AI conversation to live human support.
   */
  async requestHandoff(
    actor: ChatActor,
    conversationId: string,
    reason?: string
  ): Promise<IConversation> {
    assertValidActor(actor);
    assertObjectId(conversationId, 'conversation ID');

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      throw new AppError('Conversation not found', 404);
    }

    assertConversationAccess(conversation, actor);

    conversation.mode = 'support';
    conversation.status = 'queued';
    if (reason) conversation.handoffReason = reason;

    // Insert system message about handoff
    const handoffText = reason
      ? `Conversation escalated to live support. Reason: ${reason}`
      : 'Conversation escalated to live support queue.';

    await Message.create({
      conversation: conversation._id,
      senderType: 'system',
      content: handoffText,
    });

    conversation.lastMessageAt = new Date();
    conversation.lastMessagePreview = handoffText.slice(0, 150);
    conversation.unreadCountAgent += 1;
    await conversation.save();

    await conversation.populate([
      { path: 'user', select: CHAT_USER_PROJECTION },
      { path: 'assignedAgent', select: CHAT_USER_PROJECTION },
    ]);

    return conversation;
  }

  /**
   * Assigns an agent or seller to a queued conversation.
   */
  async assignConversation(
    agentUser: IUser,
    conversationId: string
  ): Promise<IConversation> {
    assertObjectId(conversationId, 'conversation ID');

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      throw new AppError('Conversation not found', 404);
    }

    if (
      conversation.status === 'bot_active' ||
      conversation.status === 'closed'
    ) {
      throw new AppError(
        'Only conversations requesting human support can be claimed.',
        400
      );
    }

    conversation.assignedAgent = agentUser._id as mongoose.Types.ObjectId;
    conversation.status = 'assigned';
    conversation.mode = 'support';

    const assignText = `Conversation assigned to agent ${agentUser.firstName} ${agentUser.lastName}.`;
    await Message.create({
      conversation: conversation._id,
      senderType: 'system',
      content: assignText,
    });

    conversation.lastMessageAt = new Date();
    conversation.lastMessagePreview = assignText;
    await conversation.save();

    await conversation.populate([
      { path: 'user', select: CHAT_USER_PROJECTION },
      { path: 'assignedAgent', select: CHAT_USER_PROJECTION },
    ]);

    return conversation;
  }

  /**
   * Updates conversation status with validation against permitted transitions.
   */
  async updateConversationStatus(
    actor: ChatActor,
    conversationId: string,
    newStatus: ConversationStatus
  ): Promise<IConversation> {
    assertObjectId(conversationId, 'conversation ID');
    assertValidActor(actor);

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      throw new AppError('Conversation not found', 404);
    }

    assertConversationAccess(conversation, actor);

    const isStaff = actor.role === 'admin' || actor.role === 'seller';
    if (isStaff && conversation.status === 'bot_active') {
      throw new AppError(
        'Cannot change status of an AI conversation before human support is requested.',
        400
      );
    }

    const allowedTransitions =
      VALID_CONVERSATION_STATUS_TRANSITIONS[conversation.status] || [];

    if (!allowedTransitions.includes(newStatus)) {
      throw new AppError(
        `Invalid status transition from '${conversation.status}' to '${newStatus}'`,
        400
      );
    }

    conversation.status = newStatus;
    if (newStatus === 'closed' || newStatus === 'resolved') {
      conversation.closedAt = new Date();
    }

    const statusText = `Conversation status updated to '${newStatus}'.`;
    await Message.create({
      conversation: conversation._id,
      senderType: 'system',
      content: statusText,
    });

    conversation.lastMessageAt = new Date();
    conversation.lastMessagePreview = statusText;
    await conversation.save();

    await conversation.populate([
      { path: 'user', select: CHAT_USER_PROJECTION },
      { path: 'assignedAgent', select: CHAT_USER_PROJECTION },
    ]);

    return conversation;
  }

  /**
   * Marks unread messages in conversation as read and resets unread counters.
   */
  async markConversationRead(
    actor: ChatActor,
    conversationId: string
  ): Promise<void> {
    assertValidActor(actor);
    assertObjectId(conversationId, 'conversation ID');

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      throw new AppError('Conversation not found', 404);
    }

    assertConversationAccess(conversation, actor);

    const isAgent = actor.role === 'admin' || actor.role === 'seller';

    if (isAgent) {
      await Message.updateMany(
        {
          conversation: conversationId,
          senderType: { $in: ['customer', 'guest'] },
          isRead: false,
        },
        { $set: { isRead: true, readAt: new Date() } }
      );
      conversation.unreadCountAgent = 0;
    } else {
      await Message.updateMany(
        {
          conversation: conversationId,
          senderType: { $in: ['agent', 'ai', 'system'] },
          isRead: false,
        },
        { $set: { isRead: true, readAt: new Date() } }
      );
      conversation.unreadCountCustomer = 0;
    }

    await conversation.save();
  }

  /**
   * Merges all guest conversations into an authenticated user account upon sign-in.
   */
  async mergeGuestConversations(
    userId: string,
    guestId: string
  ): Promise<number> {
    assertObjectId(userId, 'user ID');
    if (!guestId) return 0;

    const guestConversations = await Conversation.find({
      guestId,
      user: { $in: [null, undefined] },
    });

    if (guestConversations.length === 0) return 0;

    const conversationIds = guestConversations.map((c) => c._id);

    // Update conversation ownership
    await Conversation.updateMany(
      { _id: { $in: conversationIds } },
      {
        $set: { user: userId },
        $unset: { guestId: 1 },
      }
    );

    // Upgrade guest messages in those conversations to customer
    await Message.updateMany(
      {
        conversation: { $in: conversationIds },
        senderType: 'guest',
      },
      {
        $set: {
          senderType: 'customer',
          senderUser: userId,
        },
      }
    );

    return guestConversations.length;
  }
}

export const chatService = new ChatService();
