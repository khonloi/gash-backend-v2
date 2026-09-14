import crypto from 'crypto';
import jwt, { SignOptions } from 'jsonwebtoken';
import { TokenPayload, UserRole } from '../types/index.js';
import { AppError } from './AppError.js';

const getJwtSecret = (): string => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not configured in environment variables');
  }
  return secret;
};

/**
 * Generate short-lived access token (default 15m)
 */
export const signAccessToken = (
  userId: string,
  role: UserRole = 'customer'
): string => {
  const secret = getJwtSecret();
  const expiresIn = (process.env.JWT_ACCESS_EXPIRES_IN ||
    '15m') as SignOptions['expiresIn'];

  return jwt.sign({ id: userId, role, type: 'access' }, secret, {
    expiresIn,
  });
};

/**
 * Generate long-lived refresh token (default 7d) with unique jti claim
 */
export const signRefreshToken = (userId: string): string => {
  const secret = getJwtSecret();
  const expiresIn = (process.env.JWT_REFRESH_EXPIRES_IN ||
    '7d') as SignOptions['expiresIn'];

  return jwt.sign(
    { id: userId, type: 'refresh', jti: crypto.randomUUID() },
    secret,
    {
      expiresIn,
    }
  );
};

/**
 * Verify token and return decoded payload
 */
export const verifyToken = (token: string): TokenPayload => {
  const secret = getJwtSecret();
  try {
    return jwt.verify(token, secret) as TokenPayload;
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      throw new AppError('Your token has expired. Please log in again.', 401);
    }
    throw new AppError('Invalid token. Please log in again.', 401);
  }
};
