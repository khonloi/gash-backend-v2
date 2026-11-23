import crypto from 'crypto';
import jwt, { SignOptions } from 'jsonwebtoken';
import { TokenPayload, UserRole } from '../types/index.js';
import { AppError } from './AppError.js';
import { env } from '../config/env.js';

const JWT_ISSUER = 'gash-backend';
const JWT_AUDIENCE = 'gash-api';

const getRefreshSecret = (): string => env.JWT_REFRESH_SECRET || env.JWT_SECRET;

/**
 * Generate short-lived access token (default 15m)
 */
export const signAccessToken = (
  userId: string,
  role: UserRole = 'customer',
  tokenVersion = 0
): string => {
  const expiresIn = env.JWT_ACCESS_EXPIRES_IN as SignOptions['expiresIn'];

  return jwt.sign(
    { id: userId, role, type: 'access', tokenVersion },
    env.JWT_SECRET,
    {
      expiresIn,
      algorithm: 'HS256',
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    }
  );
};

/**
 * Generate long-lived refresh token (default 7d) with unique jti claim
 */
export const signRefreshToken = (userId: string, tokenVersion = 0): string => {
  const expiresIn = env.JWT_REFRESH_EXPIRES_IN as SignOptions['expiresIn'];

  return jwt.sign(
    { id: userId, type: 'refresh', jti: crypto.randomUUID(), tokenVersion },
    getRefreshSecret(),
    {
      expiresIn,
      algorithm: 'HS256',
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    }
  );
};

/**
 * Verify token and return validated decoded payload
 */
export const verifyToken = (
  token: string,
  expectedType: 'access' | 'refresh' = 'access'
): TokenPayload => {
  try {
    const secret =
      expectedType === 'refresh' ? getRefreshSecret() : env.JWT_SECRET;
    const decoded = jwt.verify(token, secret, {
      algorithms: ['HS256'],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });

    if (
      typeof decoded !== 'object' ||
      decoded === null ||
      typeof (decoded as TokenPayload).id !== 'string' ||
      !(decoded as TokenPayload).id
    ) {
      throw new AppError('Invalid token. Please log in again.', 401);
    }

    return decoded as TokenPayload;
  } catch (error: unknown) {
    if (error instanceof AppError) {
      throw error;
    }
    if (error instanceof Error && error.name === 'TokenExpiredError') {
      throw new AppError('Your token has expired. Please log in again.', 401);
    }
    throw new AppError('Invalid token. Please log in again.', 401);
  }
};
