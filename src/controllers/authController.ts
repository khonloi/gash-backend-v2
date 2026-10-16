import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync.js';
import { authService } from '../services/authService.js';
import { sendSuccess } from '../utils/response.js';

export const register = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const result = await authService.register(req.body);
    sendSuccess(res, result, 201);
  }
);

export const login = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const result = await authService.login(req.body);
    sendSuccess(res, result, 200);
  }
);

export const refreshToken = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const tokens = await authService.refreshAccessToken(req.body.refreshToken);
    sendSuccess(res, { tokens }, 200);
  }
);

export const logout = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    await authService.logout(req.user!._id.toString(), req.body.refreshToken);
    sendSuccess(res, null, 200, { message: 'Logged out successfully' });
  }
);

export const logoutAll = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    await authService.logoutAll(req.user!._id.toString());
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
    sendSuccess(res, result, 200);
  }
);

export const verifyEmail = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    await authService.verifyEmail(req.params.token as string);
    sendSuccess(res, null, 200, { message: 'Email successfully verified' });
  }
);
