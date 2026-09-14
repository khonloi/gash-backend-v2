import { Request, Response, NextFunction } from 'express';
import mongoSanitize from 'express-mongo-sanitize';

/**
 * Express 5 compatible middleware for NoSQL injection sanitization.
 * In Express 5, req.query is a getter and cannot be directly reassigned.
 */
export const sanitizeData = (
  req: Request,
  _res: Response,
  next: NextFunction
): void => {
  if (req.body) {
    req.body = mongoSanitize.sanitize(req.body);
  }
  if (req.params) {
    req.params = mongoSanitize.sanitize(req.params);
  }
  if (req.query) {
    for (const key of Object.keys(req.query)) {
      if (key.startsWith('$') || key.includes('.')) {
        delete (req.query as Record<string, unknown>)[key];
      } else if (
        typeof req.query[key] === 'object' &&
        req.query[key] !== null
      ) {
        (req.query as Record<string, unknown>)[key] = mongoSanitize.sanitize(
          req.query[key]
        );
      }
    }
  }
  next();
};
