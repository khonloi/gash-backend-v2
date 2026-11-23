import crypto from 'crypto';
import { Request, Response } from 'express';
import { env } from '../config/env.js';
import { getCookie } from './cookies.js';

export const GUEST_COOKIE_NAME = 'gash_guest';
const GUEST_TOKEN_PREFIX = 'gst.';
const GUEST_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function computeGuestSignature(guestId: string): string {
  return crypto
    .createHmac('sha256', `${env.JWT_SECRET}:guest-session-v1`)
    .update(guestId)
    .digest('base64url');
}

/**
 * Signs a guestId into an opaque, tamper-proof guest token (`gst.<guestId>.<sig>`).
 */
export function signGuestToken(guestId: string): string {
  const cleanId = guestId.trim();
  const sig = computeGuestSignature(cleanId);
  return `${GUEST_TOKEN_PREFIX}${cleanId}.${sig}`;
}

/**
 * Generates a fresh guestId and signed guestToken.
 */
export function createGuestSession(): { guestId: string; guestToken: string } {
  const guestId = `guest_${crypto.randomUUID()}`;
  return {
    guestId,
    guestToken: signGuestToken(guestId),
  };
}

/**
 * Verifies a signed guest token using constant-time comparison and returns the guestId,
 * or undefined if invalid/tampered.
 */
export function verifyGuestToken(
  token: string | undefined | null
): string | undefined {
  if (!token || typeof token !== 'string') return undefined;
  const trimmed = token.trim();
  if (!trimmed.startsWith(GUEST_TOKEN_PREFIX)) return undefined;

  const rest = trimmed.slice(GUEST_TOKEN_PREFIX.length);
  const dotIdx = rest.lastIndexOf('.');
  if (dotIdx <= 0) return undefined;

  const guestId = rest.slice(0, dotIdx);
  const providedSig = rest.slice(dotIdx + 1);

  if (guestId.length < 8 || guestId.length > 128 || !providedSig) {
    return undefined;
  }

  const expectedSig = computeGuestSignature(guestId);
  const providedBuf = Buffer.from(providedSig, 'utf8');
  const expectedBuf = Buffer.from(expectedSig, 'utf8');

  if (providedBuf.length !== expectedBuf.length) {
    return undefined;
  }

  if (!crypto.timingSafeEqual(providedBuf, expectedBuf)) {
    return undefined;
  }

  return guestId;
}

export function extractGuestTokenFromRequest(req: Request): string | undefined {
  const headerToken = req.headers['x-guest-token'];
  if (typeof headerToken === 'string' && headerToken.trim()) {
    return headerToken.trim();
  }
  if (Array.isArray(headerToken) && headerToken[0]?.trim()) {
    return headerToken[0].trim();
  }
  const cookieToken = getCookie(req, GUEST_COOKIE_NAME);
  if (cookieToken) {
    return cookieToken;
  }
  // Support signed token passed via x-guest-id for unified client header handling
  const legacyHeader = req.headers['x-guest-id'];
  if (
    typeof legacyHeader === 'string' &&
    legacyHeader.trim().startsWith(GUEST_TOKEN_PREFIX)
  ) {
    return legacyHeader.trim();
  }
  return undefined;
}

export function setGuestTokenCookie(res: Response, guestToken: string): void {
  res.cookie(GUEST_COOKIE_NAME, guestToken, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: GUEST_SESSION_TTL_MS,
    path: '/api/v1/chat',
  });
}

export function clearGuestTokenCookie(res: Response): void {
  res.clearCookie(GUEST_COOKIE_NAME, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/v1/chat',
  });
}

export function maskGuestId(guestId?: string | null): string {
  if (!guestId) return 'none';
  if (guestId.length <= 8) return '***';
  return `${guestId.slice(0, 6)}...${guestId.slice(-4)}`;
}
