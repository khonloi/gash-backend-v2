import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync.js';
import { authService } from '../services/authService.js';

export const register = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const result = await authService.register(req.body);

    res.status(201).json({
      status: 'success',
      data: result,
    });
  }
);

export const login = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const result = await authService.login(req.body);

    res.status(200).json({
      status: 'success',
      data: result,
    });
  }
);

export const refreshToken = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const tokens = await authService.refreshAccessToken(req.body.refreshToken);

    res.status(200).json({
      status: 'success',
      data: { tokens },
    });
  }
);

export const logout = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    await authService.logout(req.user!._id.toString(), req.body.refreshToken);

    res.status(200).json({
      status: 'success',
      message: 'Logged out successfully',
    });
  }
);

export const logoutAll = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    await authService.logoutAll(req.user!._id.toString());

    res.status(200).json({
      status: 'success',
      message: 'Logged out of all devices successfully',
    });
  }
);

export const forgotPassword = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    await authService.forgotPassword(req.body.email);

    res.status(200).json({
      status: 'success',
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

    res.status(200).json({
      status: 'success',
      data: result,
    });
  }
);

export const verifyEmail = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    await authService.verifyEmail(req.params.token as string);

    res.status(200).json({
      status: 'success',
      message: 'Email successfully verified',
    });
  }
);
