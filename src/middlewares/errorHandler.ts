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
  errors?: Record<string, MongoValidationErrorItem>;
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

export const sendErrorDev = (err: AppErrorLike, res: Response): void => {
  res.status(err.statusCode || 500).json({
    status: err.status || 'error',
    error: err,
    message: err.message,
    stack: err.stack,
  });
};

export const sendErrorProd = (err: AppErrorLike, res: Response): void => {
  if (err.isOperational) {
    res.status(err.statusCode || 500).json({
      status: err.status || 'error',
      message: err.message,
    });
  } else {
    logger.error('ERROR', err);
    res.status(500).json({
      status: 'error',
      message: 'Something went wrong!',
    });
  }
};

export const globalErrorHandler = (
  err: AppErrorLike,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'error';

  if (env.NODE_ENV === 'production') {
    let error: AppErrorLike = { ...err, message: err.message, name: err.name };

    if (error.name === 'CastError') error = handleCastErrorDB(error);
    if (error.code === 11000) error = handleDuplicateFieldsDB(error);
    if (error.name === 'ValidationError')
      error = handleValidationErrorDB(error);
    if (error.name === 'JsonWebTokenError') error = handleJWTError();
    if (error.name === 'TokenExpiredError') error = handleJWTExpiredError();

    sendErrorProd(error, res);
  } else {
    sendErrorDev(err, res);
  }
};
