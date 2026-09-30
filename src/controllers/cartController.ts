import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync.js';
import { cartService } from '../services/cartService.js';
import { sendSuccess } from '../utils/response.js';

export const getCart = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    // req.user is guaranteed by protect middleware
    const cart = await cartService.getCart(String(req.user!._id));
    sendSuccess(res, { cart }, 200);
  }
);

export const addToCart = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const cart = await cartService.addItem(String(req.user!._id), req.body);
    sendSuccess(res, { cart }, 200);
  }
);

export const updateCartItem = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const cart = await cartService.updateItemQty(
      String(req.user!._id),
      req.params.itemId as string,
      req.body.quantity
    );
    sendSuccess(res, { cart }, 200);
  }
);

export const removeCartItem = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const cart = await cartService.removeItem(
      String(req.user!._id),
      req.params.itemId as string
    );
    sendSuccess(res, { cart }, 200);
  }
);

export const clearCart = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    await cartService.clearCart(String(req.user!._id));
    sendSuccess(res, null, 204);
  }
);

export const mergeCart = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const cart = await cartService.mergeCart(String(req.user!._id), req.body);
    sendSuccess(res, { cart }, 200);
  }
);
