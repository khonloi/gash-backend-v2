import { Request, Response } from 'express';
import { env } from '../config/env.js';
import { REFRESH_TOKEN_EXPIRES_MS } from '../config/constants.js';

export const REFRESH_COOKIE_NAME = 'refreshToken';

/**
 * Extracts a cookie value by name from the raw Cookie header of an incoming HTTP request.
 */
export function getCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : undefined;
}

/**
 * Sets an HttpOnly, Secure, SameSite=Lax cookie containing the refresh token.
 */
export function setRefreshTokenCookie(
  res: Response,
  refreshToken: string
): void {
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: REFRESH_TOKEN_EXPIRES_MS,
    path: '/',
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
    path: '/',
  });
}
