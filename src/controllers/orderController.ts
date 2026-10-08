import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync.js';
import { orderService } from '../services/orderService.js';
import { sendPaginated, sendSuccess } from '../utils/response.js';

export const createOrder = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const order = await orderService.createOrder(
      req.user?._id?.toString(),
      req.body
    );

    sendSuccess(res, { order }, 201);
  }
);

export const getMyOrders = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const result = await orderService.getUserOrders(
      String(req.user!._id),
      req.query
    );

    sendPaginated(res, 'orders', result);
  }
);

export const getOrder = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const order = await orderService.getOrderById(
      req.params.orderId as string,
      String(req.user!._id),
      req.user!.role
    );

    sendSuccess(res, { order });
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

    sendSuccess(res, { order });
  }
);

export const getAllOrders = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const result = await orderService.getAllOrders(req.query);

    sendPaginated(res, 'orders', result);
  }
);

export const updateOrderStatus = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const order = await orderService.updateOrderStatus(
      req.params.orderId as string,
      req.body.status
    );

    sendSuccess(res, { order });
  }
);

export const updatePaymentStatus = catchAsync(
  async (req: Request, res: Response): Promise<void> => {
    const order = await orderService.updatePaymentStatus(
      req.params.orderId as string,
      req.body.paymentStatus
    );

    sendSuccess(res, { order });
  }
);
