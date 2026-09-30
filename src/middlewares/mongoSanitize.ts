import { Request, Response, NextFunction } from 'express';
import mongoSanitize from 'express-mongo-sanitize';

/**
 * Recursively strips any keys that start with '$' or contain '.' from an object or array in-place.
 * Modifies the object directly without reassigning parent references (critical for Express 5 req.query).
 */
export const sanitizeInPlace = (target: unknown): void => {
  if (Array.isArray(target)) {
    for (let i = 0; i < target.length; i++) {
      if (typeof target[i] === 'object' && target[i] !== null) {
        sanitizeInPlace(target[i]);
      }
    }
  } else if (typeof target === 'object' && target !== null) {
    const record = target as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (key.startsWith('$') || key.includes('.')) {
        delete record[key];
      } else if (typeof record[key] === 'object' && record[key] !== null) {
        sanitizeInPlace(record[key]);
      }
    }
  }
};

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
    sanitizeInPlace(req.query);
  }
  next();
};
