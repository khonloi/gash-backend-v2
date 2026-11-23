import { Request, Response } from 'express';
import { env } from '../config/env.js';
import {
  parseDurationToMs,
  REFRESH_TOKEN_EXPIRES_MS,
} from '../config/constants.js';

export const REFRESH_COOKIE_NAME = 'refreshToken';
const REFRESH_COOKIE_PATH = '/api/v1/auth';

/**
 * Extracts a cookie value by name from the raw Cookie header of an incoming HTTP request.
 */
export function getCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = header.match(new RegExp(`(?:^|;\\s*)${escapedName}=([^;]*)`));
  if (!match) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
}

/**
 * Sets an HttpOnly, Secure, SameSite=Lax cookie containing the refresh token,
 * scoped strictly to auth routes.
 */
export function setRefreshTokenCookie(
  res: Response,
  refreshToken: string
): void {
  const maxAge = parseDurationToMs(
    env.JWT_REFRESH_EXPIRES_IN,
    REFRESH_TOKEN_EXPIRES_MS
  );
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge,
    path: REFRESH_COOKIE_PATH,
  });
}

/**
 * Clears the HttpOnly refresh token cookie on user logout or session expiration.
 */
export function clearRefreshTokenCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: REFRESH_COOKIE_PATH,
  });
}
