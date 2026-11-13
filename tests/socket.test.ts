import http from 'http';
import { AddressInfo } from 'net';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import app from '../src/app.js';
import { initSocketServer, closeSocketServer } from '../src/socket/index.js';
import { Conversation } from '../src/models/Conversation.js';
import { Message } from '../src/models/Message.js';
import { User } from '../src/models/User.js';
import { signAccessToken } from '../src/utils/jwt.js';

let mongoServer: MongoMemoryServer;
let httpServer: http.Server;
let port: number;
let customerToken: string;
let customerId: string;
const guestId = 'guest-socket-test-12345678';

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);

  httpServer = http.createServer(app);
  initSocketServer(httpServer);

  await new Promise<void>((resolve) => {
    httpServer.listen(0, () => {
      port = (httpServer.address() as AddressInfo).port;
      resolve();
    });
  });
});

afterAll(async () => {
  await closeSocketServer();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await Conversation.deleteMany({});
  await Message.deleteMany({});
  await User.deleteMany({});

  const customer = await User.create({
    firstName: 'Socket',
    lastName: 'Tester',
    email: 'socket.tester@example.com',
    password: 'Password123!',
    role: 'customer',
  });
  customerId = customer._id.toString();
  customerToken = signAccessToken(customerId, 'customer');
});

describe('Socket.IO Real-Time Chat Integration Tests', () => {
  it('should successfully connect with valid JWT token', (done) => {
    const client: ClientSocket = ioClient(`http://localhost:${port}`, {
      auth: { token: customerToken },
      transports: ['websocket'],
    });

    client.on('connect', () => {
      expect(client.connected).toBe(true);
      client.disconnect();
      done();
    });
  });

  it('should successfully connect with valid guestId', (done) => {
    const client: ClientSocket = ioClient(`http://localhost:${port}`, {
      auth: { guestId },
      transports: ['websocket'],
    });

    client.on('connect', () => {
      expect(client.connected).toBe(true);
      client.disconnect();
      done();
    });
  });

  it('should reject connection when no auth or guestId is provided', (done) => {
    const client: ClientSocket = ioClient(`http://localhost:${port}`, {
      transports: ['websocket'],
    });

    client.on('connect_error', (err) => {
      expect(err.message).toContain('Authentication required');
      client.disconnect();
      done();
    });
  });

  it('should allow joining a conversation and sending a real-time message', async () => {
    const conv = await Conversation.create({
      user: customerId,
      mode: 'support',
      status: 'queued',
    });

    const client: ClientSocket = ioClient(`http://localhost:${port}`, {
      auth: { token: customerToken },
      transports: ['websocket'],
    });

    await new Promise<void>((resolve) => client.on('connect', resolve));

    // Join conversation
    const joinResult = await new Promise<{ success: boolean }>((resolve) => {
      client.emit(
        'chat:join',
        { conversationId: conv._id.toString() },
        (res: { success: boolean }) => resolve(res)
      );
    });
    expect(joinResult.success).toBe(true);

    // Listen for chat:message
    const messagePromise = new Promise<{ message: { content: string } }>(
      (resolve) => {
        client.on('chat:message', (data: { message: { content: string } }) => {
          resolve(data);
        });
      }
    );

    // Send message via socket
    client.emit('chat:send_message', {
      conversationId: conv._id.toString(),
      content: 'Hello via WebSocket!',
    });

    const received = await messagePromise;
    expect(received.message.content).toBe('Hello via WebSocket!');

    client.disconnect();
  });

  it('should broadcast chat:assigned, chat:status_updated, and support:queue_updated via REST triggers', async () => {
    const agent = await User.create({
      firstName: 'Support',
      lastName: 'Agent',
      email: 'socket.agent@example.com',
      password: 'Password123!',
      role: 'seller',
    });
    const agentToken = signAccessToken(agent._id.toString(), 'seller');

    const conv = await Conversation.create({
      user: customerId,
      mode: 'support',
      status: 'queued',
    });

    const customerClient: ClientSocket = ioClient(`http://localhost:${port}`, {
      auth: { token: customerToken },
      transports: ['websocket'],
    });
    const agentClient: ClientSocket = ioClient(`http://localhost:${port}`, {
      auth: { token: agentToken },
      transports: ['websocket'],
    });

    await Promise.all([
      new Promise<void>((resolve) => customerClient.on('connect', resolve)),
      new Promise<void>((resolve) => agentClient.on('connect', resolve)),
    ]);

    await new Promise<{ success: boolean }>((resolve) => {
      customerClient.emit(
        'chat:join',
        { conversationId: conv._id.toString() },
        (res: { success: boolean }) => resolve(res)
      );
    });

    const assignedPromise = new Promise<{
      status?: string;
      conversationId: string;
    }>((resolve) => {
      customerClient.on('chat:assigned', (data) => resolve(data));
    });
    const queueUpdatedPromise = new Promise<{
      status?: string;
      conversationId: string;
    }>((resolve) => {
      agentClient.on('support:queue_updated', (data) => resolve(data));
    });

    const request = (await import('supertest')).default;
    const assignRes = await request(app)
      .patch(`/api/v1/chat/conversations/${conv._id}/assign`)
      .set('Authorization', `Bearer ${agentToken}`);

    expect(assignRes.statusCode).toBe(200);
    const assignedEvt = await assignedPromise;
    const queueEvt = await queueUpdatedPromise;

    expect(assignedEvt.conversationId).toBe(conv._id.toString());
    expect(assignedEvt.status).toBe('assigned');
    expect(queueEvt.conversationId).toBe(conv._id.toString());

    const statusUpdatedPromise = new Promise<{
      status: string;
      conversationId: string;
    }>((resolve) => {
      customerClient.on('chat:status_updated', (data) => resolve(data));
    });

    const statusRes = await request(app)
      .patch(`/api/v1/chat/conversations/${conv._id}/status`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ status: 'resolved' });

    expect(statusRes.statusCode).toBe(200);
    const statusEvt = await statusUpdatedPromise;
    expect(statusEvt.status).toBe('resolved');

    customerClient.disconnect();
    agentClient.disconnect();
  });
});
