import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync.js';
import { userService } from '../services/userService.js';
import { sendPaginated, sendSuccess } from '../utils/response.js';

export const getMe = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const user = await userService.getMe(req.user!._id.toString());
    sendSuccess(res, { user });
  }
);

export const updateMe = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const user = await userService.updateMe(req.user!._id.toString(), req.body);
    sendSuccess(res, { user });
  }
);

export const changePassword = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const result = await userService.changePassword(
      req.user!._id.toString(),
      req.body
    );
    sendSuccess(res, result);
  }
);

export const deactivateMe = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    await userService.deactivateMe(req.user!._id.toString());
    sendSuccess(res, null, 204);
  }
);

export const getAddresses = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const addresses = await userService.getAddresses(req.user!._id.toString());
    sendSuccess(res, { addresses }, 200, { results: addresses.length });
  }
);

export const addAddress = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const addresses = await userService.addAddress(
      req.user!._id.toString(),
      req.body
    );
    sendSuccess(res, { addresses }, 201);
  }
);

export const updateAddress = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const addresses = await userService.updateAddress(
      req.user!._id.toString(),
      req.params.addressId as string,
      req.body
    );
    sendSuccess(res, { addresses });
  }
);

export const removeAddress = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const addresses = await userService.removeAddress(
      req.user!._id.toString(),
      req.params.addressId as string
    );
    sendSuccess(res, { addresses });
  }
);

// Admin handlers

export const getAllUsers = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const result = await userService.getAllUsers(req.query);
    sendPaginated(res, 'users', result);
  }
);

export const getUser = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const user = await userService.getUserById(req.params.id as string);
    sendSuccess(res, { user });
  }
);

export const updateUserRole = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const user = await userService.updateUserRole(
      req.params.id as string,
      req.body.role
    );
    sendSuccess(res, { user });
  }
);

export const deleteUser = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    await userService.deleteUser(req.params.id as string);
    sendSuccess(res, null, 204);
  }
);
