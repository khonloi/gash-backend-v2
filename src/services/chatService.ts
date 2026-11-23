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
  DEFAULT_CHAT_PAGE_LIMIT,
  VALID_CONVERSATION_STATUS_TRANSITIONS,
} from '../config/constants.js';
import { AppError } from '../utils/AppError.js';
import { assertObjectId, isValidObjectId } from '../utils/objectId.js';
import { resolveOwnerId } from '../utils/resolveOwnerId.js';
import {
  ChatContextCardInput,
  CreateConversationInput,
  SendMessageInput,
  ConversationQueryInput,
} from '../validations/chatValidation.js';
import { aiChatService, AiStreamCallback } from './aiChatService.js';

export function assertValidActor(actor: ChatActor): void {
  if (!actor.userId && !actor.guestId) {
    throw new AppError('Authentication or valid guest token is required', 401);
  }
}

export function assertConversationAccess(
  conversation: IConversation,
  actor: ChatActor
): void {
  if (actor.role === 'admin') {
    return;
  }
  if (actor.role === 'seller') {
    if (conversation.status === 'bot_active') {
      throw new AppError(
        'Sellers cannot access active AI assistant conversations',
        403
      );
    }
    return;
  }
  const ownerUserId = resolveOwnerId(conversation.user);
  if (actor.userId && ownerUserId && ownerUserId === actor.userId) {
    return;
  }
  if (actor.guestId && conversation.guestId === actor.guestId) {
    return;
  }
  throw new AppError('You do not have access to this conversation', 403);
}

export interface SendMessageOptions {
  onChunk?: AiStreamCallback;
  onAiStart?: () => void;
  onAiEnd?: () => void;
}

export class ChatService {
  /**
   * Batch-resolves and verifies Product and Order context cards in at most two queries.
   */
  async resolveContextCards(
    actor: ChatActor,
    cardsInput?: ChatContextCardInput[]
  ): Promise<IChatContextCard[]> {
    if (!cardsInput || cardsInput.length === 0) return [];

    const productIds = Array.from(
      new Set(
        cardsInput
          .filter((c) => c.cardType === 'product' && c.productId)
          .map((c) => c.productId!)
          .filter((id) => isValidObjectId(id))
      )
    );

    const orderObjectIds: string[] = [];
    const orderNumbers: string[] = [];
    for (const c of cardsInput) {
      if (c.cardType === 'order' && c.orderId) {
        if (/^[0-9a-fA-F]{24}$/.test(c.orderId)) {
          orderObjectIds.push(c.orderId);
        } else {
          orderNumbers.push(c.orderId.toUpperCase());
        }
      }
    }

    const [products, orders] = await Promise.all([
      productIds.length > 0
        ? Product.find({ _id: { $in: productIds }, status: 'active' })
            .select('_id')
            .lean()
        : Promise.resolve([]),
      orderObjectIds.length > 0 || orderNumbers.length > 0
        ? Order.find({
            $or: [
              ...(orderObjectIds.length > 0
                ? [{ _id: { $in: orderObjectIds } }]
                : []),
              ...(orderNumbers.length > 0
                ? [{ orderNumber: { $in: orderNumbers } }]
                : []),
            ],
          })
            .select('_id user orderNumber')
            .lean()
        : Promise.resolve([]),
    ]);

    const productMap = new Map(products.map((p) => [p._id.toString(), p._id]));
    const orderByIdMap = new Map(orders.map((o) => [o._id.toString(), o]));
    const orderByNumMap = new Map(orders.map((o) => [o.orderNumber, o]));

    const resolved: IChatContextCard[] = [];

    for (const card of cardsInput) {
      if (card.cardType === 'product' && card.productId) {
        const pid = productMap.get(card.productId);
        if (pid) {
          resolved.push({
            cardType: 'product',
            product: pid,
            note: card.note,
          });
        }
      } else if (card.cardType === 'order' && card.orderId) {
        const order = /^[0-9a-fA-F]{24}$/.test(card.orderId)
          ? orderByIdMap.get(card.orderId)
          : orderByNumMap.get(card.orderId.toUpperCase());

        if (order) {
          const isAdmin = actor.role === 'admin';
          const orderOwnerId = resolveOwnerId(order.user);
          const isOwner = Boolean(
            actor.userId && orderOwnerId === actor.userId
          );

          if (isAdmin || isOwner) {
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
  ): Promise<{
    conversation: IConversation;
    initialMessage?: IMessage;
    aiReply?: IMessage;
    escalated?: boolean;
    systemMessage?: IMessage;
  }> {
    assertValidActor(actor);

    const baseQuery: Record<string, unknown> = {
      mode: input.mode,
      status: { $in: ['bot_active', 'queued', 'assigned'] },
      ...(actor.userId ? { user: actor.userId } : { guestId: actor.guestId }),
    };

    let conversation = await Conversation.findOne(baseQuery);

    if (!conversation) {
      try {
        conversation = await Conversation.create({
          user: actor.userId ? actor.userId : undefined,
          guestId: !actor.userId ? actor.guestId : undefined,
          mode: input.mode,
          status: input.mode === 'ai' ? 'bot_active' : 'queued',
          subject: input.subject,
          unreadCountCustomer: 0,
          unreadCountAgent: 0,
        });
      } catch (err: unknown) {
        // Recover from concurrent creation hitting the partial unique index
        if ((err as { code?: number })?.code === 11000) {
          conversation = await Conversation.findOne(baseQuery);
        } else {
          throw err;
        }
      }
    }

    if (!conversation) {
      throw new AppError('Failed to initialize conversation', 500);
    }

    let initialMessage: IMessage | undefined;
    let aiReply: IMessage | undefined;
    let escalated = false;
    let systemMessage: IMessage | undefined;

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

      await initialMessage.populate([
        { path: 'contextCards.product', select: CHAT_PRODUCT_PROJECTION },
        { path: 'contextCards.order', select: CHAT_ORDER_PROJECTION },
        { path: 'senderUser', select: CHAT_USER_PROJECTION },
      ]);

      const shouldIncrementAgent =
        conversation.mode !== 'ai' && conversation.status !== 'bot_active';

      await Conversation.updateOne(
        { _id: conversation._id },
        {
          $set: {
            lastMessageAt: new Date(),
            lastMessagePreview: input.initialMessage.slice(0, 150),
          },
          ...(shouldIncrementAgent ? { $inc: { unreadCountAgent: 1 } } : {}),
        }
      );

      if (conversation.mode === 'ai' && conversation.status === 'bot_active') {
        const aiResult = await aiChatService.generateReply(
          conversation,
          initialMessage,
          actor
        );
        if (aiResult) {
          aiReply = aiResult.aiMessage;
          escalated = aiResult.escalated;
          systemMessage = aiResult.systemMessage;
          await Conversation.updateOne(
            { _id: conversation._id },
            {
              $set: {
                lastMessageAt: new Date(),
                lastMessagePreview: aiReply.content.slice(0, 150),
              },
              $inc: { unreadCountCustomer: 1 },
            }
          );
        }
      }
    }

    const populatedConversation = await Conversation.findById(conversation._id)
      .populate('user', CHAT_USER_PROJECTION)
      .populate('assignedAgent', CHAT_USER_PROJECTION);

    return {
      conversation: populatedConversation ?? conversation,
      initialMessage,
      aiReply,
      escalated,
      systemMessage,
    };
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
      if (actor.role === 'seller' && !query.status) {
        filter.status = { $nin: ['closed', 'bot_active'] };
      }
      if (query.mode) filter.mode = query.mode;
      if (query.assignedAgent) filter.assignedAgent = query.assignedAgent;
    } else {
      if (actor.userId) {
        filter.user = actor.userId;
      } else {
        filter.guestId = actor.guestId;
      }
      if (query.status) filter.status = query.status;
      if (query.mode) filter.mode = query.mode;
    }

    const page = query.page || 1;
    const limit = query.limit || DEFAULT_CHAT_PAGE_LIMIT;
    const skip = (page - 1) * limit;

    let sortObj: Record<string, 1 | -1> = { lastMessageAt: -1, updatedAt: -1 };
    if (query.sort) {
      const allowedSorts = new Set([
        'lastMessageAt',
        'updatedAt',
        'createdAt',
        'status',
      ]);
      const field = query.sort.startsWith('-')
        ? query.sort.slice(1)
        : query.sort;
      if (allowedSorts.has(field)) {
        sortObj = { [field]: query.sort.startsWith('-') ? -1 : 1 };
      }
    }

    const [conversations, totalResults] = await Promise.all([
      Conversation.find(filter)
        .populate('user', CHAT_USER_PROJECTION)
        .populate('assignedAgent', CHAT_USER_PROJECTION)
        .sort(sortObj)
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
    limit = DEFAULT_CHAT_PAGE_LIMIT
  ): Promise<PaginatedResult<IMessage>> {
    assertValidActor(actor);
    assertObjectId(conversationId, 'conversation ID');

    const conversation = await Conversation.findById(conversationId)
      .select('user guestId status assignedAgent')
      .lean();
    if (!conversation) {
      throw new AppError('Conversation not found', 404);
    }

    assertConversationAccess(conversation as IConversation, actor);

    const safePage = Math.max(1, Math.floor(page));
    const safeLimit = Math.min(100, Math.max(1, Math.floor(limit)));
    const skip = (safePage - 1) * safeLimit;

    const [messages, totalResults] = await Promise.all([
      Message.find({ conversation: conversationId })
        .populate('contextCards.product', CHAT_PRODUCT_PROJECTION)
        .populate('contextCards.order', CHAT_ORDER_PROJECTION)
        .populate('senderUser', CHAT_USER_PROJECTION)
        .sort({ createdAt: 1 })
        .skip(skip)
        .limit(safeLimit),
      Message.countDocuments({ conversation: conversationId }),
    ]);

    return {
      data: messages,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.ceil(totalResults / safeLimit) || 1,
      totalResults,
    };
  }

  /**
   * Sends a message in a conversation and handles AI reply in a single unified path.
   */
  async sendMessage(
    actor: ChatActor,
    conversationId: string,
    input: SendMessageInput,
    options?: SendMessageOptions
  ): Promise<{
    conversation: IConversation;
    message: IMessage;
    aiReply?: IMessage;
    escalated?: boolean;
    systemMessage?: IMessage;
  }> {
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
    if (isStaff) {
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

    await message.populate([
      { path: 'contextCards.product', select: CHAT_PRODUCT_PROJECTION },
      { path: 'contextCards.order', select: CHAT_ORDER_PROJECTION },
      { path: 'senderUser', select: CHAT_USER_PROJECTION },
    ]);

    const shouldIncrementAgent =
      senderType !== 'agent' &&
      conversation.mode !== 'ai' &&
      conversation.status !== 'bot_active';

    await Conversation.updateOne(
      { _id: conversation._id },
      {
        $set: {
          lastMessageAt: new Date(),
          lastMessagePreview: input.content.slice(0, 150),
        },
        ...(senderType === 'agent'
          ? { $inc: { unreadCountCustomer: 1 } }
          : shouldIncrementAgent
            ? { $inc: { unreadCountAgent: 1 } }
            : {}),
      }
    );

    let aiReply: IMessage | undefined;
    let escalated = false;
    let systemMessage: IMessage | undefined;

    if (
      conversation.mode === 'ai' &&
      conversation.status === 'bot_active' &&
      (senderType === 'customer' || senderType === 'guest')
    ) {
      options?.onAiStart?.();
      try {
        const aiResult = await aiChatService.generateReply(
          conversation,
          message,
          actor,
          options?.onChunk
        );

        if (aiResult) {
          aiReply = aiResult.aiMessage;
          escalated = aiResult.escalated;
          systemMessage = aiResult.systemMessage;

          await Conversation.updateOne(
            { _id: conversation._id },
            {
              $set: {
                lastMessageAt: new Date(),
                lastMessagePreview: aiReply.content.slice(0, 150),
              },
              $inc: { unreadCountCustomer: 1 },
            }
          );
        }
      } finally {
        options?.onAiEnd?.();
      }
    }

    const latestConv =
      (await Conversation.findById(conversation._id).select(
        'user guestId status mode handoffReason assignedAgent'
      )) ?? conversation;

    return {
      conversation: latestConv,
      message,
      aiReply,
      escalated,
      systemMessage,
    };
  }

  /**
   * Escalates a customer/guest conversation to live human support.
   */
  async requestHandoff(
    actor: ChatActor,
    conversationId: string,
    reason?: string
  ): Promise<{ conversation: IConversation; systemMessage: IMessage }> {
    assertValidActor(actor);
    assertObjectId(conversationId, 'conversation ID');

    const isStaff = actor.role === 'admin' || actor.role === 'seller';
    if (isStaff) {
      throw new AppError(
        'Only the customer or guest can escalate their conversation to human support',
        403
      );
    }

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      throw new AppError('Conversation not found', 404);
    }

    assertConversationAccess(conversation, actor);

    const allowedToQueue: ConversationStatus[] = ['bot_active', 'resolved'];
    if (!allowedToQueue.includes(conversation.status)) {
      throw new AppError(
        `Cannot request handoff when conversation status is '${conversation.status}'`,
        400
      );
    }

    const cleanReason = reason?.trim();
    const handoffText = cleanReason
      ? `Conversation escalated to live support. Reason: ${cleanReason}`
      : 'Conversation escalated to live support queue.';

    const updated = await Conversation.findOneAndUpdate(
      { _id: conversationId, status: { $in: allowedToQueue } },
      {
        $set: {
          mode: 'support',
          status: 'queued',
          ...(cleanReason ? { handoffReason: cleanReason } : {}),
          lastMessageAt: new Date(),
          lastMessagePreview: handoffText.slice(0, 150),
        },
        $unset: { assignedAgent: 1, closedAt: 1 },
        $inc: { unreadCountAgent: 1 },
      },
      { returnDocument: 'after' }
    )
      .populate('user', CHAT_USER_PROJECTION)
      .populate('assignedAgent', CHAT_USER_PROJECTION);

    if (!updated) {
      throw new AppError(
        'Conversation state changed concurrently; please retry',
        409
      );
    }

    const systemMessage = await Message.create({
      conversation: updated._id,
      senderType: 'system',
      content: handoffText,
    });

    return { conversation: updated, systemMessage };
  }

  /**
   * Atomically assigns an agent or seller to a queued conversation.
   */
  async assignConversation(
    agentUser: IUser,
    conversationId: string
  ): Promise<{ conversation: IConversation; systemMessage: IMessage }> {
    assertObjectId(conversationId, 'conversation ID');

    const assignText = `Conversation assigned to agent ${agentUser.firstName} ${agentUser.lastName}.`;

    const updated = await Conversation.findOneAndUpdate(
      { _id: conversationId, status: 'queued' },
      {
        $set: {
          assignedAgent: agentUser._id as mongoose.Types.ObjectId,
          status: 'assigned',
          mode: 'support',
          lastMessageAt: new Date(),
          lastMessagePreview: assignText.slice(0, 150),
        },
      },
      { returnDocument: 'after' }
    )
      .populate('user', CHAT_USER_PROJECTION)
      .populate('assignedAgent', CHAT_USER_PROJECTION);

    if (!updated) {
      const existing = await Conversation.findById(conversationId)
        .select('status')
        .lean();
      if (!existing) {
        throw new AppError('Conversation not found', 404);
      }
      if (existing.status === 'bot_active' || existing.status === 'closed') {
        throw new AppError(
          'Only conversations requesting human support can be claimed.',
          400
        );
      }
      throw new AppError(
        `Conversation cannot be claimed because its status is '${existing.status}'`,
        409
      );
    }

    const systemMessage = await Message.create({
      conversation: updated._id,
      senderType: 'system',
      content: assignText,
    });

    return { conversation: updated, systemMessage };
  }

  /**
   * Updates conversation status with role-based transition validation and atomic updates.
   */
  async updateConversationStatus(
    actor: ChatActor,
    conversationId: string,
    newStatus: ConversationStatus
  ): Promise<{ conversation: IConversation; systemMessage: IMessage }> {
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

    // Customers/guests cannot self-assign or resolve support queues arbitrarily
    if (!isStaff && (newStatus === 'assigned' || newStatus === 'resolved')) {
      throw new AppError(
        `Only support staff can transition a conversation to '${newStatus}'`,
        403
      );
    }
    if (
      !isStaff &&
      conversation.status === 'assigned' &&
      newStatus === 'queued'
    ) {
      throw new AppError(
        'Only support staff can unassign an active conversation',
        403
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

    const statusText = `Conversation status updated to '${newStatus}'.`;
    const setFields: Record<string, unknown> = {
      status: newStatus,
      lastMessageAt: new Date(),
      lastMessagePreview: statusText.slice(0, 150),
    };
    const unsetFields: Record<string, 1> = {};

    if (newStatus === 'bot_active') {
      setFields.mode = 'ai';
      unsetFields.assignedAgent = 1;
      unsetFields.closedAt = 1;
    } else if (newStatus === 'queued') {
      setFields.mode = 'support';
      unsetFields.assignedAgent = 1;
      unsetFields.closedAt = 1;
    } else if (newStatus === 'closed' || newStatus === 'resolved') {
      setFields.closedAt = new Date();
    }

    const updateDoc: Record<string, unknown> = { $set: setFields };
    if (Object.keys(unsetFields).length > 0) {
      updateDoc.$unset = unsetFields;
    }

    const updated = await Conversation.findOneAndUpdate(
      { _id: conversationId, status: conversation.status },
      updateDoc,
      { returnDocument: 'after' }
    )
      .populate('user', CHAT_USER_PROJECTION)
      .populate('assignedAgent', CHAT_USER_PROJECTION);

    if (!updated) {
      throw new AppError(
        'Conversation status changed concurrently; please retry',
        409
      );
    }

    const systemMessage = await Message.create({
      conversation: updated._id,
      senderType: 'system',
      content: statusText,
    });

    return { conversation: updated, systemMessage };
  }

  /**
   * Atomically marks unread messages in conversation as read and resets unread counters.
   */
  async markConversationRead(
    actor: ChatActor,
    conversationId: string
  ): Promise<void> {
    assertValidActor(actor);
    assertObjectId(conversationId, 'conversation ID');

    const conversation = await Conversation.findById(conversationId)
      .select('user guestId status assignedAgent')
      .lean();
    if (!conversation) {
      throw new AppError('Conversation not found', 404);
    }

    assertConversationAccess(conversation as IConversation, actor);

    const isAgent = actor.role === 'admin' || actor.role === 'seller';

    if (isAgent) {
      await Promise.all([
        Message.updateMany(
          {
            conversation: conversationId,
            senderType: { $in: ['customer', 'guest'] },
            isRead: false,
          },
          { $set: { isRead: true, readAt: new Date() } }
        ),
        Conversation.updateOne(
          { _id: conversationId },
          { $set: { unreadCountAgent: 0 } }
        ),
      ]);
    } else {
      await Promise.all([
        Message.updateMany(
          {
            conversation: conversationId,
            senderType: { $in: ['agent', 'ai', 'system'] },
            isRead: false,
          },
          { $set: { isRead: true, readAt: new Date() } }
        ),
        Conversation.updateOne(
          { _id: conversationId },
          { $set: { unreadCountCustomer: 0 } }
        ),
      ]);
    }
  }

  /**
   * Merges all guest conversations into an authenticated user account upon sign-in,
   * returning both count and merged conversation IDs for active socket room eviction.
   */
  async mergeGuestConversations(
    userId: string,
    guestId: string
  ): Promise<{ mergedCount: number; conversationIds: string[] }> {
    assertObjectId(userId, 'user ID');
    if (!guestId) return { mergedCount: 0, conversationIds: [] };

    const guestConversations = await Conversation.find({
      guestId,
      user: { $in: [null, undefined] },
    })
      .select('_id')
      .lean();

    if (guestConversations.length === 0) {
      return { mergedCount: 0, conversationIds: [] };
    }

    const conversationIds = guestConversations.map((c) => c._id);

    await Promise.all([
      Conversation.updateMany(
        { _id: { $in: conversationIds } },
        {
          $set: { user: userId },
          $unset: { guestId: 1 },
        }
      ),
      Message.updateMany(
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
      ),
    ]);

    return {
      mergedCount: guestConversations.length,
      conversationIds: conversationIds.map((id) => id.toString()),
    };
  }
}

export const chatService = new ChatService();
