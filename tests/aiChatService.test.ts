import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { env } from '../src/config/env.js';
import { User } from '../src/models/User.js';
import { Product } from '../src/models/Product.js';
import { Order } from '../src/models/Order.js';
import { Conversation } from '../src/models/Conversation.js';
import { Message } from '../src/models/Message.js';
import { AiChatService, aiChatService } from '../src/services/aiChatService.js';

let mongoServer: MongoMemoryServer;

describe('AiChatService & Gemini Tool Calling Unit Tests', () => {
  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await Promise.all([
      User.deleteMany({}),
      Product.deleteMany({}),
      Order.deleteMany({}),
      Conversation.deleteMany({}),
      Message.deleteMany({}),
    ]);
  });

  it('toolSearchProducts filters by category, maxPrice, keyword, and handles empty matches', async () => {
    await Product.create([
      {
        name: 'VaporMax Running Shoe',
        slug: 'vapormax-running-shoe',
        description: 'Lightweight runner',
        sku: 'VAPOR-01',
        price: 120,
        quantity: 8,
        category: 'Footwear',
        brand: 'Nike',
        tags: ['running', 'lightweight'],
        status: 'active',
      },
      {
        name: 'Expensive Trail Boot',
        slug: 'expensive-trail-boot',
        description: 'Heavy duty',
        sku: 'TRAIL-99',
        price: 350,
        quantity: 4,
        category: 'Footwear',
        brand: 'Salomon',
        status: 'active',
      },
    ]);

    const filtered = await aiChatService.toolSearchProducts({
      category: 'Footwear',
      maxPrice: 150,
      keyword: 'running vapor [special]',
    });
    expect(filtered.cards).toHaveLength(1);
    expect(filtered.summary).toContain('VaporMax Running Shoe');

    const empty = await aiChatService.toolSearchProducts({
      keyword: 'nonexistentproductxyz',
    });
    expect(empty.cards).toHaveLength(0);
    expect(empty.summary).toMatch(/No products were found/i);
  });

  it('toolGetProductStock resolves by empty id, ObjectId, SKU/name with variants, and handles not found', async () => {
    const prod = await Product.create({
      name: 'Pro Tennis Racket',
      slug: 'pro-tennis-racket',
      description: 'Carbon racket',
      sku: 'RKT-100',
      price: 199,
      quantity: 12,
      category: 'Tennis',
      status: 'active',
      variants: [
        { sku: 'RKT-100-G2', size: 'G2', color: 'Black', stock: 5 },
        { sku: 'RKT-100-G3', size: 'G3', color: 'Red', stock: 7 },
      ],
    });

    const emptyRes = await aiChatService.toolGetProductStock({
      identifier: '   ',
    });
    expect(emptyRes.cards).toHaveLength(0);
    expect(emptyRes.summary).toMatch(/Please provide/i);

    const byId = await aiChatService.toolGetProductStock({
      identifier: prod._id.toString(),
    });
    expect(byId.cards).toHaveLength(1);
    expect(byId.summary).toContain('Available variants');
    expect(byId.summary).toContain('G2 / Black (stock: 5)');

    const bySku = await aiChatService.toolGetProductStock({
      identifier: 'rkt-100',
    });
    expect(bySku.cards).toHaveLength(1);

    const missing = await aiChatService.toolGetProductStock({
      identifier: 'DOES-NOT-EXIST',
    });
    expect(missing.cards).toHaveLength(0);
    expect(missing.summary).toMatch(/was not found/i);
  });

  it('toolLookupOrder enforces ownership and allows admin global access', async () => {
    const owner = await User.create({
      firstName: 'Owner',
      lastName: 'User',
      email: 'owner.ai@example.com',
      password: 'Password123!',
    });
    const other = await User.create({
      firstName: 'Other',
      lastName: 'User',
      email: 'other.ai@example.com',
      password: 'Password123!',
    });

    const order = await Order.create({
      orderNumber: 'GS-261123-AAAA1111',
      user: owner._id,
      items: [
        {
          product: new mongoose.Types.ObjectId(),
          name: 'Running Belt',
          sku: 'BELT-1',
          price: 25,
          quantity: 1,
        },
      ],
      shippingAddress: {
        fullName: 'Owner User',
        phone: '+84901234567',
        addressLine1: '100 Main St',
        city: 'HCMC',
      },
      subtotal: 25,
      shippingFee: 30,
      total: 55,
    });

    const notFound = await aiChatService.toolLookupOrder(
      { userId: owner._id.toString(), role: 'customer' },
      { orderNumberOrId: 'GS-000000-NONE' }
    );
    expect(notFound.cards).toHaveLength(0);

    const forbidden = await aiChatService.toolLookupOrder(
      { userId: other._id.toString(), role: 'customer' },
      { orderNumberOrId: order.orderNumber }
    );
    expect(forbidden.cards).toHaveLength(0);
    expect(forbidden.summary).toMatch(/only be viewed/i);

    const ownerOk = await aiChatService.toolLookupOrder(
      { userId: owner._id.toString(), role: 'customer' },
      { orderNumberOrId: order._id.toString() }
    );
    expect(ownerOk.cards).toHaveLength(1);
    expect(ownerOk.summary).toContain(order.orderNumber);

    const adminOk = await aiChatService.toolLookupOrder(
      { userId: other._id.toString(), role: 'admin' },
      { orderNumberOrId: order.orderNumber }
    );
    expect(adminOk.cards).toHaveLength(1);
  });

  it('generateFallbackReply handles handoff, order lookup, stock prompts, and general search', async () => {
    const customer = await User.create({
      firstName: 'Chat',
      lastName: 'Buyer',
      email: 'chat.buyer@example.com',
      password: 'Password123!',
    });

    const prod = await Product.create({
      name: 'Aero Running Shorts',
      slug: 'aero-running-shorts',
      description: 'Breathable shorts',
      sku: 'SHRT-1',
      price: 45,
      quantity: 20,
      category: 'Apparel',
      status: 'active',
    });

    const order = await Order.create({
      orderNumber: 'GS-261123-BBBB2222',
      user: customer._id,
      items: [
        {
          product: prod._id,
          name: prod.name,
          sku: prod.sku,
          price: prod.price,
          quantity: 1,
        },
      ],
      shippingAddress: {
        fullName: 'Chat Buyer',
        phone: '+84901234567',
        addressLine1: '100 Main St',
        city: 'HCMC',
      },
      subtotal: 45,
      shippingFee: 30,
      total: 75,
    });

    const conv = await Conversation.create({
      user: customer._id,
      mode: 'ai',
      status: 'bot_active',
    });

    const actor = {
      userId: customer._id.toString(),
      role: 'customer' as const,
    };
    const chunks: string[] = [];

    // 1. Order inquiry without explicit order number looks up latest order
    const mOrder = await Message.create({
      conversation: conv._id,
      senderType: 'customer',
      senderUser: customer._id,
      content: 'Where is my order tracking?',
    });
    const rOrder = await aiChatService.generateFallbackReply(
      conv,
      mOrder,
      actor,
      (c) => chunks.push(c)
    );
    expect(rOrder.toolCalls).toContain('lookupOrderStatus');
    expect(rOrder.text).toContain(order.orderNumber);

    // 2. Stock inquiry without product name prompts user
    const mStockAsk = await Message.create({
      conversation: conv._id,
      senderType: 'customer',
      senderUser: customer._id,
      content: 'What is in stock?',
    });
    const rStockAsk = await aiChatService.generateFallbackReply(
      conv,
      mStockAsk,
      actor,
      (c) => chunks.push(c)
    );
    expect(rStockAsk.text).toMatch(/share the product name or SKU/i);

    // 3. Stock inquiry with product identifier
    const mStockFound = await Message.create({
      conversation: conv._id,
      senderType: 'customer',
      senderUser: customer._id,
      content: 'in stock SHRT-1',
    });
    const rStockFound = await aiChatService.generateFallbackReply(
      conv,
      mStockFound,
      actor,
      (c) => chunks.push(c)
    );
    expect(rStockFound.cards).toHaveLength(1);
    expect(rStockFound.text).toContain('Aero Running Shorts');

    // 3b. Explicit order number lookup via fallback
    const mExplicitOrder = await Message.create({
      conversation: conv._id,
      senderType: 'customer',
      senderUser: customer._id,
      content: `Check order ${order.orderNumber}`,
    });
    const rExplicitOrder = await aiChatService.generateFallbackReply(
      conv,
      mExplicitOrder,
      actor
    );
    expect(rExplicitOrder.toolCalls).toContain('lookupOrderStatus');
    expect(rExplicitOrder.cards).toHaveLength(1);

    // 4. General no-match message returns friendly help prompt
    const mGeneral = await Message.create({
      conversation: conv._id,
      senderType: 'customer',
      senderUser: customer._id,
      content: 'hi',
    });
    const rGeneral = await aiChatService.generateFallbackReply(
      conv,
      mGeneral,
      actor
    );
    expect(rGeneral.text).toMatch(/GASH AI Shopping Assistant/i);

    // 5. Explicit human support handoff escalates conversation
    const mHandoff = await Message.create({
      conversation: conv._id,
      senderType: 'customer',
      senderUser: customer._id,
      content: 'Please let me talk to a human agent',
    });
    const rHandoff = await aiChatService.generateFallbackReply(
      conv,
      mHandoff,
      actor,
      (c) => chunks.push(c)
    );
    expect(rHandoff.escalated).toBe(true);
    expect(rHandoff.systemMessage).toBeDefined();
    expect(chunks.length).toBeGreaterThanOrEqual(4);
  });

  it('generateReply executes mocked Gemini multi-tool loop and falls back cleanly on error', async () => {
    const customer = await User.create({
      firstName: 'Gemini',
      lastName: 'Tester',
      email: 'gemini.tester@example.com',
      password: 'Password123!',
    });

    const prod = await Product.create({
      name: 'Gemini Carbon Shoe',
      slug: 'gemini-carbon-shoe',
      description: 'Fast shoe',
      sku: 'GEM-01',
      price: 180,
      quantity: 9,
      category: 'Footwear',
      status: 'active',
    });

    const order = await Order.create({
      orderNumber: 'GS-261123-CCCC3333',
      user: customer._id,
      items: [
        {
          product: prod._id,
          name: prod.name,
          sku: prod.sku,
          price: prod.price,
          quantity: 1,
        },
      ],
      shippingAddress: {
        fullName: 'Gemini Tester',
        phone: '+84901234567',
        addressLine1: '100 Main St',
        city: 'HCMC',
      },
      subtotal: 180,
      shippingFee: 30,
      total: 210,
    });

    const conv = await Conversation.create({
      user: customer._id,
      mode: 'ai',
      status: 'bot_active',
    });

    await Message.create({
      conversation: conv._id,
      senderType: 'ai',
      content: 'Earlier greeting',
    });

    const userMsg = await Message.create({
      conversation: conv._id,
      senderType: 'customer',
      senderUser: customer._id,
      content: 'Check footwear, GEM-01 stock, my order, then escalate please',
    });

    const originalNodeEnv = env.NODE_ENV;
    const originalApiKey = env.GEMINI_API_KEY;
    const service = new AiChatService();

    let geminiCalls = 0;
    let shouldFailGemini = false;
    const generateContentMock = async () => {
      geminiCalls += 1;
      if (shouldFailGemini) {
        throw new Error('Gemini timeout');
      }
      if (geminiCalls === 1) {
        return {
          functionCalls: [
            {
              id: 'c1',
              name: 'searchProducts',
              args: { keyword: 'Gemini', category: 'Footwear', maxPrice: 250 },
            },
            {
              id: 'c2',
              name: 'getProductStock',
              args: { identifier: 'GEM-01' },
            },
            {
              id: 'c3',
              name: 'lookupOrder',
              args: { orderNumberOrId: order.orderNumber },
            },
            { id: 'c4', name: 'unknownTool', args: {} },
            {
              id: 'c5',
              name: 'escalateToHumanAgent',
              args: { reason: 'User requested follow-up' },
            },
          ],
          candidates: [{ content: { parts: [{ text: '' }] } }],
        };
      }
      return {
        text: 'Found your Gemini Carbon Shoe and checked order GS-261123-CCCC3333.',
      };
    };

    (
      service as unknown as {
        genAI: { models: { generateContent: typeof generateContentMock } };
      }
    ).genAI = {
      models: { generateContent: generateContentMock },
    };

    try {
      (env as { NODE_ENV: string }).NODE_ENV = 'development';
      (env as { GEMINI_API_KEY?: string }).GEMINI_API_KEY = 'fake-gemini-key';

      const chunks: string[] = [];
      const result = await service.generateReply(
        conv,
        userMsg,
        { userId: customer._id.toString(), role: 'customer' },
        (c) => chunks.push(c)
      );

      expect(geminiCalls).toBe(2);
      expect(result).toBeDefined();
      expect(result?.escalated).toBe(true);
      expect(result?.systemMessage).toBeDefined();
      expect(result?.aiMessage.aiMetadata?.model).toBe(env.GEMINI_MODEL);
      expect(result?.aiMessage.aiMetadata?.toolCalls).toEqual([
        'searchProducts',
        'getProductStock',
        'lookupOrder',
        'unknownTool',
        'escalateToHumanAgent',
      ]);
      expect(chunks).toHaveLength(1);

      // Next, test error fallback when generateContent rejects
      shouldFailGemini = true;
      const conv2 = await Conversation.create({
        user: customer._id,
        mode: 'ai',
        status: 'bot_active',
      });
      const msg2 = await Message.create({
        conversation: conv2._id,
        senderType: 'customer',
        senderUser: customer._id,
        content: 'Show me running shoes',
      });
      await Product.create({
        name: 'Cloud Running Shoes',
        slug: 'cloud-running-shoes',
        description: 'Fast runner shoes',
        sku: 'RUN-SHOES-1',
        price: 110,
        quantity: 6,
        category: 'Footwear',
        status: 'active',
      });

      const fallbackResult = await service.generateReply(conv2, msg2, {
        userId: customer._id.toString(),
        role: 'customer',
      });
      expect(fallbackResult?.aiMessage.aiMetadata?.model).toBe(
        'local-fallback'
      );
      expect(fallbackResult?.aiMessage.contextCards?.length).toBeGreaterThan(0);

      // Cover constructor catch/env initialization when NODE_ENV=development
      const devService = new AiChatService();
      expect(devService).toBeDefined();
    } finally {
      (env as { NODE_ENV: string }).NODE_ENV = originalNodeEnv;
      (env as { GEMINI_API_KEY?: string }).GEMINI_API_KEY = originalApiKey;
    }
  });

  it('chatService listConversations, status transitions, and 404/403 guards', async () => {
    const { chatService } = await import('../src/services/chatService.js');
    const seller = await User.create({
      firstName: 'Support',
      lastName: 'Seller',
      email: 'seller.chat@example.com',
      password: 'Password123!',
      role: 'seller',
    });
    const buyer = await User.create({
      firstName: 'Buyer',
      lastName: 'Chat',
      email: 'buyer.chat@example.com',
      password: 'Password123!',
    });

    const buyerActor = {
      userId: buyer._id.toString(),
      role: 'customer' as const,
    };
    const sellerActor = {
      userId: seller._id.toString(),
      role: 'seller' as const,
    };
    const adminActor = {
      userId: new mongoose.Types.ObjectId().toString(),
      role: 'admin' as const,
    };

    const missingId = new mongoose.Types.ObjectId().toString();
    await expect(
      chatService.getConversationById(buyerActor, missingId)
    ).rejects.toThrow('Conversation not found');
    await expect(
      chatService.getMessages(buyerActor, missingId)
    ).rejects.toThrow('Conversation not found');

    const { conversation: botConv } = await chatService.createOrGetConversation(
      buyerActor,
      { mode: 'ai', subject: 'Sizing' }
    );

    // Seller cannot access bot_active conversation; admin cannot change status before handoff
    await expect(
      chatService.updateConversationStatus(
        sellerActor,
        botConv._id.toString(),
        'closed'
      )
    ).rejects.toThrow(/Sellers cannot access active AI/i);

    await expect(
      chatService.updateConversationStatus(
        adminActor,
        botConv._id.toString(),
        'closed'
      )
    ).rejects.toThrow(/before human support/i);

    const { conversation: supportConv } =
      await chatService.createOrGetConversation(buyerActor, {
        mode: 'support',
        subject: 'Order issue',
      });

    // Seller lists queued conversations sorted by -lastMessageAt with mode filters
    const sellerQueue = await chatService.getConversations(sellerActor, {
      mode: 'support',
      sort: '-lastMessageAt',
      page: 1,
      limit: 30,
    });
    expect(sellerQueue.data.length).toBeGreaterThanOrEqual(1);

    // Buyer cannot assign/resolve
    await expect(
      chatService.updateConversationStatus(
        buyerActor,
        supportConv._id.toString(),
        'resolved'
      )
    ).rejects.toThrow(/Only support staff/i);

    const assigned = await chatService.assignConversation(
      seller,
      supportConv._id.toString()
    );
    expect(assigned.conversation.status).toBe('assigned');

    // Already assigned triggers 409
    await expect(
      chatService.assignConversation(seller, supportConv._id.toString())
    ).rejects.toThrow(/cannot be claimed/i);

    // Non-existent conversation triggers 404 on assign & bot_active triggers 400
    await expect(
      chatService.assignConversation(seller, missingId)
    ).rejects.toThrow('Conversation not found');
    await expect(
      chatService.assignConversation(seller, botConv._id.toString())
    ).rejects.toThrow(/Only conversations requesting human support/i);

    // Buyer cannot unassign active conversation
    await expect(
      chatService.updateConversationStatus(
        buyerActor,
        supportConv._id.toString(),
        'queued'
      )
    ).rejects.toThrow(/Only support staff/i);

    // Seller can return assigned -> queued, then assign -> resolved -> bot_active
    const requeued = await chatService.updateConversationStatus(
      sellerActor,
      supportConv._id.toString(),
      'queued'
    );
    expect(requeued.conversation.mode).toBe('support');

    await chatService.assignConversation(seller, supportConv._id.toString());
    const resolved = await chatService.updateConversationStatus(
      sellerActor,
      supportConv._id.toString(),
      'resolved'
    );
    expect(resolved.conversation.closedAt).toBeDefined();

    // Invalid transition resolved -> assigned fails
    await expect(
      chatService.updateConversationStatus(
        sellerActor,
        supportConv._id.toString(),
        'assigned'
      )
    ).rejects.toThrow(/Invalid status transition/i);

    // Close the resolved conversation; handoff on closed fails with 400
    await chatService.updateConversationStatus(
      sellerActor,
      supportConv._id.toString(),
      'closed'
    );
    await expect(
      chatService.requestHandoff(buyerActor, supportConv._id.toString())
    ).rejects.toThrow(/closed/i);

    const guestActor = {
      guestId: `guest_${new mongoose.Types.ObjectId().toString()}`,
      role: 'guest' as const,
    };
    const { conversation: gConv } = await chatService.createOrGetConversation(
      guestActor,
      { mode: 'ai', initialMessage: 'Hello AI' }
    );
    await chatService.markConversationRead(guestActor, gConv._id.toString());
    await chatService.requestHandoff(guestActor, gConv._id.toString(), 'Human');
    await expect(
      chatService.requestHandoff(guestActor, gConv._id.toString())
    ).rejects.toThrow(/Cannot request handoff/i);
    await chatService.markConversationRead(sellerActor, gConv._id.toString());

    // Non-existent contextCard productId / orderId are gracefully ignored
    const skippedCardsRes = await chatService.sendMessage(
      guestActor,
      gConv._id.toString(),
      {
        content: 'Skipped cards message',
        contextCards: [
          { cardType: 'product', productId: missingId },
          { cardType: 'order', orderId: 'GS-000000-BAD' },
        ],
      }
    );
    expect(skippedCardsRes.message.contextCards).toHaveLength(0);
  });
});
