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
    const { response, refreshToken } = await authService.register(req.body);
    setRefreshTokenCookie(res, refreshToken);
    sendSuccess(res, response, 201);
  }
);

export const login = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const { response, refreshToken } = await authService.login(req.body);
    setRefreshTokenCookie(res, refreshToken);
    sendSuccess(res, response, 200);
  }
);

export const refreshToken = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const incomingToken = getCookie(req, REFRESH_COOKIE_NAME);
    if (!incomingToken) {
      throw new AppError('Refresh token cookie is required', 400);
    }
    try {
      const result = await authService.refreshAccessToken(incomingToken);
      setRefreshTokenCookie(res, result.refreshToken);
      sendSuccess(res, { tokens: result.tokens }, 200);
    } catch (err) {
      clearRefreshTokenCookie(res);
      throw err;
    }
  }
);

export const logout = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const token = getCookie(req, REFRESH_COOKIE_NAME);
    if (!req.user && !token) {
      throw new AppError(
        'You are not logged in! Please log in to get access.',
        401
      );
    }
    await authService.logout(req.user?._id?.toString(), token);
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
    const { response, refreshToken } = await authService.resetPassword(
      req.body
    );
    setRefreshTokenCookie(res, refreshToken);
    sendSuccess(res, response, 200);
  }
);

export const verifyEmail = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    await authService.verifyEmail(req.body.token);
    sendSuccess(res, null, 200, { message: 'Email successfully verified' });
  }
);
