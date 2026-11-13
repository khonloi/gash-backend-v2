import { Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { socketAuthMiddleware, AuthenticatedSocket } from './socketAuth.js';
import { registerChatHandlers } from './chatHandler.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

let io: SocketIOServer | null = null;

export const getAllowedOrigins = (): string[] => {
  const configuredOrigins = env.ALLOWED_ORIGINS
    ? env.ALLOWED_ORIGINS.split(',')
        .map((o) => o.trim())
        .filter(Boolean)
    : [];

  return Array.from(
    new Set([
      env.FRONTEND_URL,
      ...(env.NODE_ENV !== 'production'
        ? [
            'http://localhost:3000',
            'http://127.0.0.1:3000',
            'http://localhost:3001',
            'http://127.0.0.1:3001',
          ]
        : []),
      ...configuredOrigins,
    ])
  ).filter(Boolean);
};

export const initSocketServer = (httpServer: HttpServer): SocketIOServer => {
  if (io) return io;

  const allowedOrigins = getAllowedOrigins();

  io = new SocketIOServer(httpServer, {
    cors: {
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        if (env.NODE_ENV !== 'production') {
          return callback(null, true);
        }
        return callback(new Error(`Origin ${origin} not allowed by CORS`));
      },
      credentials: true,
      methods: ['GET', 'POST'],
    },
    transports: ['websocket', 'polling'],
  });

  io.use(socketAuthMiddleware);

  io.on('connection', (socket) => {
    logger.info(
      `Socket connected: id=${socket.id}, role=${socket.data.role}, userId=${socket.data.userId || 'none'}, guestId=${socket.data.guestId || 'none'}`
    );

    registerChatHandlers(io!, socket as AuthenticatedSocket);

    socket.on('disconnect', (reason) => {
      logger.info(`Socket disconnected: id=${socket.id}, reason=${reason}`);
    });
  });

  logger.info('Socket.IO real-time server initialized successfully');
  return io;
};

export const getIO = (): SocketIOServer | null => io;

export const emitToConversation = (
  conversationId: string,
  event: string,
  payload: unknown
): void => {
  if (io) {
    io.to(`conversation:${conversationId}`).emit(event, payload);
  }
};

export const emitToConversationParticipants = (
  conversation: {
    _id: unknown;
    user?: unknown;
    guestId?: string | null;
  },
  event: string,
  payload: unknown
): void => {
  if (!io) return;

  const convId = String(conversation._id);
  let target = io.to(`conversation:${convId}`).to('support:agents');

  if (conversation.user) {
    const rawUser = conversation.user as { _id?: unknown };
    const userId = rawUser._id
      ? String(rawUser._id)
      : String(conversation.user);
    if (userId) {
      target = target.to(`user:${userId}`);
    }
  }

  if (conversation.guestId) {
    target = target.to(`guest:${conversation.guestId}`);
  }

  target.emit(event, payload);
};

export const emitToSupportAgents = (event: string, payload: unknown): void => {
  if (io) {
    io.to('support:agents').emit(event, payload);
  }
};

export const closeSocketServer = async (): Promise<void> => {
  if (io) {
    logger.info('Closing Socket.IO server...');
    await new Promise<void>((resolve) => {
      io!.close(() => {
        io = null;
        resolve();
      });
    });
    logger.info('Socket.IO server closed.');
  }
};
