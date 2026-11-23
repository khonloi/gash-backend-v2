import { Socket } from 'socket.io';
import { verifyUserFromToken } from '../middlewares/auth.js';
import { IUser, UserRole } from '../types/index.js';
import { logger } from '../config/logger.js';
import { GUEST_COOKIE_NAME, verifyGuestToken } from '../utils/guestToken.js';

export interface SocketData {
  user?: IUser;
  userId?: string;
  guestId?: string;
  role: UserRole | 'guest';
}

export interface AuthenticatedSocket extends Socket {
  data: SocketData;
}

function parseCookieFromHandshake(
  cookieHeader: string | undefined,
  name: string
): string | undefined {
  if (!cookieHeader) return undefined;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]*)`));
  if (!match) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
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
      token = /^Bearer\s+(\S+)$/i.test(authHeader.trim())
        ? authHeader.trim().replace(/^Bearer\s+/i, '')
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
        // Do not silently downgrade an explicitly invalid/expired JWT to guest
        return next(new Error('Invalid or expired authentication token.'));
      }
    }

    const rawGuestToken =
      (typeof socket.handshake.auth?.guestToken === 'string'
        ? socket.handshake.auth.guestToken
        : undefined) ||
      (typeof socket.handshake.headers?.['x-guest-token'] === 'string'
        ? socket.handshake.headers['x-guest-token']
        : undefined) ||
      parseCookieFromHandshake(
        socket.handshake.headers?.cookie,
        GUEST_COOKIE_NAME
      );

    const guestId = verifyGuestToken(rawGuestToken);
    if (guestId) {
      socket.data.guestId = guestId;
      socket.data.role = 'guest';
      return next();
    }

    return next(
      new Error(
        'Authentication required. Please provide a valid Bearer token or signed guestToken.'
      )
    );
  } catch (err) {
    logger.error('Unexpected socket authentication error:', err);
    return next(
      new Error('Internal server error during socket authentication')
    );
  }
};
