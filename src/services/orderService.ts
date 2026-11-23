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

const VALID_PAYMENT_STATUS_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> =
  {
    pending: ['paid', 'failed'],
    failed: ['pending', 'paid'],
    paid: ['refunded'],
    refunded: [],
  };

function toCents(amount: number): number {
  return Math.round(amount * 100);
}

function fromCents(cents: number): number {
  return cents / 100;
}

function isDuplicateOrderNumberError(err: unknown): boolean {
  const errObj = err as { code?: number; keyPattern?: Record<string, unknown> };
  return errObj?.code === 11000 && Boolean(errObj?.keyPattern?.orderNumber);
}

async function checkTransactionSupport(): Promise<boolean> {
  try {
    const db = mongoose.connection.db;
    if (!db) return false;
    const hello = await db.admin().command({ hello: 1 });
    return Boolean(hello.setName || hello.msg === 'isdbgrid');
  } catch {
    return false;
  }
}

export class OrderService {
  /**
   * Create an order from user cart or explicit items with idempotency support
   */
  async createOrder(
    userId: string | undefined,
    data: CreateOrderInput
  ): Promise<IOrder> {
    if (userId) {
      assertObjectId(userId, 'user ID');
    }

    if (data.idempotencyKey) {
      const existing = await Order.findOne({
        idempotencyKey: data.idempotencyKey,
        ...(userId ? { user: userId } : {}),
      });
      if (existing) {
        return existing;
      }
    }

    const usedCart = !(data.items && data.items.length > 0);
    if (!usedCart && data.items!.length === 0) {
      throw new AppError('Order must contain at least one item', 400);
    }

    const loadCartItems = async (
      session?: mongoose.ClientSession
    ): Promise<ProcessOrderItemInput[]> => {
      if (!usedCart) {
        return data.items!;
      }
      if (!userId) {
        throw new AppError('Order must contain at least one item', 400);
      }
      const cart = await Cart.findOne({ user: userId }).session(
        session ?? null
      );
      if (!cart || cart.items.length === 0) {
        throw new AppError(
          'Your cart is empty. Please add items before placing an order.',
          400
        );
      }
      return cart.items.map((item) => ({
        productId: item.product.toString(),
        quantity: item.quantity,
        size: item.size,
        color: item.color,
      }));
    };

    const calculateTotals = (items: IOrderItem[]) => {
      const subtotalCents = items.reduce(
        (sum, item) => sum + toCents(item.price) * item.quantity,
        0
      );
      const shippingFee =
        data.shippingMethod === 'express'
          ? SHIPPING_FEES.EXPRESS
          : SHIPPING_FEES.STANDARD;
      const totalCents = subtotalCents + toCents(shippingFee);
      return {
        subtotal: fromCents(subtotalCents),
        shippingFee,
        total: fromCents(totalCents),
      };
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
      ...(data.idempotencyKey ? { idempotencyKey: data.idempotencyKey } : {}),
    });

    const createOrderWithRetry = async (
      payload: ReturnType<typeof buildOrderPayload>,
      session?: mongoose.ClientSession
    ): Promise<IOrder> => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          if (session) {
            const [created] = await Order.create([payload], { session });
            return created;
          }
          return await Order.create(payload);
        } catch (err) {
          if (isDuplicateOrderNumberError(err) && attempt < 2) {
            continue;
          }
          throw err;
        }
      }
      throw new AppError('Failed to generate unique order number', 500);
    };

    // Attempt multi-document ACID transaction when MongoDB supports transactions
    let order: IOrder | undefined;
    const supportsTransactions = await checkTransactionSupport();

    if (supportsTransactions) {
      let session: mongoose.ClientSession | null = null;
      try {
        session = await mongoose.startSession();
        await session.withTransaction(async () => {
          const itemsToProcess = await loadCartItems(session!);
          const orderItems = await inventoryService.processOrderItems(
            itemsToProcess,
            session!
          );
          const totals = calculateTotals(orderItems);
          order = await createOrderWithRetry(
            buildOrderPayload(orderItems, totals),
            session!
          );

          if (usedCart && userId) {
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
          errorMsg.includes('retryable write') ||
          errorMsg.includes('standalone') ||
          (err as { codeName?: string })?.codeName === 'IllegalOperation';

        if (!isStandaloneUnsupported) {
          throw err;
        }
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

    // Fallback: Saga compensation pattern for standalone MongoDB instances
    const itemsToProcess = await loadCartItems();
    const orderItems = await inventoryService.processOrderItems(itemsToProcess);
    const totals = calculateTotals(orderItems);

    try {
      order = await createOrderWithRetry(buildOrderPayload(orderItems, totals));
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

    // Clear cart AFTER order creation committed (outside rollback try/catch so a cart failure never restores stock)
    if (usedCart && userId) {
      await Cart.updateOne({ user: userId }, { $set: { items: [] } }).catch(
        (cartErr) => {
          logger.warn('Failed to clear cart after order creation:', {
            userId,
            orderId: order?._id,
            cartErr,
          });
        }
      );
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
   * Shared atomic cancellation + stock restoration helper
   */
  private async executeOrderCancellation(
    order: IOrder,
    cancelReason: string,
    allowedCurrentStatuses: OrderStatus[]
  ): Promise<IOrder> {
    const supportsTransactions = await checkTransactionSupport();

    const performAtomicCancel = async (
      session?: mongoose.ClientSession
    ): Promise<IOrder> => {
      const now = new Date();
      const updatedOrder = await Order.findOneAndUpdate(
        {
          _id: order._id,
          status: { $in: allowedCurrentStatuses },
          paymentStatus: order.paymentStatus,
        },
        {
          $set: {
            status: 'cancelled',
            cancelledAt: now,
            cancelReason,
            ...(order.paymentStatus === 'paid'
              ? { paymentStatus: 'refunded', refundedAt: now }
              : {}),
          },
        },
        { returnDocument: 'after', ...(session ? { session } : {}) }
      );

      if (!updatedOrder) {
        const refreshed = await Order.findById(order._id).session(
          session ?? null
        );
        if (refreshed?.status === 'cancelled') {
          throw new AppError('This order is already cancelled', 400);
        }
        if (refreshed?.status === 'delivered') {
          throw new AppError('Delivered orders cannot be cancelled', 400);
        }
        if (refreshed?.status === 'refunded') {
          throw new AppError('Refunded orders cannot be cancelled', 400);
        }
        throw new AppError(
          'Order status changed concurrently; cannot cancel in its current state',
          409
        );
      }

      await inventoryService.restoreInventory(updatedOrder.items, session);
      return updatedOrder;
    };

    if (supportsTransactions) {
      const session = await mongoose.startSession();
      try {
        let result: IOrder | undefined;
        await session.withTransaction(async () => {
          result = await performAtomicCancel(session);
        });
        if (result) return result;
      } catch (err: unknown) {
        const errorMsg = (err as Error)?.message || '';
        const isStandaloneUnsupported =
          errorMsg.includes('replica set') ||
          errorMsg.includes('Transaction numbers are only allowed') ||
          errorMsg.includes('retryable write') ||
          errorMsg.includes('standalone') ||
          (err as { codeName?: string })?.codeName === 'IllegalOperation';
        if (!isStandaloneUnsupported) {
          throw err;
        }
      } finally {
        await session.endSession();
      }
    }

    return performAtomicCancel();
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

    const lockedFilter: Record<string, unknown> = { user: userId };

    return paginateQuery(() => Order.find(lockedFilter), queryString, {
      search: false,
      lockedFilter,
      allowedFilterFields: [
        'status',
        'paymentStatus',
        'paymentMethod',
        'shippingMethod',
        'total',
      ],
      allowedSortFields: [
        'createdAt',
        'updatedAt',
        'total',
        'subtotal',
        'status',
      ],
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
      allowedFilterFields: [
        'user',
        'status',
        'paymentStatus',
        'paymentMethod',
        'shippingMethod',
        'orderNumber',
        'total',
      ],
      allowedSortFields: [
        'createdAt',
        'updatedAt',
        'total',
        'subtotal',
        'status',
        'orderNumber',
      ],
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
    if (order.status === 'refunded') {
      throw new AppError('Refunded orders cannot be cancelled', 400);
    }

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

    const allowedStatuses: OrderStatus[] =
      userRole === 'admin'
        ? ['pending', 'confirmed', 'processing', 'shipped']
        : ['pending', 'confirmed'];

    return this.executeOrderCancellation(order, cancelReason, allowedStatuses);
  }

  /**
   * Update order status (Admin only) with atomic transition guard
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

    if (newStatus === 'cancelled') {
      return this.executeOrderCancellation(
        order,
        'Cancelled by administrator',
        [order.status]
      );
    }

    const now = new Date();
    const updateFields: Record<string, unknown> = { status: newStatus };

    if (newStatus === 'shipped') {
      updateFields.shippedAt = now;
    } else if (newStatus === 'delivered') {
      updateFields.deliveredAt = now;
      if (order.paymentMethod === 'cod') {
        updateFields.paymentStatus = 'paid';
      }
    } else if (newStatus === 'refunded') {
      updateFields.paymentStatus = 'refunded';
      updateFields.refundedAt = now;
    }

    const updatedOrder = await Order.findOneAndUpdate(
      { _id: order._id, status: order.status },
      { $set: updateFields },
      { returnDocument: 'after', runValidators: true }
    );

    if (!updatedOrder) {
      throw new AppError(
        'Order status changed concurrently; please retry',
        409
      );
    }

    return updatedOrder;
  }

  /**
   * Update payment status (Admin or payment webhook) with transition validation
   */
  async updatePaymentStatus(
    orderId: string,
    paymentStatus: PaymentStatus
  ): Promise<IOrder> {
    const order = await this.findOrderByIdentifier(orderId);

    if (order.status === 'cancelled' || order.status === 'refunded') {
      throw new AppError(
        `Cannot update payment status on a ${order.status} order`,
        400
      );
    }

    if (order.paymentStatus === paymentStatus) {
      return order;
    }

    const allowedNext =
      VALID_PAYMENT_STATUS_TRANSITIONS[order.paymentStatus] || [];
    if (!allowedNext.includes(paymentStatus)) {
      throw new AppError(
        `Cannot transition payment status from "${order.paymentStatus}" to "${paymentStatus}"`,
        400
      );
    }

    const updateFields: Record<string, unknown> = { paymentStatus };
    if (paymentStatus === 'paid' && order.status === 'pending') {
      updateFields.status = 'confirmed';
    }
    if (paymentStatus === 'refunded') {
      updateFields.refundedAt = new Date();
    }

    const updatedOrder = await Order.findOneAndUpdate(
      {
        _id: order._id,
        paymentStatus: order.paymentStatus,
        status: order.status,
      },
      { $set: updateFields },
      { returnDocument: 'after', runValidators: true }
    );

    if (!updatedOrder) {
      throw new AppError(
        'Order payment state changed concurrently; please retry',
        409
      );
    }

    return updatedOrder;
  }
}

export const orderService = new OrderService();
