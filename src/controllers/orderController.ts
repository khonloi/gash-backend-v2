import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync.js';
import { orderService } from '../services/orderService.js';

export const createOrder = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const order = await orderService.createOrder(
      req.user?._id?.toString(),
      req.body
    );

    res.status(201).json({
      status: 'success',
      data: { order },
    });
  }
);

export const getMyOrders = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const result = await orderService.getUserOrders(
      String(req.user!._id),
      req.query
    );

    res.status(200).json({
      status: 'success',
      results: result.data.length,
      pagination: {
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
        totalResults: result.totalResults,
      },
      data: { orders: result.data },
    });
  }
);

export const getOrder = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const order = await orderService.getOrderById(
      req.params.orderId as string,
      String(req.user!._id),
      req.user!.role
    );

    res.status(200).json({
      status: 'success',
      data: { order },
    });
  }
);

export const cancelOrder = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const order = await orderService.cancelOrder(
      req.params.orderId as string,
      String(req.user!._id),
      req.user!.role,
      req.body.reason
    );

    res.status(200).json({
      status: 'success',
      data: { order },
    });
  }
);

export const getAllOrders = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const result = await orderService.getAllOrders(req.query);

    res.status(200).json({
      status: 'success',
      results: result.data.length,
      pagination: {
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
        totalResults: result.totalResults,
      },
      data: { orders: result.data },
    });
  }
);

export const updateOrderStatus = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const order = await orderService.updateOrderStatus(
      req.params.orderId as string,
      req.body.status
    );

    res.status(200).json({
      status: 'success',
      data: { order },
    });
  }
);

export const updatePaymentStatus = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const order = await orderService.updatePaymentStatus(
      req.params.orderId as string,
      req.body.paymentStatus
    );

    res.status(200).json({
      status: 'success',
      data: { order },
    });
  }
);
