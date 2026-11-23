import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../src/app.js';
import { Conversation } from '../src/models/Conversation.js';
import { Message } from '../src/models/Message.js';
import { Product } from '../src/models/Product.js';
import { Order } from '../src/models/Order.js';
import { User } from '../src/models/User.js';
import { signAccessToken } from '../src/utils/jwt.js';
import { signGuestToken } from '../src/utils/guestToken.js';
import { aiChatService } from '../src/services/aiChatService.js';
import { IProduct, IOrder } from '../src/types/index.js';

let mongoServer: MongoMemoryServer;
let customerToken: string;
let customerId: string;
let adminToken: string;
let adminId: string;
let sellerToken: string;
let testProduct: IProduct;
let testOrder: IOrder;
const guestId = 'guest-session-uuid-12345678';
const guestToken = signGuestToken(guestId);

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await Conversation.deleteMany({});
  await Message.deleteMany({});
  await Product.deleteMany({});
  await Order.deleteMany({});
  await User.deleteMany({});

  const customer = await User.create({
    firstName: 'Chat',
    lastName: 'Customer',
    email: 'chat.customer@example.com',
    password: 'Password123!',
    role: 'customer',
  });
  customerId = customer._id.toString();
  customerToken = signAccessToken(customerId, 'customer');

  const admin = await User.create({
    firstName: 'Chat',
    lastName: 'Admin',
    email: 'chat.admin@example.com',
    password: 'Password123!',
    role: 'admin',
  });
  adminId = admin._id.toString();
  adminToken = signAccessToken(adminId, 'admin');

  const seller = await User.create({
    firstName: 'Chat',
    lastName: 'Seller',
    email: 'chat.seller@example.com',
    password: 'Password123!',
    role: 'seller',
  });
  sellerToken = signAccessToken(seller._id.toString(), 'seller');

  testProduct = await Product.create({
    name: 'Wireless Noise Cancelling Headphones',
    slug: 'wireless-noise-cancelling-headphones',
    description: 'Crisp studio audio headphones',
    price: 199.99,
    sku: 'AUDIO-WH-001',
    category: 'Electronics',
    brand: 'SonicMax',
    quantity: 25,
    status: 'active',
  });

  testOrder = await Order.create({
    orderNumber: 'GS-260914-ABC',
    user: customer._id,
    items: [
      {
        product: testProduct._id,
        name: testProduct.name,
        sku: testProduct.sku,
        price: testProduct.price,
        quantity: 1,
      },
    ],
    shippingAddress: {
      fullName: 'Chat Customer',
      addressLine1: '123 Main St',
      city: 'Hanoi',
      state: 'HN',
      country: 'Vietnam',
      postalCode: '100000',
      phone: '0987654321',
    },
    shippingMethod: 'standard',
    shippingFee: 0,
    subtotal: 199.99,
    total: 199.99,
    paymentMethod: 'cod',
    paymentStatus: 'pending',
    status: 'processing',
  });
});

describe('Chat REST API Integration Tests', () => {
  describe('POST /api/v1/chat/guest-session & guest authentication', () => {
    it('should issue a signed guestToken and HttpOnly cookie', async () => {
      const res = await request(app).post('/api/v1/chat/guest-session');

      expect(res.statusCode).toBe(201);
      expect(res.body.data.guestId).toMatch(/^guest_/);
      expect(res.body.data.guestToken).toMatch(/^gst\./);
      expect(res.headers['set-cookie']).toBeDefined();
    });

    it('should reject unsigned raw x-guest-id without valid guestToken with 401', async () => {
      const res = await request(app)
        .post('/api/v1/chat/conversations')
        .set('x-guest-id', 'unsigned-spoofed-guest-id')
        .send({ subject: 'Spoof attempt' });

      expect(res.statusCode).toBe(401);
    });
  });

  describe('POST /api/v1/chat/conversations', () => {
    it('should reject unauthenticated request without guestToken with 401', async () => {
      const res = await request(app)
        .post('/api/v1/chat/conversations')
        .send({ subject: 'General inquiry' });

      expect(res.statusCode).toBe(401);
    });

    it('should create an AI conversation for guest with signed guestToken and generate 1 AI reply', async () => {
      const res = await request(app)
        .post('/api/v1/chat/conversations')
        .set('x-guest-token', guestToken)
        .send({
          subject: 'Looking for headphones',
          mode: 'ai',
          initialMessage: 'Do you recommend any headphones?',
          contextCards: [
            {
              cardType: 'product',
              productId: testProduct._id.toString(),
              note: 'Interested in this',
            },
          ],
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.status).toBe('success');
      expect(res.body.data.conversation).toBeDefined();
      expect(res.body.data.conversation.mode).toBe('ai');
      expect(res.body.data.conversation.status).toBe('bot_active');
      expect(res.body.data.conversation.guestId).toBe(guestId);
      expect(res.body.data.initialMessage).toBeDefined();
      expect(res.body.data.aiReply).toBeDefined();

      const messages = await Message.find({
        conversation: res.body.data.conversation._id,
      });
      expect(messages).toHaveLength(2);
      const aiReply = messages.find((m) => m.senderType === 'ai');
      expect(aiReply?.aiMetadata?.model).toBe('local-fallback');
      expect(aiReply?.contextCards.length).toBeGreaterThanOrEqual(1);
    });

    it('should create an AI conversation for authenticated customer and allow GET /conversations/:id', async () => {
      const res = await request(app)
        .post('/api/v1/chat/conversations')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          subject: 'Order support',
          mode: 'ai',
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.data.conversation.user._id).toBe(customerId);
      expect(res.body.data.conversation.user.email).toBeUndefined();

      // Customer can retrieve their own conversation (tests populated user resolveOwnerId fix)
      const getRes = await request(app)
        .get(`/api/v1/chat/conversations/${res.body.data.conversation._id}`)
        .set('Authorization', `Bearer ${customerToken}`);
      expect(getRes.statusCode).toBe(200);
      expect(getRes.body.data.conversation._id).toBe(
        res.body.data.conversation._id
      );

      // Seller cannot inspect active AI conversation
      const sellerGetRes = await request(app)
        .get(`/api/v1/chat/conversations/${res.body.data.conversation._id}`)
        .set('Authorization', `Bearer ${sellerToken}`);
      expect(sellerGetRes.statusCode).toBe(403);
    });
  });

  describe('GET /api/v1/chat/conversations', () => {
    it('should return paginated conversations for authenticated user', async () => {
      await Conversation.create({
        user: customerId,
        mode: 'ai',
        status: 'bot_active',
        subject: 'Inquiry 1',
      });
      await Conversation.create({
        user: customerId,
        mode: 'support',
        status: 'queued',
        subject: 'Inquiry 2',
      });

      const res = await request(app)
        .get('/api/v1/chat/conversations')
        .set('Authorization', `Bearer ${customerToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.results).toBe(2);
      expect(res.body.data.conversations.length).toBe(2);
    });

    it('should allow admin to filter support queue conversations and exclude closed ones from all list', async () => {
      await Conversation.create({
        user: customerId,
        mode: 'support',
        status: 'queued',
        subject: 'Queue item 1',
      });
      await Conversation.create({
        user: customerId,
        mode: 'support',
        status: 'closed',
        subject: 'Closed item 1',
      });

      const queuedRes = await request(app)
        .get('/api/v1/chat/conversations?status=queued')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(queuedRes.statusCode).toBe(200);
      expect(queuedRes.body.data.conversations.length).toBe(1);
      expect(queuedRes.body.data.conversations[0].status).toBe('queued');

      const allRes = await request(app)
        .get('/api/v1/chat/conversations')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(allRes.statusCode).toBe(200);
      expect(
        allRes.body.data.conversations.some(
          (c: { status: string }) => c.status === 'closed'
        )
      ).toBe(false);
    });
  });

  describe('Messages, AI Tool Safety & Context Cards', () => {
    it('should allow customer to send message with order context card and generate 1 AI reply', async () => {
      const conv = await Conversation.create({
        user: customerId,
        mode: 'ai',
        status: 'bot_active',
      });

      const res = await request(app)
        .post(`/api/v1/chat/conversations/${conv._id}/messages`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          content: 'What is the status of my order GS-260914-ABC?',
          contextCards: [
            {
              cardType: 'order',
              orderId: testOrder._id.toString(),
              note: 'Recent order',
            },
          ],
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.data.message).toBeDefined();
      expect(res.body.data.message.senderType).toBe('customer');
      expect(res.body.data.message.contextCards.length).toBe(1);
      expect(res.body.data.message.contextCards[0].order).toBeDefined();

      expect(res.body.data.aiReply).toBeDefined();
      expect(res.body.data.aiReply.senderType).toBe('ai');
      expect(res.body.data.aiReply.content).toContain('GS-260914-ABC');
    });

    it('should handle regex metacharacters safely, hide draft stock, and avoid false-positive handoff on "arch support shoes"', async () => {
      await Product.create({
        name: 'Secret Draft Product',
        slug: 'secret-draft-product',
        description: 'Hidden draft item',
        price: 99,
        sku: 'DRAFT-001',
        category: 'Shoes',
        quantity: 5,
        status: 'draft',
      });

      const stockRes = await aiChatService.toolGetProductStock({
        identifier: '[Draft (Secret',
      });
      expect(stockRes.cards).toHaveLength(0);

      const draftLookup = await aiChatService.toolGetProductStock({
        identifier: 'Secret Draft Product',
      });
      expect(draftLookup.cards).toHaveLength(0);

      const conv = await Conversation.create({
        user: customerId,
        mode: 'ai',
        status: 'bot_active',
      });
      const res = await request(app)
        .post(`/api/v1/chat/conversations/${conv._id}/messages`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ content: 'Do you recommend arch support shoes?' });

      expect(res.statusCode).toBe(201);
      const updatedConv = await Conversation.findById(conv._id);
      expect(updatedConv?.status).toBe('bot_active');
    });

    it('should reject invalid pagination limit (>100) on GET /messages and retrieve paginated messages', async () => {
      const conv = await Conversation.create({
        user: customerId,
        mode: 'ai',
        status: 'bot_active',
      });

      await Message.create({
        conversation: conv._id,
        senderType: 'customer',
        senderUser: customerId,
        content: 'Hello assistant',
      });

      const badLimitRes = await request(app)
        .get(`/api/v1/chat/conversations/${conv._id}/messages?limit=1000`)
        .set('Authorization', `Bearer ${customerToken}`);
      expect(badLimitRes.statusCode).toBe(400);

      const res = await request(app)
        .get(`/api/v1/chat/conversations/${conv._id}/messages`)
        .set('Authorization', `Bearer ${customerToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data.messages.length).toBe(1);
      expect(res.body.data.messages[0].content).toBe('Hello assistant');
    });
  });

  describe('Support Escalation, Atomic Assignment & Status Transitions', () => {
    it('should block staff from messaging bot_active conversations until customer requests handoff', async () => {
      const conv = await Conversation.create({
        user: customerId,
        mode: 'ai',
        status: 'bot_active',
      });

      const blockedRes = await request(app)
        .post(`/api/v1/chat/conversations/${conv._id}/messages`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ content: 'Admin trying to interrupt AI chat' });

      expect(blockedRes.statusCode).toBe(400);

      const handoffRes = await request(app)
        .post(`/api/v1/chat/conversations/${conv._id}/handoff`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ reason: 'Need human support' });

      expect(handoffRes.statusCode).toBe(200);
      expect(handoffRes.body.data.conversation.status).toBe('queued');

      const allowedRes = await request(app)
        .post(`/api/v1/chat/conversations/${conv._id}/messages`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ content: 'Hello, I am here to help!' });

      expect(allowedRes.statusCode).toBe(201);
      expect(allowedRes.body.data.message.senderType).toBe('agent');
    });

    it('should atomically assign conversation once and reject second claim with 409', async () => {
      const conv = await Conversation.create({
        user: customerId,
        mode: 'support',
        status: 'queued',
      });

      const res1 = await request(app)
        .patch(`/api/v1/chat/conversations/${conv._id}/assign`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res1.statusCode).toBe(200);
      expect(res1.body.data.conversation.status).toBe('assigned');
      expect(res1.body.data.conversation.assignedAgent._id).toBe(adminId);

      // Second concurrent/duplicate claim by seller returns 409 Conflict
      const res2 = await request(app)
        .patch(`/api/v1/chat/conversations/${conv._id}/assign`)
        .set('Authorization', `Bearer ${sellerToken}`);
      expect(res2.statusCode).toBe(409);
    });

    it('should prevent customers from setting assigned/resolved status directly and sync mode when returning to bot_active', async () => {
      const conv = await Conversation.create({
        user: customerId,
        mode: 'support',
        status: 'queued',
      });

      const forbidAssign = await request(app)
        .patch(`/api/v1/chat/conversations/${conv._id}/status`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ status: 'assigned' });
      expect(forbidAssign.statusCode).toBe(403);

      const reopenBot = await request(app)
        .patch(`/api/v1/chat/conversations/${conv._id}/status`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ status: 'bot_active' });
      expect(reopenBot.statusCode).toBe(200);
      expect(reopenBot.body.data.conversation.mode).toBe('ai');
      expect(reopenBot.body.data.conversation.status).toBe('bot_active');
    });

    it('should mark conversation messages as read', async () => {
      const conv = await Conversation.create({
        user: customerId,
        mode: 'support',
        status: 'assigned',
        unreadCountCustomer: 2,
      });

      await Message.create({
        conversation: conv._id,
        senderType: 'agent',
        senderUser: adminId,
        content: 'How may I help you today?',
        isRead: false,
      });

      const res = await request(app)
        .patch(`/api/v1/chat/conversations/${conv._id}/read`)
        .set('Authorization', `Bearer ${customerToken}`);

      expect(res.statusCode).toBe(200);

      const updatedConv = await Conversation.findById(conv._id);
      expect(updatedConv?.unreadCountCustomer).toBe(0);

      const msg = await Message.findOne({ conversation: conv._id });
      expect(msg?.isRead).toBe(true);
    });
  });

  describe('Guest-to-User Chat Session Merge (POST /api/v1/chat/merge)', () => {
    it('should reject merge with unsigned/forged guest token', async () => {
      const res = await request(app)
        .post('/api/v1/chat/merge')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ guestToken: 'gst.forged-guest-id.invalidsig' });

      expect(res.statusCode).toBe(401);
    });

    it('should merge guest conversations using signed guestToken and upgrade message sender to customer', async () => {
      const guestConv = await Conversation.create({
        guestId,
        mode: 'ai',
        status: 'bot_active',
        subject: 'Guest shopping session',
      });

      await Message.create({
        conversation: guestConv._id,
        senderType: 'guest',
        content: 'I want to know about shipping to Hanoi',
      });

      const res = await request(app)
        .post('/api/v1/chat/merge')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ guestToken });

      expect(res.statusCode).toBe(200);
      expect(res.body.data.mergedConversations).toBe(1);

      const mergedConv = await Conversation.findById(guestConv._id);
      expect(mergedConv?.user?.toString()).toBe(customerId);
      expect(mergedConv?.guestId).toBeUndefined();

      const mergedMsg = await Message.findOne({
        conversation: guestConv._id,
      });
      expect(mergedMsg?.senderType).toBe('customer');
      expect(mergedMsg?.senderUser?.toString()).toBe(customerId);
    });
  });
});
