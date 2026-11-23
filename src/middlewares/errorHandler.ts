import { Request, Response, NextFunction } from 'express';
import { logger } from '../config/logger.js';
import { AppError } from '../utils/AppError.js';
import { env } from '../config/env.js';

interface MongoCastError extends Error {
  name: 'CastError';
  path: string;
  value: unknown;
}

interface MongoDuplicateKeyError extends Error {
  code: number;
  errmsg?: string;
  keyValue?: Record<string, unknown>;
}

interface MongoValidationErrorItem {
  message: string;
}

interface MongoValidationError extends Error {
  name: 'ValidationError';
  errors: Record<string, MongoValidationErrorItem>;
}

export interface AppErrorLike extends Partial<Error> {
  statusCode?: number;
  status?: string;
  isOperational?: boolean;
  code?: number;
  path?: string;
  value?: unknown;
  errmsg?: string;
  keyValue?: Record<string, unknown>;
  errors?: Record<string, MongoValidationErrorItem>;
  type?: string;
}

export const handleCastErrorDB = (
  err: MongoCastError | AppErrorLike
): AppError => {
  const message = `Invalid ${String(err.path)}: ${String(err.value)}.`;
  return new AppError(message, 400);
};

export const handleDuplicateFieldsDB = (
  err: MongoDuplicateKeyError | AppErrorLike
): AppError => {
  if (err.keyValue && Object.keys(err.keyValue).length > 0) {
    const [field, val] = Object.entries(err.keyValue)[0];
    return new AppError(
      `Duplicate field value for "${field}": "${String(val)}". Please use another value!`,
      400
    );
  }
  const match = err.errmsg?.match(/(["'])(\\?.)*?\1/);
  const value = match ? match[0] : 'unknown';
  const message = `Duplicate field value: ${value}. Please use another value!`;
  return new AppError(message, 400);
};

export const handleValidationErrorDB = (
  err: MongoValidationError | AppErrorLike
): AppError => {
  const errors = Object.values(err.errors || {}).map((el) => el.message);
  const message = `Invalid input data. ${errors.join('. ')}`;
  return new AppError(message, 400);
};

export const handleJWTError = (): AppError =>
  new AppError('Invalid token. Please log in again.', 401);

export const handleJWTExpiredError = (): AppError =>
  new AppError('Your token has expired. Please log in again.', 401);

export const sendErrorDev = (
  err: AppErrorLike,
  res: Response,
  requestId?: string
): void => {
  res.status(err.statusCode || 500).json({
    status: err.status || 'error',
    ...(requestId ? { requestId } : {}),
    error: err,
    message: err.message,
    stack: err.stack,
  });
};

export const sendErrorProd = (
  err: AppErrorLike,
  res: Response,
  requestId?: string
): void => {
  if (err.isOperational) {
    res.status(err.statusCode || 500).json({
      status: err.status || 'error',
      ...(requestId ? { requestId } : {}),
      message: err.message,
    });
  } else {
    logger.error('ERROR', { requestId, err });
    res.status(500).json({
      status: 'error',
      ...(requestId ? { requestId } : {}),
      message: 'Something went wrong!',
    });
  }
};

function normalizeKnownErrors(err: AppErrorLike): AppErrorLike {
  if (err.name === 'CastError') return handleCastErrorDB(err);
  if (err.code === 11000) return handleDuplicateFieldsDB(err);
  if (err.name === 'ValidationError') return handleValidationErrorDB(err);
  if (err.name === 'JsonWebTokenError') return handleJWTError();
  if (err.name === 'TokenExpiredError') return handleJWTExpiredError();
  if (err.name === 'SyntaxError' && err.type === 'entity.parse.failed') {
    return new AppError('Invalid JSON payload', 400);
  }
  return err;
}

export const globalErrorHandler = (
  err: AppErrorLike | unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  const errorObj = (
    typeof err === 'object' && err !== null ? err : {}
  ) as AppErrorLike;
  errorObj.statusCode = errorObj.statusCode || 500;
  errorObj.status = errorObj.status || 'error';

  const normalized = normalizeKnownErrors({
    ...errorObj,
    name: errorObj.name,
    message: errorObj.message,
    stack: errorObj.stack,
  });

  if (env.NODE_ENV === 'production') {
    sendErrorProd(normalized, res, req.id);
  } else {
    sendErrorDev(normalized, res, req.id);
  }
};
