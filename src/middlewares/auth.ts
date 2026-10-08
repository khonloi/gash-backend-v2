import { Request, Response, NextFunction, RequestHandler } from 'express';
import { User } from '../models/User.js';
import { IUser, UserRole } from '../types/index.js';
import { AppError } from '../utils/AppError.js';
import { catchAsync } from '../utils/catchAsync.js';
import { verifyToken } from '../utils/jwt.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: IUser;
    }
  }
}

export function extractBearerToken(req: Request): string | undefined {
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer ')
  ) {
    return req.headers.authorization.split(' ')[1];
  }
  return undefined;
}

export async function verifyUserFromToken(token: string): Promise<IUser> {
  const decoded = verifyToken(token);
  const currentUser = await User.findById(decoded.id);

  if (!currentUser) {
    throw new AppError(
      'The user belonging to this token no longer exists.',
      401
    );
  }

  if (!currentUser.isActive) {
    throw new AppError(
      'This account has been deactivated. Please contact support.',
      401
    );
  }

  if (decoded.iat && currentUser.changedPasswordAfter(decoded.iat)) {
    throw new AppError(
      'User recently changed password! Please log in again.',
      401
    );
  }

  return currentUser;
}

/**
 * Protect routes: Authenticate user via Bearer JWT access token
 */
export const protect: RequestHandler = catchAsync(
  async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const token = extractBearerToken(req);
    if (!token) {
      return next(
        new AppError('You are not logged in! Please log in to get access.', 401)
      );
    }

    req.user = await verifyUserFromToken(token);
    next();
  }
);

/**
 * Optional Auth: Authenticate user if token exists, but don't fail if it doesn't
 */
export const optionalAuth: RequestHandler = catchAsync(
  async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const token = extractBearerToken(req);
    if (!token) {
      return next();
    }

    try {
      req.user = await verifyUserFromToken(token);
    } catch {
      // Ignore token verification errors for optional auth
    }

    next();
  }
);

/**
 * Restrict routes to specific user roles
 */
export const restrictTo = (...roles: UserRole[]): RequestHandler => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(
        new AppError('You do not have permission to perform this action', 403)
      );
    }

    next();
  };
};
