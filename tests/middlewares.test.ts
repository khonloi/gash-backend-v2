import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { User } from '../src/models/User.js';
import { AppError } from '../src/utils/AppError.js';
import { signAccessToken } from '../src/utils/jwt.js';
import { env } from '../src/config/env.js';
import {
  extractBearerToken,
  verifyUserFromToken,
  protect,
  optionalAuth,
  restrictTo,
} from '../src/middlewares/auth.js';
import {
  globalErrorHandler,
  handleCastErrorDB,
  handleDuplicateFieldsDB,
  handleValidationErrorDB,
  handleJWTError,
  handleJWTExpiredError,
  sendErrorDev,
  sendErrorProd,
  AppErrorLike,
} from '../src/middlewares/errorHandler.js';

let mongoServer: MongoMemoryServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await User.deleteMany({});
});

function createMockResponse() {
  const res: {
    statusCode: number;
    sentJson: unknown;
    status: (code: number) => typeof res;
    json: (body: unknown) => typeof res;
  } = {
    statusCode: 200,
    sentJson: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.sentJson = body;
      return this;
    },
  };
  return res as unknown as Response & { statusCode: number; sentJson: unknown };
}

describe('Middleware Unit & Integration Tests', () => {
  describe('Auth Middleware', () => {
    describe('extractBearerToken', () => {
      it('should return undefined when authorization header is missing', () => {
        const req = { headers: {} } as Request;
        expect(extractBearerToken(req)).toBeUndefined();
      });

      it('should return undefined when authorization header does not start with Bearer', () => {
        const req = {
          headers: { authorization: 'Basic abc123xyz' },
        } as Request;
        expect(extractBearerToken(req)).toBeUndefined();
      });

      it('should return token when authorization header starts with Bearer', () => {
        const req = {
          headers: { authorization: 'Bearer my-jwt-token-value' },
        } as Request;
        expect(extractBearerToken(req)).toBe('my-jwt-token-value');
      });
    });

    describe('verifyUserFromToken', () => {
      it('should throw 401 if user belonging to token does not exist', async () => {
        const nonExistentId = new mongoose.Types.ObjectId().toString();
        const token = signAccessToken(nonExistentId, 'customer');

        await expect(verifyUserFromToken(token)).rejects.toThrow(
          'The user belonging to this token no longer exists.'
        );
      });

      it('should throw 401 if user account is deactivated', async () => {
        const user = await User.create({
          firstName: 'Inactive',
          lastName: 'User',
          email: 'inactive@example.com',
          password: 'Password123!',
          isActive: false,
        });

        const token = signAccessToken(user._id.toString(), user.role);

        await expect(verifyUserFromToken(token)).rejects.toThrow(
          'This account has been deactivated. Please contact support.'
        );
      });

      it('should throw 401 if user changed password after token was issued', async () => {
        const user = await User.create({
          firstName: 'Changed',
          lastName: 'Password',
          email: 'changed@example.com',
          password: 'Password123!',
        });

        // Generate token
        const token = signAccessToken(user._id.toString(), user.role);

        // Manually simulate password changed in future relative to token iat
        user.passwordChangedAt = new Date(Date.now() + 60000);
        await user.save();

        await expect(verifyUserFromToken(token)).rejects.toThrow(
          'User recently changed password! Please log in again.'
        );
      });

      it('should return user when token is valid and user is active', async () => {
        const user = await User.create({
          firstName: 'Active',
          lastName: 'User',
          email: 'active@example.com',
          password: 'Password123!',
        });

        const token = signAccessToken(user._id.toString(), user.role);
        const verifiedUser = await verifyUserFromToken(token);

        expect(verifiedUser._id.toString()).toBe(user._id.toString());
      });
    });

    describe('protect middleware', () => {
      it('should call next with 401 error if no token is provided', async () => {
        const req = { headers: {} } as Request;
        const res = createMockResponse();
        let nextError: unknown = null;
        const next: NextFunction = (err?: unknown) => {
          nextError = err;
        };

        await protect(req, res, next);

        expect(nextError).toBeInstanceOf(AppError);
        expect((nextError as AppError).statusCode).toBe(401);
        expect((nextError as AppError).message).toMatch(/not logged in/i);
      });

      it('should attach user to req and call next without error on valid token', async () => {
        const user = await User.create({
          firstName: 'Protected',
          lastName: 'User',
          email: 'protected@example.com',
          password: 'Password123!',
        });

        const token = signAccessToken(user._id.toString(), user.role);
        const req = {
          headers: { authorization: `Bearer ${token}` },
        } as Request;
        const res = createMockResponse();

        await new Promise<void>((resolve, reject) => {
          protect(req, res, (err) => {
            if (err) reject(err);
            else resolve();
          });
        });

        expect(req.user?._id.toString()).toBe(user._id.toString());
      });
    });

    describe('optionalAuth middleware', () => {
      it('should call next without setting req.user when no token provided', async () => {
        const req = { headers: {} } as Request;
        const res = createMockResponse();
        let nextCalled = false;
        const next: NextFunction = () => {
          nextCalled = true;
        };

        await optionalAuth(req, res, next);

        expect(nextCalled).toBe(true);
        expect(req.user).toBeUndefined();
      });

      it('should attach user to req when valid token provided', async () => {
        const user = await User.create({
          firstName: 'Optional',
          lastName: 'User',
          email: 'optional@example.com',
          password: 'Password123!',
        });

        const token = signAccessToken(user._id.toString(), user.role);
        const req = {
          headers: { authorization: `Bearer ${token}` },
        } as Request;
        const res = createMockResponse();

        await new Promise<void>((resolve, reject) => {
          optionalAuth(req, res, (err) => {
            if (err) reject(err);
            else resolve();
          });
        });

        expect(req.user?._id.toString()).toBe(user._id.toString());
      });

      it('should silently continue without user when token is invalid', async () => {
        const req = {
          headers: { authorization: 'Bearer invalid.token.payload' },
        } as Request;
        const res = createMockResponse();
        let nextCalled = false;
        const next: NextFunction = () => {
          nextCalled = true;
        };

        await optionalAuth(req, res, next);

        expect(nextCalled).toBe(true);
        expect(req.user).toBeUndefined();
      });
    });

    describe('restrictTo middleware', () => {
      it('should call next with 403 error if user is not set', () => {
        const req = {} as Request;
        const res = createMockResponse();
        let nextError: unknown = null;
        const next: NextFunction = (err?: unknown) => {
          nextError = err;
        };

        restrictTo('admin')(req, res, next);

        expect(nextError).toBeInstanceOf(AppError);
        expect((nextError as AppError).statusCode).toBe(403);
      });

      it('should call next with 403 error if user role is not permitted', () => {
        const req = { user: { role: 'customer' } } as unknown as Request;
        const res = createMockResponse();
        let nextError: unknown = null;
        const next: NextFunction = (err?: unknown) => {
          nextError = err;
        };

        restrictTo('admin', 'seller')(req, res, next);

        expect(nextError).toBeInstanceOf(AppError);
        expect((nextError as AppError).statusCode).toBe(403);
      });

      it('should call next with no error if user role is permitted', () => {
        const req = { user: { role: 'admin' } } as unknown as Request;
        const res = createMockResponse();
        let nextError: unknown = null;
        let nextCalled = false;
        const next: NextFunction = (err?: unknown) => {
          nextError = err;
          nextCalled = true;
        };

        restrictTo('admin')(req, res, next);

        expect(nextCalled).toBe(true);
        expect(nextError).toBeUndefined();
      });
    });
  });

  describe('Error Handler Middleware', () => {
    describe('Error Transformer Helpers', () => {
      it('handleCastErrorDB should return 400 AppError with path and value', () => {
        const err = { path: '_id', value: 'invalid-id-123' };
        const appErr = handleCastErrorDB(err);

        expect(appErr).toBeInstanceOf(AppError);
        expect(appErr.statusCode).toBe(400);
        expect(appErr.message).toBe('Invalid _id: invalid-id-123.');
        expect(appErr.isOperational).toBe(true);
      });

      it('handleDuplicateFieldsDB should extract duplicate field from errmsg', () => {
        const err = {
          errmsg:
            'E11000 duplicate key error collection: test index: email_1 dup key: { email: "duplicate@example.com" }',
        };
        const appErr = handleDuplicateFieldsDB(err);

        expect(appErr).toBeInstanceOf(AppError);
        expect(appErr.statusCode).toBe(400);
        expect(appErr.message).toContain('"duplicate@example.com"');
      });

      it('handleDuplicateFieldsDB should fallback to unknown when errmsg match is missing', () => {
        const err = { errmsg: undefined };
        const appErr = handleDuplicateFieldsDB(err);

        expect(appErr).toBeInstanceOf(AppError);
        expect(appErr.statusCode).toBe(400);
        expect(appErr.message).toContain('unknown');
      });

      it('handleValidationErrorDB should join error item messages', () => {
        const err = {
          errors: {
            name: { message: 'Name is required' },
            email: { message: 'Email must be valid' },
          },
        };
        const appErr = handleValidationErrorDB(err);

        expect(appErr).toBeInstanceOf(AppError);
        expect(appErr.statusCode).toBe(400);
        expect(appErr.message).toBe(
          'Invalid input data. Name is required. Email must be valid'
        );
      });

      it('handleJWTError should return 401 AppError', () => {
        const appErr = handleJWTError();
        expect(appErr).toBeInstanceOf(AppError);
        expect(appErr.statusCode).toBe(401);
        expect(appErr.message).toBe('Invalid token. Please log in again.');
      });

      it('handleJWTExpiredError should return 401 AppError', () => {
        const appErr = handleJWTExpiredError();
        expect(appErr).toBeInstanceOf(AppError);
        expect(appErr.statusCode).toBe(401);
        expect(appErr.message).toBe(
          'Your token has expired. Please log in again.'
        );
      });
    });

    describe('sendErrorDev & sendErrorProd responses', () => {
      it('sendErrorDev should format full error payload with stack', () => {
        const res = createMockResponse();
        const err: AppErrorLike = {
          statusCode: 404,
          status: 'fail',
          message: 'Not found',
          stack: 'Error stack trace',
        };

        sendErrorDev(err, res);

        expect(res.statusCode).toBe(404);
        expect(res.sentJson).toEqual({
          status: 'fail',
          error: err,
          message: 'Not found',
          stack: 'Error stack trace',
        });
      });

      it('sendErrorProd should return clean operational error message', () => {
        const res = createMockResponse();
        const err: AppErrorLike = {
          statusCode: 400,
          status: 'fail',
          isOperational: true,
          message: 'Operational failure',
        };

        sendErrorProd(err, res);

        expect(res.statusCode).toBe(400);
        expect(res.sentJson).toEqual({
          status: 'fail',
          message: 'Operational failure',
        });
      });

      it('sendErrorProd should return generic 500 for non-operational error', () => {
        const res = createMockResponse();
        const err: AppErrorLike = {
          statusCode: 500,
          status: 'error',
          isOperational: false,
          message: 'Database connection failed secretly',
        };

        sendErrorProd(err, res);

        expect(res.statusCode).toBe(500);
        expect(res.sentJson).toEqual({
          status: 'error',
          message: 'Something went wrong!',
        });
      });
    });

    describe('globalErrorHandler dispatching in production mode', () => {
      const originalNodeEnv = env.NODE_ENV;

      beforeAll(() => {
        (env as { NODE_ENV: string }).NODE_ENV = 'production';
      });

      afterAll(() => {
        (env as { NODE_ENV: string }).NODE_ENV = originalNodeEnv;
      });

      it('should transform CastError into operational 400', () => {
        const res = createMockResponse();
        const err: AppErrorLike = {
          name: 'CastError',
          path: 'productId',
          value: 'bad-id',
        };

        globalErrorHandler(err, {} as Request, res, () => {});

        expect(res.statusCode).toBe(400);
        expect((res.sentJson as Record<string, unknown>).message).toContain(
          'Invalid productId'
        );
      });

      it('should transform duplicate code 11000 into operational 400', () => {
        const res = createMockResponse();
        const err: AppErrorLike = {
          code: 11000,
          errmsg:
            'duplicate key error collection: users dup key: { email: "taken@example.com" }',
        };

        globalErrorHandler(err, {} as Request, res, () => {});

        expect(res.statusCode).toBe(400);
        expect((res.sentJson as Record<string, unknown>).message).toContain(
          '"taken@example.com"'
        );
      });

      it('should transform ValidationError into operational 400', () => {
        const res = createMockResponse();
        const err: AppErrorLike = {
          name: 'ValidationError',
          errors: { title: { message: 'Title is required' } },
        };

        globalErrorHandler(err, {} as Request, res, () => {});

        expect(res.statusCode).toBe(400);
        expect((res.sentJson as Record<string, unknown>).message).toContain(
          'Title is required'
        );
      });

      it('should transform JsonWebTokenError into operational 401', () => {
        const res = createMockResponse();
        const err: AppErrorLike = { name: 'JsonWebTokenError' };

        globalErrorHandler(err, {} as Request, res, () => {});

        expect(res.statusCode).toBe(401);
        expect((res.sentJson as Record<string, unknown>).message).toContain(
          'Invalid token'
        );
      });

      it('should transform TokenExpiredError into operational 401', () => {
        const res = createMockResponse();
        const err: AppErrorLike = { name: 'TokenExpiredError' };

        globalErrorHandler(err, {} as Request, res, () => {});

        expect(res.statusCode).toBe(401);
        expect((res.sentJson as Record<string, unknown>).message).toContain(
          'Your token has expired'
        );
      });
    });
  });
});
