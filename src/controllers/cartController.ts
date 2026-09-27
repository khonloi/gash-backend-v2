import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync.js';
import { cartService } from '../services/cartService.js';

export const getCart = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    // req.user is guaranteed by protect middleware
    const cart = await cartService.getCart(String(req.user!._id));
    res.status(200).json({ status: 'success', data: { cart } });
  }
);

export const addToCart = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const cart = await cartService.addItem(String(req.user!._id), req.body);
    res.status(200).json({ status: 'success', data: { cart } });
  }
);

export const updateCartItem = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const cart = await cartService.updateItemQty(
      String(req.user!._id),
      req.params.itemId as string,
      req.body.quantity
    );
    res.status(200).json({ status: 'success', data: { cart } });
  }
);

export const removeCartItem = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const cart = await cartService.removeItem(
      String(req.user!._id),
      req.params.itemId as string
    );
    res.status(200).json({ status: 'success', data: { cart } });
  }
);

export const clearCart = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    await cartService.clearCart(String(req.user!._id));
    res.status(204).json({ status: 'success', data: null });
  }
);

export const mergeCart = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const cart = await cartService.mergeCart(String(req.user!._id), req.body);
    res.status(200).json({ status: 'success', data: { cart } });
  }
);
