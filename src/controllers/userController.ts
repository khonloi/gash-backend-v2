import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync.js';
import { userService } from '../services/userService.js';

export const getMe = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const user = await userService.getMe(req.user!._id.toString());

    res.status(200).json({
      status: 'success',
      data: { user },
    });
  }
);

export const updateMe = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const user = await userService.updateMe(req.user!._id.toString(), req.body);

    res.status(200).json({
      status: 'success',
      data: { user },
    });
  }
);

export const changePassword = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const result = await userService.changePassword(
      req.user!._id.toString(),
      req.body
    );

    res.status(200).json({
      status: 'success',
      data: result,
    });
  }
);

export const deactivateMe = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    await userService.deactivateMe(req.user!._id.toString());

    res.status(204).json({
      status: 'success',
      data: null,
    });
  }
);

export const getAddresses = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const addresses = await userService.getAddresses(req.user!._id.toString());

    res.status(200).json({
      status: 'success',
      results: addresses.length,
      data: { addresses },
    });
  }
);

export const addAddress = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const addresses = await userService.addAddress(
      req.user!._id.toString(),
      req.body
    );

    res.status(201).json({
      status: 'success',
      data: { addresses },
    });
  }
);

export const updateAddress = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const addresses = await userService.updateAddress(
      req.user!._id.toString(),
      req.params.addressId as string,
      req.body
    );

    res.status(200).json({
      status: 'success',
      data: { addresses },
    });
  }
);

export const removeAddress = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const addresses = await userService.removeAddress(
      req.user!._id.toString(),
      req.params.addressId as string
    );

    res.status(200).json({
      status: 'success',
      data: { addresses },
    });
  }
);

// Admin handlers

export const getAllUsers = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const result = await userService.getAllUsers(req.query);

    res.status(200).json({
      status: 'success',
      results: result.data.length,
      pagination: {
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
        totalResults: result.totalResults,
      },
      data: { users: result.data },
    });
  }
);

export const getUser = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const user = await userService.getUserById(req.params.id as string);

    res.status(200).json({
      status: 'success',
      data: { user },
    });
  }
);

export const updateUserRole = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const user = await userService.updateUserRole(
      req.params.id as string,
      req.body.role
    );

    res.status(200).json({
      status: 'success',
      data: { user },
    });
  }
);

export const deleteUser = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    await userService.deleteUser(req.params.id as string);

    res.status(204).json({
      status: 'success',
      data: null,
    });
  }
);
