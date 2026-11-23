import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      id?: string;
    }
  }
}

const SAFE_REQUEST_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * Middleware that assigns a correlation ID (`req.id`) to every request
 * and sets the `X-Request-Id` response header.
 *
 * If the client provided a safe `X-Request-Id` header, it is reused;
 * otherwise a new UUID v4 is generated.
 */
export const requestId = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const incomingId = req.headers['x-request-id'];
  const trimmed = typeof incomingId === 'string' ? incomingId.trim() : '';
  const id = SAFE_REQUEST_ID_REGEX.test(trimmed) ? trimmed : randomUUID();

  req.id = id;
  res.setHeader('X-Request-Id', id);
  next();
};
