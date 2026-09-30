import crypto from 'crypto';
import jwt, { SignOptions } from 'jsonwebtoken';
import { TokenPayload, UserRole } from '../types/index.js';
import { AppError } from './AppError.js';
import { env } from '../config/env.js';

/**
 * Generate short-lived access token (default 15m)
 */
export const signAccessToken = (
  userId: string,
  role: UserRole = 'customer'
): string => {
  const expiresIn = env.JWT_ACCESS_EXPIRES_IN as SignOptions['expiresIn'];

  return jwt.sign({ id: userId, role, type: 'access' }, env.JWT_SECRET, {
    expiresIn,
  });
};

/**
 * Generate long-lived refresh token (default 7d) with unique jti claim
 */
export const signRefreshToken = (userId: string): string => {
  const expiresIn = env.JWT_REFRESH_EXPIRES_IN as SignOptions['expiresIn'];

  return jwt.sign(
    { id: userId, type: 'refresh', jti: crypto.randomUUID() },
    env.JWT_SECRET,
    {
      expiresIn,
    }
  );
};

/**
 * Verify token and return decoded payload
 */
export const verifyToken = (token: string): TokenPayload => {
  try {
    return jwt.verify(token, env.JWT_SECRET) as TokenPayload;
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'TokenExpiredError') {
      throw new AppError('Your token has expired. Please log in again.', 401);
    }
    throw new AppError('Invalid token. Please log in again.', 401);
  }
};
