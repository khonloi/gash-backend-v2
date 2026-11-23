import { Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import {
  socketAuthMiddleware,
  AuthenticatedSocket,
  SocketData,
} from './socketAuth.js';
import { registerChatHandlers } from './chatHandler.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { maskGuestId } from '../utils/guestToken.js';
import { resolveOwnerId } from '../utils/resolveOwnerId.js';

export type TypedIOServer = SocketIOServer<
  Record<string, (...args: never[]) => void>,
  Record<string, (...args: never[]) => void>,
  Record<string, never>,
  SocketData
>;

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
    maxHttpBufferSize: 16 * 1024, // 16 KB max WebSocket frame payload
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
      `Socket connected: id=${socket.id}, role=${socket.data.role}, userId=${socket.data.userId || 'none'}, guest=${maskGuestId(socket.data.guestId)}`
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
    status?: string;
    mode?: string;
  },
  event: string,
  payload: unknown
): void => {
  if (!io) return;

  const convId = String(conversation._id);
  let target = io.to(`conversation:${convId}`);

  // Keep private bot_active AI chats isolated from support:agents
  if (conversation.status !== 'bot_active') {
    target = target.to('support:agents');
  }

  const userId = resolveOwnerId(
    conversation.user as Parameters<typeof resolveOwnerId>[0]
  );
  if (userId) {
    target = target.to(`user:${userId}`);
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

export const evictGuestFromRooms = (
  guestId: string,
  conversationIds: string[]
): void => {
  if (!io) return;
  const guestRoom = `guest:${guestId}`;
  for (const convId of conversationIds) {
    io.in(guestRoom).socketsLeave(`conversation:${convId}`);
  }
  io.in(guestRoom).socketsLeave(guestRoom);
};

export const closeSocketServer = async (): Promise<void> => {
  if (io) {
    logger.info('Closing Socket.IO server...');
    const instance = io;
    io = null;
    instance.disconnectSockets(true);
    await new Promise<void>((resolve) => {
      instance.close(() => {
        resolve();
      });
    });
    logger.info('Socket.IO server closed.');
  }
};
