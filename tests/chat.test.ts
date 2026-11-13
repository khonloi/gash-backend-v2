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
import { IProduct, IOrder } from '../src/types/index.js';

let mongoServer: MongoMemoryServer;
let customerToken: string;
let customerId: string;
let adminToken: string;
let adminId: string;
let testProduct: IProduct;
let testOrder: IOrder;
const guestId = 'guest-session-uuid-12345678';

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
  describe('POST /api/v1/chat/conversations', () => {
    it('should reject unauthenticated request without guestId with 401', async () => {
      const res = await request(app)
        .post('/api/v1/chat/conversations')
        .send({ subject: 'General inquiry' });

      expect(res.statusCode).toBe(401);
    });

    it('should create an AI conversation for guest with initial message and generate AI reply', async () => {
      const res = await request(app)
        .post('/api/v1/chat/conversations')
        .set('x-guest-id', guestId)
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

      // Check messages stored in database
      const messages = await Message.find({
        conversation: res.body.data.conversation._id,
      });
      expect(messages.length).toBeGreaterThanOrEqual(2); // user message + AI reply
      const aiReply = messages.find((m) => m.senderType === 'ai');
      expect(aiReply).toBeDefined();
      expect(aiReply?.contextCards.length).toBeGreaterThanOrEqual(1);
    });

    it('should create an AI conversation for authenticated customer', async () => {
      const res = await request(app)
        .post('/api/v1/chat/conversations')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          subject: 'Order support',
          mode: 'ai',
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.data.conversation.user._id).toBe(customerId);
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

  describe('Messages and Context Cards (POST & GET /conversations/:id/messages)', () => {
    it('should allow customer to send message with order context card', async () => {
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

      // Verify AI auto-replied and attached order card
      expect(res.body.data.aiReply).toBeDefined();
      expect(res.body.data.aiReply.senderType).toBe('ai');
      expect(res.body.data.aiReply.content).toContain('GS-260914-ABC');
    });

    it('should retrieve paginated messages with populated context cards', async () => {
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

      const res = await request(app)
        .get(`/api/v1/chat/conversations/${conv._id}/messages`)
        .set('Authorization', `Bearer ${customerToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data.messages.length).toBe(1);
      expect(res.body.data.messages[0].content).toBe('Hello assistant');
    });
  });

  describe('Support Escalation and Status Transitions', () => {
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

      // Customer requests handoff -> queued
      const handoffRes = await request(app)
        .post(`/api/v1/chat/conversations/${conv._id}/handoff`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ reason: 'Need human support' });

      expect(handoffRes.statusCode).toBe(200);
      expect(handoffRes.body.data.conversation.status).toBe('queued');

      // Staff can now reply
      const allowedRes = await request(app)
        .post(`/api/v1/chat/conversations/${conv._id}/messages`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ content: 'Hello, I am here to help!' });

      expect(allowedRes.statusCode).toBe(201);
      expect(allowedRes.body.data.message.senderType).toBe('agent');
    });

    it('should escalate conversation to queued when calling /handoff', async () => {
      const conv = await Conversation.create({
        user: customerId,
        mode: 'ai',
        status: 'bot_active',
      });

      const res = await request(app)
        .post(`/api/v1/chat/conversations/${conv._id}/handoff`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ reason: 'Need warranty claim assistance' });

      expect(res.statusCode).toBe(200);
      expect(res.body.data.conversation.status).toBe('queued');
      expect(res.body.data.conversation.mode).toBe('support');
      expect(res.body.data.conversation.handoffReason).toBe(
        'Need warranty claim assistance'
      );
    });

    it('should allow admin to assign conversation', async () => {
      const conv = await Conversation.create({
        user: customerId,
        mode: 'support',
        status: 'queued',
      });

      const res = await request(app)
        .patch(`/api/v1/chat/conversations/${conv._id}/assign`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data.conversation.status).toBe('assigned');
      expect(res.body.data.conversation.assignedAgent._id).toBe(adminId);
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
    it('should merge guest conversations and upgrade message sender to customer', async () => {
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
        .send({ guestId });

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
