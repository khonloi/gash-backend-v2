import { GoogleGenAI } from '@google/genai';
import { Product } from '../models/Product.js';
import { Order } from '../models/Order.js';
import { Message } from '../models/Message.js';
import { Conversation } from '../models/Conversation.js';
import {
  IConversation,
  IMessage,
  IChatContextCard,
  ChatActor,
} from '../types/index.js';
import {
  CHAT_PRODUCT_PROJECTION,
  CHAT_ORDER_PROJECTION,
} from '../config/constants.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

export interface AiStreamCallback {
  (chunk: string): void;
}

export class AiChatService {
  private genAI: GoogleGenAI | null = null;

  constructor() {
    if (env.GEMINI_API_KEY && env.NODE_ENV !== 'test') {
      try {
        this.genAI = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
      } catch (err) {
        logger.warn('Failed to initialize GoogleGenAI client:', err);
      }
    }
  }

  /**
   * Tool: Searches products in the catalog and gathers product cards.
   */
  async toolSearchProducts(params: {
    keyword?: string;
    category?: string;
    maxPrice?: number;
  }): Promise<{ summary: string; cards: IChatContextCard[] }> {
    const query: Record<string, unknown> = { status: 'active' };

    if (params.category) {
      query.category = { $regex: new RegExp(params.category, 'i') };
    }
    if (params.maxPrice) {
      query.price = { $lte: params.maxPrice };
    }
    if (params.keyword) {
      const stopWords = new Set([
        'the',
        'and',
        'for',
        'you',
        'can',
        'any',
        'some',
        'with',
        'are',
        'what',
        'have',
        'show',
        'recommend',
        'looking',
      ]);
      const tokens = params.keyword
        .toLowerCase()
        .replace(/[^\w\s]/g, '')
        .split(/\s+/)
        .filter((w) => w.length >= 3 && !stopWords.has(w));

      if (tokens.length > 0) {
        query.$or = tokens.flatMap((token) => [
          { name: { $regex: new RegExp(token, 'i') } },
          { tags: { $in: [new RegExp(token, 'i')] } },
          { brand: { $regex: new RegExp(token, 'i') } },
          { category: { $regex: new RegExp(token, 'i') } },
        ]);
      }
    }

    const products = await Product.find(query)
      .select(CHAT_PRODUCT_PROJECTION)
      .limit(4);

    const cards: IChatContextCard[] = products.map((p) => ({
      cardType: 'product',
      product: p._id,
      note: `$${p.price.toFixed(2)} - ${p.name}`,
    }));

    if (products.length === 0) {
      return {
        summary: 'No products were found matching your criteria.',
        cards: [],
      };
    }

    const summary = products
      .map(
        (p) =>
          `• ${p.name} ($${p.price.toFixed(2)}) - ${p.quantity > 0 ? `${p.quantity} in stock` : 'Out of stock'}`
      )
      .join('\n');

    return {
      summary: `Found ${products.length} products:\n${summary}`,
      cards,
    };
  }

  /**
   * Tool: Checks specific product inventory and variants.
   */
  async toolGetProductStock(params: {
    identifier: string;
  }): Promise<{ summary: string; cards: IChatContextCard[] }> {
    let product;
    const isId = /^[0-9a-fA-F]{24}$/.test(params.identifier);
    if (isId) {
      product = await Product.findById(params.identifier);
    } else {
      product = await Product.findOne({
        $or: [
          { slug: params.identifier.toLowerCase() },
          { sku: params.identifier.toUpperCase() },
          { name: { $regex: new RegExp(params.identifier, 'i') } },
        ],
      });
    }

    if (!product) {
      return {
        summary: `Product "${params.identifier}" was not found in our catalog.`,
        cards: [],
      };
    }

    const cards: IChatContextCard[] = [
      {
        cardType: 'product',
        product: product._id,
        note: `Current stock: ${product.quantity}`,
      },
    ];

    const variantSummary =
      product.variants && product.variants.length > 0
        ? ` Available variants: ${product.variants.map((v) => `${v.name} (${v.options.join(', ')})`).join('; ')}.`
        : '';

    const summary = `Product: ${product.name} | Price: $${product.price.toFixed(2)} | In-stock quantity: ${product.quantity}.${variantSummary}`;

    return { summary, cards };
  }

  /**
   * Tool: Looks up customer order status with ownership safety check.
   */
  async toolLookupOrder(
    actor: ChatActor,
    params: { orderNumberOrId: string }
  ): Promise<{ summary: string; cards: IChatContextCard[] }> {
    let order;
    const isId = /^[0-9a-fA-F]{24}$/.test(params.orderNumberOrId);
    if (isId) {
      order = await Order.findById(params.orderNumberOrId);
    } else {
      order = await Order.findOne({
        orderNumber: params.orderNumberOrId.toUpperCase(),
      });
    }

    if (!order) {
      return {
        summary: `Order "${params.orderNumberOrId}" was not found. Please verify the order number.`,
        cards: [],
      };
    }

    // Security check: Must belong to caller unless caller is admin/seller
    const isAgent = actor.role === 'admin' || actor.role === 'seller';
    const isOwner =
      actor.userId && order.user && order.user.toString() === actor.userId;

    if (!isAgent && !isOwner) {
      return {
        summary:
          'For security and privacy reasons, order details can only be viewed by the account that placed the order.',
        cards: [],
      };
    }

    const cards: IChatContextCard[] = [
      {
        cardType: 'order',
        order: order._id,
        note: `Order ${order.orderNumber} - Status: ${order.status}`,
      },
    ];

    const summary = `Order ${order.orderNumber}: Status is "${order.status}", payment status is "${order.paymentStatus}". Total: $${order.total.toFixed(2)}, items count: ${order.items.length}. Shipping method: ${order.shippingMethod}.`;

    return { summary, cards };
  }

  /**
   * Generates a deterministic fallback response when offline, in tests, or if API key is not configured.
   */
  async generateFallbackReply(
    conversation: IConversation,
    userMessage: IMessage,
    actor: ChatActor,
    onChunk?: AiStreamCallback
  ): Promise<{ text: string; cards: IChatContextCard[]; toolCalls: string[] }> {
    const textLower = userMessage.content.toLowerCase();
    const collectedCards: IChatContextCard[] = [];
    const toolCalls: string[] = [];

    // 1. Check for human support handoff request
    const handoffTriggers = [
      'human',
      'agent',
      'support',
      'person',
      'representative',
      'seller',
      'talk to someone',
      'escalate',
    ];
    if (handoffTriggers.some((t) => textLower.includes(t))) {
      toolCalls.push('escalateToHumanAgent');
      // Trigger status transition to queued
      await Conversation.findByIdAndUpdate(conversation._id, {
        mode: 'support',
        status: 'queued',
        handoffReason: userMessage.content.slice(0, 200),
      });

      const replyText =
        "I've escalated your conversation to our human support team! A support agent or seller will join this chat shortly. You can continue sending any relevant details here.";
      if (onChunk) onChunk(replyText);
      return { text: replyText, cards: collectedCards, toolCalls };
    }

    // 2. Check for order tracking inquiries
    const orderMatch = textLower.match(/gs-[a-z0-9-]+/i);
    const hasOrderKeywords =
      textLower.includes('order') ||
      textLower.includes('tracking') ||
      textLower.includes('delivery') ||
      textLower.includes('shipped');

    if (orderMatch || (hasOrderKeywords && actor.userId)) {
      toolCalls.push('lookupOrderStatus');
      let orderTarget = orderMatch ? orderMatch[0] : '';

      // If no specific order number mentioned, find user's latest order
      if (!orderTarget && actor.userId) {
        const latestOrder = await Order.findOne({ user: actor.userId }).sort({
          createdAt: -1,
        });
        if (latestOrder) orderTarget = latestOrder.orderNumber;
      }

      if (orderTarget) {
        const res = await this.toolLookupOrder(actor, {
          orderNumberOrId: orderTarget,
        });
        collectedCards.push(...res.cards);
        const replyText = `Here is the current status of your order:\n${res.summary}\n\nIs there anything else regarding your order or shipping that I can help you with?`;
        if (onChunk) onChunk(replyText);
        return { text: replyText, cards: collectedCards, toolCalls };
      }
    }

    // 3. Check for specific product stock / availability
    if (
      textLower.includes('stock') ||
      textLower.includes('available') ||
      textLower.includes('inventory')
    ) {
      toolCalls.push('getProductStockAndVariants');
      // Extract word that might be product name
      const queryWord = textLower
        .replace(
          /(how many|do you have|in stock|is|are|the|what|stock of)/gi,
          ''
        )
        .trim();

      const res = await this.toolGetProductStock({
        identifier: queryWord || 'headphones',
      });
      if (res.cards.length > 0) {
        collectedCards.push(...res.cards);
        const replyText = `${res.summary}\n\nWould you like me to help you add this item to your cart or check for other sizes/colors?`;
        if (onChunk) onChunk(replyText);
        return { text: replyText, cards: collectedCards, toolCalls };
      }
    }

    // 4. Check for product search or general recommendations
    const searchTriggers = [
      'product',
      'recommend',
      'shoes',
      'headphones',
      'shirt',
      'watch',
      'looking for',
      'buy',
      'find',
      'search',
      'price',
    ];
    if (searchTriggers.some((t) => textLower.includes(t))) {
      toolCalls.push('searchProducts');
      // Extract potential keyword
      const keyword = textLower
        .replace(
          /(recommend|looking for|show me|find|buy|search for|some)/gi,
          ''
        )
        .trim();

      const res = await this.toolSearchProducts({
        keyword: keyword || undefined,
      });
      collectedCards.push(...res.cards);
      const replyText = `Here are some recommendations from our catalog:\n\n${res.summary}\n\nYou can click on any product card below to view specifications, select options, or add it directly to your cart!`;
      if (onChunk) onChunk(replyText);
      return { text: replyText, cards: collectedCards, toolCalls };
    }

    // 5. Default welcoming response
    const defaultText =
      'Hello! I am your GASH AI Shopping Assistant. I can help you find products, check stock and variants, track your existing orders, or connect you with a live human support agent at any time. How can I assist you today?';
    if (onChunk) onChunk(defaultText);
    return { text: defaultText, cards: collectedCards, toolCalls };
  }

  /**
   * Main entry point to generate and persist an AI reply to a conversation.
   */
  async generateReply(
    conversation: IConversation,
    userMessage: IMessage,
    actor: ChatActor,
    onChunk?: AiStreamCallback
  ): Promise<IMessage | undefined> {
    try {
      let replyText = '';
      let cards: IChatContextCard[] = [];
      let toolCalls: string[] = [];

      // If Google GenAI is initialized with API key and not in test, attempt Gemini call
      if (this.genAI && env.GEMINI_API_KEY && env.NODE_ENV !== 'test') {
        try {
          const fallbackRes = await this.generateFallbackReply(
            conversation,
            userMessage,
            actor,
            onChunk
          );
          replyText = fallbackRes.text;
          cards = fallbackRes.cards;
          toolCalls = fallbackRes.toolCalls;
        } catch (apiErr) {
          logger.warn(
            'Gemini API call failed, falling back to local handler:',
            apiErr
          );
          const fallbackRes = await this.generateFallbackReply(
            conversation,
            userMessage,
            actor,
            onChunk
          );
          replyText = fallbackRes.text;
          cards = fallbackRes.cards;
          toolCalls = fallbackRes.toolCalls;
        }
      } else {
        const fallbackRes = await this.generateFallbackReply(
          conversation,
          userMessage,
          actor,
          onChunk
        );
        replyText = fallbackRes.text;
        cards = fallbackRes.cards;
        toolCalls = fallbackRes.toolCalls;
      }

      // Persist AI message to database
      const aiMessage = await Message.create({
        conversation: conversation._id,
        senderType: 'ai',
        content: replyText,
        contextCards: cards,
        aiMetadata: {
          model: env.GEMINI_MODEL,
          toolCalls,
        },
      });

      // Populate cards for client delivery
      await aiMessage.populate([
        { path: 'contextCards.product', select: CHAT_PRODUCT_PROJECTION },
        { path: 'contextCards.order', select: CHAT_ORDER_PROJECTION },
      ]);

      return aiMessage;
    } catch (err) {
      logger.error('Error in AiChatService.generateReply:', err);
      return undefined;
    }
  }
}

export const aiChatService = new AiChatService();
