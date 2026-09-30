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

/**
 * Middleware that assigns a correlation ID (`req.id`) to every request
 * and sets the `X-Request-Id` response header.
 *
 * If the client provided an `X-Request-Id` header, it is sanitized and reused;
 * otherwise a new UUID v4 is generated.
 */
export const requestId = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const incomingId = req.headers['x-request-id'];
  const id =
    typeof incomingId === 'string' && incomingId.trim().length > 0
      ? incomingId.trim()
      : randomUUID();

  req.id = id;
  res.setHeader('X-Request-Id', id);
  next();
};
