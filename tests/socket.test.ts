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
import { signGuestToken } from '../src/utils/guestToken.js';

let mongoServer: MongoMemoryServer;
let httpServer: http.Server;
let port: number;
let customerToken: string;
let customerId: string;
const guestId = 'guest-socket-test-12345678';
const guestToken = signGuestToken(guestId);

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

  it('should successfully connect with signed guestToken and reject unsigned guestId', (done) => {
    const badClient: ClientSocket = ioClient(`http://localhost:${port}`, {
      auth: { guestId },
      transports: ['websocket'],
    });

    badClient.on('connect_error', (err) => {
      expect(err.message).toContain('Authentication required');
      badClient.disconnect();

      const goodClient: ClientSocket = ioClient(`http://localhost:${port}`, {
        auth: { guestToken },
        transports: ['websocket'],
      });
      goodClient.on('connect', () => {
        expect(goodClient.connected).toBe(true);
        goodClient.disconnect();
        done();
      });
    });
  });

  it('should reject invalid JWT token instead of silently downgrading to guest', (done) => {
    const client: ClientSocket = ioClient(`http://localhost:${port}`, {
      auth: { token: 'invalid.jwt.token', guestToken },
      transports: ['websocket'],
    });

    client.on('connect_error', (err) => {
      expect(err.message).toContain('Invalid or expired authentication token');
      client.disconnect();
      done();
    });
  });

  it('should reject connection when no auth or guestToken is provided', (done) => {
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

    const joinResult = await new Promise<{ success: boolean }>((resolve) => {
      client.emit(
        'chat:join',
        { conversationId: conv._id.toString() },
        (res: { success: boolean }) => resolve(res)
      );
    });
    expect(joinResult.success).toBe(true);

    const messagePromise = new Promise<{ message: { content: string } }>(
      (resolve) => {
        client.on('chat:message', (data: { message: { content: string } }) => {
          resolve(data);
        });
      }
    );

    client.emit('chat:send_message', {
      conversationId: conv._id.toString(),
      content: 'Hello via WebSocket!',
    });

    const received = await messagePromise;
    expect(received.message.content).toBe('Hello via WebSocket!');

    client.disconnect();
  });

  it('should generate exactly one AI reply over WebSocket in bot_active mode and isolate from support:agents', async () => {
    const agent = await User.create({
      firstName: 'Agent',
      lastName: 'Observer',
      email: 'agent.observer@example.com',
      password: 'Password123!',
      role: 'admin',
    });
    const agentToken = signAccessToken(agent._id.toString(), 'admin');

    const conv = await Conversation.create({
      user: customerId,
      mode: 'ai',
      status: 'bot_active',
    });

    const client: ClientSocket = ioClient(`http://localhost:${port}`, {
      auth: { token: customerToken },
      transports: ['websocket'],
    });
    const agentClient: ClientSocket = ioClient(`http://localhost:${port}`, {
      auth: { token: agentToken },
      transports: ['websocket'],
    });

    await Promise.all([
      new Promise<void>((resolve) => client.on('connect', resolve)),
      new Promise<void>((resolve) => agentClient.on('connect', resolve)),
    ]);

    let agentReceivedPrivateAiMsg = false;
    agentClient.on('chat:message', () => {
      agentReceivedPrivateAiMsg = true;
    });

    const ack = await new Promise<{
      success: boolean;
      data?: { message: unknown; aiReply?: unknown };
    }>((resolve) => {
      client.emit(
        'chat:send_message',
        {
          conversationId: conv._id.toString(),
          content: 'Hello AI assistant!',
        },
        (res: {
          success: boolean;
          data?: { message: unknown; aiReply?: unknown };
        }) => resolve(res)
      );
    });

    expect(ack.success).toBe(true);
    expect(ack.data?.aiReply).toBeDefined();

    // Wait briefly to confirm no second duplicate AI reply is persisted or leaked to support:agents
    await new Promise((r) => setTimeout(r, 100));
    const dbMessages = await Message.find({ conversation: conv._id });
    expect(dbMessages).toHaveLength(2); // 1 customer + 1 AI reply
    expect(agentReceivedPrivateAiMsg).toBe(false);

    client.disconnect();
    agentClient.disconnect();
  });

  it('should ignore chat:typing from sockets not in the target conversation room', async () => {
    const otherUser = await User.create({
      firstName: 'Other',
      lastName: 'User',
      email: 'other.typing@example.com',
      password: 'Password123!',
      role: 'customer',
    });
    const otherToken = signAccessToken(otherUser._id.toString(), 'customer');

    const conv = await Conversation.create({
      user: customerId,
      mode: 'support',
      status: 'queued',
    });

    const victimClient: ClientSocket = ioClient(`http://localhost:${port}`, {
      auth: { token: customerToken },
      transports: ['websocket'],
    });
    const attackerClient: ClientSocket = ioClient(`http://localhost:${port}`, {
      auth: { token: otherToken },
      transports: ['websocket'],
    });

    await Promise.all([
      new Promise<void>((resolve) => victimClient.on('connect', resolve)),
      new Promise<void>((resolve) => attackerClient.on('connect', resolve)),
    ]);

    let typingReceived = false;
    victimClient.on('chat:typing', () => {
      typingReceived = true;
    });

    attackerClient.emit('chat:typing', {
      conversationId: conv._id.toString(),
      isTyping: true,
    });

    await new Promise((r) => setTimeout(r, 100));
    expect(typingReceived).toBe(false);

    victimClient.disconnect();
    attackerClient.disconnect();
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

  it('should support cookie guest auth, chat:leave, chat:typing, chat:mark_read, chat:handoff, and rate limits', async () => {
    const agent = await User.create({
      firstName: 'Handler',
      lastName: 'Agent',
      email: 'handler.agent@example.com',
      password: 'Password123!',
      role: 'seller',
    });
    const agentToken = signAccessToken(agent._id.toString(), 'seller');

    const conv = await Conversation.create({
      user: customerId,
      mode: 'ai',
      status: 'bot_active',
    });

    const { createGuestSession } = await import('../src/utils/guestToken.js');
    const guestSession = createGuestSession();

    const guestCookieClient: ClientSocket = ioClient(
      `http://localhost:${port}`,
      {
        extraHeaders: {
          cookie: `gash_guest=${encodeURIComponent(guestSession.guestToken)}`,
        },
        transports: ['websocket'],
      }
    );

    const customerClient: ClientSocket = ioClient(`http://localhost:${port}`, {
      auth: { token: customerToken },
      transports: ['websocket'],
    });

    const agentClient: ClientSocket = ioClient(`http://localhost:${port}`, {
      auth: { token: agentToken },
      transports: ['websocket'],
    });

    await Promise.all([
      new Promise<void>((resolve) => guestCookieClient.on('connect', resolve)),
      new Promise<void>((resolve) => customerClient.on('connect', resolve)),
      new Promise<void>((resolve) => agentClient.on('connect', resolve)),
    ]);

    // Invalid conversationId and missing conversation join errors
    const badJoinRes = await new Promise<{ success: boolean; error?: string }>(
      (resolve) => {
        customerClient.emit(
          'chat:join',
          { conversationId: 'invalid' },
          resolve
        );
      }
    );
    expect(badJoinRes.success).toBe(false);

    const missingJoinRes = await new Promise<{
      success: boolean;
      error?: string;
    }>((resolve) => {
      customerClient.emit(
        'chat:join',
        { conversationId: new mongoose.Types.ObjectId().toString() },
        resolve
      );
    });
    expect(missingJoinRes.success).toBe(false);
    expect(missingJoinRes.error).toMatch(/not found/i);

    // Join conversation and test chat:typing from joined room
    const joinRes = await new Promise<{ success: boolean }>((resolve) => {
      customerClient.emit(
        'chat:join',
        { conversationId: conv._id.toString() },
        resolve
      );
    });
    expect(joinRes.success).toBe(true);

    // Request handoff via socket so agent joins queue and gets queue update
    const queueEvtPromise = new Promise<{
      conversationId: string;
      status: string;
    }>((resolve) => {
      agentClient.on('support:queue_updated', resolve);
    });
    const handoffAck = await new Promise<{ success: boolean; error?: string }>(
      (resolve) => {
        customerClient.emit(
          'chat:handoff',
          { conversationId: conv._id.toString(), reason: 'Need sizing help' },
          resolve
        );
      }
    );
    expect(handoffAck.success).toBe(true);
    const queueEvt = await queueEvtPromise;
    expect(queueEvt.status).toBe('queued');

    // Invalid handoff payload error callback
    const badHandoffAck = await new Promise<{
      success: boolean;
      error?: string;
    }>((resolve) => {
      customerClient.emit('chat:handoff', { conversationId: 'bad' }, resolve);
    });
    expect(badHandoffAck.success).toBe(false);

    // Agent joins and observes typing + read receipt
    await new Promise<{ success: boolean }>((resolve) => {
      agentClient.emit(
        'chat:join',
        { conversationId: conv._id.toString() },
        resolve
      );
    });

    const typingPromise = new Promise<{ isTyping: boolean }>((resolve) => {
      agentClient.on('chat:typing', resolve);
    });
    customerClient.emit('chat:typing', {
      conversationId: conv._id.toString(),
      isTyping: true,
    });
    expect((await typingPromise).isTyping).toBe(true);

    const readReceiptPromise = new Promise<{ readerRole: string }>(
      (resolve) => {
        customerClient.on('chat:read_receipt', resolve);
      }
    );
    agentClient.emit('chat:mark_read', { conversationId: conv._id.toString() });
    expect((await readReceiptPromise).readerRole).toBe('seller');

    // chat:leave removes room membership so typing no longer relays
    agentClient.emit('chat:leave', { conversationId: conv._id.toString() });
    await new Promise((r) => setTimeout(r, 50));

    // Invalid send_message payload callback
    const invalidSendAck = await new Promise<{
      success: boolean;
      error?: string;
    }>((resolve) => {
      customerClient.emit(
        'chat:send_message',
        { conversationId: conv._id.toString(), content: '' },
        resolve
      );
    });
    expect(invalidSendAck.success).toBe(false);

    // Invalid mark_read payload is ignored gracefully
    customerClient.emit('chat:mark_read', { conversationId: 'invalid-id' });

    // AI conversation auto-escalation via chat:send_message emits chat:handoff_occurred (on fresh user to respect unique active support index)
    const escUser = await User.create({
      firstName: 'Escalate',
      lastName: 'User',
      email: 'esc.socket@example.com',
      password: 'Password123!',
      role: 'customer',
    });
    const escToken = signAccessToken(escUser._id.toString(), 'customer');
    const escClient: ClientSocket = ioClient(`http://localhost:${port}`, {
      auth: { token: escToken },
      transports: ['websocket'],
    });
    await new Promise<void>((resolve) => escClient.on('connect', resolve));

    const aiConv = await Conversation.create({
      user: escUser._id,
      mode: 'ai',
      status: 'bot_active',
    });
    await new Promise<{ success: boolean }>((resolve) => {
      escClient.emit(
        'chat:join',
        { conversationId: aiConv._id.toString() },
        resolve
      );
    });
    const autoHandoffPromise = new Promise<{ status: string }>((resolve) => {
      escClient.on('chat:handoff_occurred', resolve);
    });
    const escalateSendAck = await new Promise<{ success: boolean }>(
      (resolve) => {
        escClient.emit(
          'chat:send_message',
          {
            conversationId: aiConv._id.toString(),
            content: 'Please connect me with a live agent',
          },
          resolve
        );
      }
    );
    expect(escalateSendAck.success).toBe(true);
    expect((await autoHandoffPromise).status).toBe('queued');
    escClient.disconnect();

    // Per-socket sliding window rate limit triggers after 20 messages
    let rateLimitedError: string | undefined;
    for (let i = 0; i < 22; i++) {
      const ack = await new Promise<{ success: boolean; error?: string }>(
        (resolve) => {
          customerClient.emit(
            'chat:send_message',
            { conversationId: conv._id.toString(), content: `Msg ${i}` },
            resolve
          );
        }
      );
      if (!ack.success && ack.error?.includes('Rate limit')) {
        rateLimitedError = ack.error;
        break;
      }
    }
    expect(rateLimitedError).toMatch(/Rate limit exceeded/i);

    guestCookieClient.disconnect();
    customerClient.disconnect();
    agentClient.disconnect();
  });
});
