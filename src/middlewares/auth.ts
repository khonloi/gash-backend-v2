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

/**
 * Protect routes: Authenticate user via Bearer JWT access token
 */
export const protect: RequestHandler = catchAsync(
  async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    // 1) Getting token and check if it exists
    let token: string | undefined;

    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith('Bearer ')
    ) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return next(
        new AppError('You are not logged in! Please log in to get access.', 401)
      );
    }

    // 2) Verification token
    const decoded = verifyToken(token);

    // 3) Check if user still exists and is active
    const currentUser = await User.findById(decoded.id);
    if (!currentUser) {
      return next(
        new AppError('The user belonging to this token no longer exists.', 401)
      );
    }

    if (!currentUser.isActive) {
      return next(
        new AppError(
          'This account has been deactivated. Please contact support.',
          401
        )
      );
    }

    // 4) Check if user changed password after the token was issued
    if (decoded.iat && currentUser.changedPasswordAfter(decoded.iat)) {
      return next(
        new AppError(
          'User recently changed password! Please log in again.',
          401
        )
      );
    }

    // Grant access to protected route
    req.user = currentUser;
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
