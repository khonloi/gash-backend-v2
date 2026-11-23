import { Request, Response, NextFunction } from 'express';
import mongoSanitize from 'express-mongo-sanitize';

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Recursively strips prototype-pollution keys and keys that start with '$' or contain '.'
 * from an object or array in-place.
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
      if (DANGEROUS_KEYS.has(key) || key.startsWith('$') || key.includes('.')) {
        delete record[key];
      } else if (typeof record[key] === 'object' && record[key] !== null) {
        sanitizeInPlace(record[key]);
      }
    }
  }
};

/**
 * Express 5 compatible middleware for NoSQL injection & prototype-pollution sanitization.
 * Materializes sanitized req.query as an own property so downstream hpp/validate/controllers
 * do not re-trigger Express 5's uncached req.query getter.
 */
export const sanitizeData = (
  req: Request,
  _res: Response,
  next: NextFunction
): void => {
  if (req.body) {
    req.body = mongoSanitize.sanitize(req.body);
    sanitizeInPlace(req.body);
  }
  if (req.params) {
    req.params = mongoSanitize.sanitize(req.params);
    sanitizeInPlace(req.params);
  }
  const query = req.query;
  if (query) {
    sanitizeInPlace(query);
    Object.defineProperty(req, 'query', {
      value: query,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  }
  next();
};
