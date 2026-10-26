import mongoose from 'mongoose';
import { Order } from '../models/Order.js';
import { Cart } from '../models/Cart.js';
import {
  IOrder,
  IOrderItem,
  OrderStatus,
  PaymentStatus,
  PaginatedResult,
  QueryString,
} from '../types/index.js';
import { AppError } from '../utils/AppError.js';
import { paginateQuery } from '../utils/apiFeatures.js';
import { resolveOwnerId } from '../utils/resolveOwnerId.js';
import { assertObjectId } from '../utils/objectId.js';
import { CreateOrderInput } from '../validations/orderValidation.js';
import { SHIPPING_FEES } from '../config/constants.js';
import { logger } from '../config/logger.js';
import { inventoryService, ProcessOrderItemInput } from './inventoryService.js';
import {
  canCustomerCancelOrder,
  validateOrderStatusTransition,
} from './orderStateMachine.js';

export class OrderService {
  /**
   * Create an order from user cart or explicit items
   */
  async createOrder(
    userId: string | undefined,
    data: CreateOrderInput
  ): Promise<IOrder> {
    if (userId) {
      assertObjectId(userId, 'user ID');
    }

    let itemsToProcess: ProcessOrderItemInput[] = [];

    // 1) Determine items to process: from input or from user's active cart
    if (data.items && data.items.length > 0) {
      itemsToProcess = data.items;
    } else if (userId) {
      const cart = await Cart.findOne({ user: userId });
      if (!cart || cart.items.length === 0) {
        throw new AppError(
          'Your cart is empty. Please add items before placing an order.',
          400
        );
      }
      itemsToProcess = cart.items.map((item) => ({
        productId: item.product.toString(),
        quantity: item.quantity,
        size: item.size,
        color: item.color,
      }));
    }

    if (itemsToProcess.length === 0) {
      throw new AppError('Order must contain at least one item', 400);
    }

    // Helper to calculate totals with 2-decimal rounding
    const calculateTotals = (items: IOrderItem[]) => {
      const subtotal =
        Math.round(
          (items.reduce((sum, item) => sum + item.price * item.quantity, 0) +
            Number.EPSILON) *
            100
        ) / 100;
      const shippingFee =
        data.shippingMethod === 'express'
          ? SHIPPING_FEES.EXPRESS
          : SHIPPING_FEES.STANDARD;
      const total =
        Math.round((subtotal + shippingFee + Number.EPSILON) * 100) / 100;
      return { subtotal, shippingFee, total };
    };

    const buildOrderPayload = (
      items: IOrderItem[],
      totals: ReturnType<typeof calculateTotals>
    ) => ({
      user: userId,
      items,
      shippingAddress: data.shippingAddress,
      shippingMethod: data.shippingMethod,
      shippingFee: totals.shippingFee,
      subtotal: totals.subtotal,
      total: totals.total,
      paymentMethod: data.paymentMethod,
      paymentStatus: 'pending' as const,
      status: 'pending' as const,
      contactEmail: data.contactEmail || undefined,
      contactPhone: data.contactPhone || undefined,
      notes: data.notes,
    });

    // 2) Attempt multi-document ACID transaction if MongoDB topology is a replica set / sharded cluster
    let order: IOrder | undefined;

    const topologyType = (
      mongoose.connection.getClient() as unknown as {
        topology?: { description?: { type?: string } };
      }
    )?.topology?.description?.type;

    const supportsTransactions =
      topologyType === 'ReplicaSetWithPrimary' ||
      topologyType === 'Sharded' ||
      topologyType === 'LoadBalanced';

    if (supportsTransactions) {
      let session: mongoose.ClientSession | null = null;
      try {
        session = await mongoose.startSession();
        await session.withTransaction(async () => {
          const orderItems = await inventoryService.processOrderItems(
            itemsToProcess,
            session!
          );
          const totals = calculateTotals(orderItems);
          const [createdOrder] = await Order.create(
            [buildOrderPayload(orderItems, totals)],
            { session: session! }
          );
          order = createdOrder;

          if (userId) {
            await Cart.findOneAndUpdate(
              { user: userId },
              { items: [] },
              { session: session! }
            );
          }
        });
      } catch (err: unknown) {
        const errorMsg = (err as Error)?.message || '';
        const isStandaloneUnsupported =
          errorMsg.includes('replica set') ||
          errorMsg.includes('Transaction numbers are only allowed') ||
          errorMsg.includes('retryable writes') ||
          errorMsg.includes('retryable write') ||
          errorMsg.includes('standalone') ||
          (err as { codeName?: string })?.codeName === 'IllegalOperation';

        if (!isStandaloneUnsupported) {
          // Validation error or stock error inside transaction
          throw err;
        }
        // Fall back to Saga pattern below if transaction unsupported
        order = undefined;
      } finally {
        if (session) {
          await session.endSession();
        }
      }
    }

    if (order) {
      return order;
    }

    // 3) Fallback: Saga compensation pattern for standalone MongoDB instances
    const orderItems = await inventoryService.processOrderItems(itemsToProcess);
    const totals = calculateTotals(orderItems);

    try {
      order = await Order.create(buildOrderPayload(orderItems, totals));

      if (userId) {
        await Cart.findOneAndUpdate({ user: userId }, { items: [] });
      }
    } catch (createErr) {
      try {
        await inventoryService.restoreInventory(orderItems);
      } catch (restoreErr) {
        logger.error(
          'Failed to restore inventory during order creation rollback:',
          {
            restoreErr,
            items: orderItems,
          }
        );
      }
      throw createErr;
    }

    return order;
  }

  /**
   * Helper to find an order by ObjectId or orderNumber identifier
   */
  private async findOrderByIdentifier(
    orderId: string,
    populateUser = false
  ): Promise<IOrder> {
    const isObjectId = mongoose.Types.ObjectId.isValid(orderId);
    const query = isObjectId
      ? { _id: orderId }
      : { orderNumber: orderId.toUpperCase() };

    let queryExec = Order.findOne(query);
    if (populateUser) {
      queryExec = queryExec.populate('user', 'firstName lastName email phone');
    }

    const order = await queryExec;
    if (!order) {
      throw new AppError(`Order not found with identifier "${orderId}"`, 404);
    }

    return order;
  }

  /**
   * Get an order by ID or orderNumber
   */
  async getOrderById(
    orderId: string,
    userId: string,
    userRole: string = 'customer'
  ): Promise<IOrder> {
    const order = await this.findOrderByIdentifier(orderId, true);

    // Check ownership unless admin
    const ownerId = resolveOwnerId(order.user);

    if (userRole !== 'admin' && ownerId !== userId) {
      throw new AppError('You do not have permission to view this order', 403);
    }

    return order;
  }

  /**
   * Get paginated orders for a specific user
   */
  async getUserOrders(
    userId: string,
    queryString: QueryString
  ): Promise<PaginatedResult<IOrder>> {
    assertObjectId(userId, 'user ID');

    const baseFilter: Record<string, unknown> = { user: userId };
    if (queryString.status) {
      baseFilter.status = String(queryString.status) as OrderStatus;
    }

    return paginateQuery(() => Order.find(baseFilter), queryString, {
      search: false,
    });
  }

  /**
   * Get all orders with filtering and pagination (Admin only)
   */
  async getAllOrders(
    queryString: QueryString
  ): Promise<PaginatedResult<IOrder>> {
    return paginateQuery(() => Order.find(), queryString, {
      search: true,
      populate: { path: 'user', select: 'firstName lastName email phone' },
    });
  }

  /**
   * Cancel an order and restore inventory
   */
  async cancelOrder(
    orderId: string,
    userId: string,
    userRole: string = 'customer',
    reason?: string
  ): Promise<IOrder> {
    const order = await this.findOrderByIdentifier(orderId);

    const ownerId = resolveOwnerId(order.user);

    if (userRole !== 'admin' && ownerId !== userId) {
      throw new AppError(
        'You do not have permission to cancel this order',
        403
      );
    }

    if (order.status === 'cancelled') {
      throw new AppError('This order is already cancelled', 400);
    }

    if (order.status === 'delivered') {
      throw new AppError('Delivered orders cannot be cancelled', 400);
    }

    // Customers can only cancel when order is pending or confirmed
    if (userRole !== 'admin' && !canCustomerCancelOrder(order.status)) {
      throw new AppError(
        `Orders in "${order.status}" status cannot be cancelled by customer`,
        400
      );
    }

    const cancelReason =
      reason ||
      (userRole === 'admin'
        ? 'Cancelled by store administrator'
        : 'Cancelled by customer');

    // Atomically transition status to cancelled ONLY IF it is not already cancelled or delivered
    const updatedOrder = await Order.findOneAndUpdate(
      {
        _id: order._id,
        status: { $nin: ['cancelled', 'delivered'] },
      },
      {
        $set: {
          status: 'cancelled',
          cancelledAt: new Date(),
          cancelReason,
          ...(order.paymentStatus === 'paid'
            ? { paymentStatus: 'refunded' }
            : {}),
        },
      },
      { returnDocument: 'after' }
    );

    if (!updatedOrder) {
      const refreshed = await Order.findById(order._id);
      if (refreshed?.status === 'cancelled') {
        throw new AppError('This order is already cancelled', 400);
      }
      if (refreshed?.status === 'delivered') {
        throw new AppError('Delivered orders cannot be cancelled', 400);
      }
      throw new AppError('Order cannot be cancelled in its current state', 400);
    }

    // Restore product quantities ONLY AFTER atomic cancellation succeeded
    await inventoryService.restoreInventory(updatedOrder.items);

    return updatedOrder;
  }

  /**
   * Update order status (Admin only)
   */
  async updateOrderStatus(
    orderId: string,
    newStatus: OrderStatus
  ): Promise<IOrder> {
    const order = await this.findOrderByIdentifier(orderId);

    if (order.status === newStatus) {
      return order;
    }

    validateOrderStatusTransition(order.status, newStatus);

    // If changing to cancelled, perform atomic transition and restore stock
    if (newStatus === 'cancelled' && order.status !== 'cancelled') {
      const updatedOrder = await Order.findOneAndUpdate(
        {
          _id: order._id,
          status: { $ne: 'cancelled' },
        },
        {
          $set: {
            status: 'cancelled',
            cancelledAt: new Date(),
            cancelReason: 'Cancelled by administrator',
            ...(order.paymentStatus === 'paid'
              ? { paymentStatus: 'refunded' }
              : {}),
          },
        },
        { returnDocument: 'after' }
      );

      if (!updatedOrder) {
        throw new AppError('Order is already cancelled', 400);
      }

      await inventoryService.restoreInventory(updatedOrder.items);
      return updatedOrder;
    }

    // Auto timestamp transitions
    if (newStatus === 'shipped') {
      order.shippedAt = new Date();
    } else if (newStatus === 'delivered') {
      order.deliveredAt = new Date();
      if (order.paymentMethod === 'cod') {
        order.paymentStatus = 'paid';
      }
    }

    order.status = newStatus;
    await order.save();
    return order;
  }

  /**
   * Update payment status (Admin or payment webhook)
   */
  async updatePaymentStatus(
    orderId: string,
    paymentStatus: PaymentStatus
  ): Promise<IOrder> {
    const order = await this.findOrderByIdentifier(orderId);

    order.paymentStatus = paymentStatus;
    if (paymentStatus === 'paid' && order.status === 'pending') {
      order.status = 'confirmed';
    }

    await order.save();
    return order;
  }
}

export const orderService = new OrderService();
