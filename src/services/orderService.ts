import mongoose from 'mongoose';
import { Order } from '../models/Order.js';
import { Cart } from '../models/Cart.js';
import {
  IOrder,
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

    // 2) Validate stock and deduct inventory with automated rollback tracking via InventoryService
    const orderItems = await inventoryService.processOrderItems(itemsToProcess);

    // 3) Calculate totals
    const subtotal = orderItems.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    );
    const shippingFee =
      data.shippingMethod === 'express'
        ? SHIPPING_FEES.EXPRESS
        : SHIPPING_FEES.STANDARD;
    const total = subtotal + shippingFee;

    // 4) Create Order
    const order = await Order.create({
      user: userId,
      items: orderItems,
      shippingAddress: data.shippingAddress,
      shippingMethod: data.shippingMethod,
      shippingFee,
      subtotal,
      total,
      paymentMethod: data.paymentMethod,
      paymentStatus: 'pending',
      status: 'pending',
      contactEmail: data.contactEmail || undefined,
      contactPhone: data.contactPhone || undefined,
      notes: data.notes,
    });

    // 5) Clear user's active cart after order placement if user is logged in
    if (userId) {
      await Cart.findOneAndUpdate({ user: userId }, { items: [] });
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

    // Restore product quantities via InventoryService
    await inventoryService.restoreInventory(order.items);

    order.status = 'cancelled';
    order.cancelledAt = new Date();
    order.cancelReason =
      reason ||
      (userRole === 'admin'
        ? 'Cancelled by store administrator'
        : 'Cancelled by customer');

    if (order.paymentStatus === 'paid') {
      order.paymentStatus = 'refunded';
    }

    await order.save();
    return order;
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

    // If changing to cancelled, restore stock
    if (newStatus === 'cancelled' && order.status !== 'cancelled') {
      await inventoryService.restoreInventory(order.items);
      order.cancelledAt = new Date();
      order.cancelReason = 'Cancelled by administrator';
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
