import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync.js';
import { authService } from '../services/authService.js';
import { sendSuccess } from '../utils/response.js';
import { AppError } from '../utils/AppError.js';
import {
  getCookie,
  setRefreshTokenCookie,
  clearRefreshTokenCookie,
  REFRESH_COOKIE_NAME,
} from '../utils/cookies.js';

export const register = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const result = await authService.register(req.body);
    setRefreshTokenCookie(res, result.tokens.refreshToken);
    sendSuccess(res, result, 201);
  }
);

export const login = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const result = await authService.login(req.body);
    setRefreshTokenCookie(res, result.tokens.refreshToken);
    sendSuccess(res, result, 200);
  }
);

export const refreshToken = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const incomingToken =
      req.body?.refreshToken || getCookie(req, REFRESH_COOKIE_NAME);
    if (!incomingToken) {
      throw new AppError('Refresh token is required', 400);
    }
    const tokens = await authService.refreshAccessToken(incomingToken);
    setRefreshTokenCookie(res, tokens.refreshToken);
    sendSuccess(res, { tokens }, 200);
  }
);

export const logout = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const token = req.body?.refreshToken || getCookie(req, REFRESH_COOKIE_NAME);
    await authService.logout(req.user!._id.toString(), token);
    clearRefreshTokenCookie(res);
    sendSuccess(res, null, 200, { message: 'Logged out successfully' });
  }
);

export const logoutAll = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    await authService.logoutAll(req.user!._id.toString());
    clearRefreshTokenCookie(res);
    sendSuccess(res, null, 200, {
      message: 'Logged out of all devices successfully',
    });
  }
);

export const forgotPassword = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    await authService.forgotPassword(req.body.email);
    sendSuccess(res, null, 200, {
      message:
        'If an account with that email exists, password reset instructions have been sent.',
    });
  }
);

export const resetPassword = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const result = await authService.resetPassword(
      req.params.token as string,
      req.body
    );
    setRefreshTokenCookie(res, result.tokens.refreshToken);
    sendSuccess(res, result, 200);
  }
);

export const verifyEmail = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    await authService.verifyEmail(req.params.token as string);
    sendSuccess(res, null, 200, { message: 'Email successfully verified' });
  }
);
