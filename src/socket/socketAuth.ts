import { Socket } from 'socket.io';
import { verifyUserFromToken } from '../middlewares/auth.js';
import { IUser, UserRole } from '../types/index.js';
import { logger } from '../config/logger.js';

export interface AuthenticatedSocket extends Socket {
  data: {
    user?: IUser;
    userId?: string;
    guestId?: string;
    role: UserRole | 'guest';
  };
}

export const socketAuthMiddleware = async (
  socket: Socket,
  next: (err?: Error) => void
): Promise<void> => {
  try {
    const authHeader =
      socket.handshake.auth?.token || socket.handshake.headers?.authorization;

    let token: string | undefined;
    if (typeof authHeader === 'string') {
      token = authHeader.startsWith('Bearer ')
        ? authHeader.slice(7).trim()
        : authHeader.trim();
    }

    if (token) {
      try {
        const user = await verifyUserFromToken(token);
        socket.data.user = user;
        socket.data.userId = user._id.toString();
        socket.data.role = user.role;
        return next();
      } catch (authErr) {
        logger.warn('Socket token verification failed:', authErr);
      }
    }

    // Check for guest ID
    const guestIdRaw =
      socket.handshake.auth?.guestId ||
      socket.handshake.headers?.['x-guest-id'];

    const guestId = Array.isArray(guestIdRaw)
      ? guestIdRaw[0]
      : typeof guestIdRaw === 'string'
        ? guestIdRaw.trim()
        : undefined;

    if (guestId && guestId.length >= 8 && guestId.length <= 128) {
      socket.data.guestId = guestId;
      socket.data.role = 'guest';
      return next();
    }

    return next(
      new Error(
        'Authentication required. Please provide a valid Bearer token or guestId.'
      )
    );
  } catch (err) {
    logger.error('Unexpected socket authentication error:', err);
    return next(
      new Error('Internal server error during socket authentication')
    );
  }
};
