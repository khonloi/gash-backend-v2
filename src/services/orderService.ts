import mongoose from 'mongoose';
import { Order } from '../models/Order.js';
import { Product } from '../models/Product.js';
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
import { APIFeatures } from '../utils/apiFeatures.js';
import { CreateOrderInput } from '../validations/orderValidation.js';

export class OrderService {
  /**
   * Create an order from user cart or explicit items
   */
  async createOrder(
    userId: string | undefined,
    data: CreateOrderInput
  ): Promise<IOrder> {
    if (userId && !mongoose.Types.ObjectId.isValid(userId)) {
      throw new AppError(`Invalid user ID format: "${userId}"`, 400);
    }

    interface ItemToProcess {
      productId: string;
      quantity: number;
      size?: string;
      color?: string;
    }

    let itemsToProcess: ItemToProcess[] = [];

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

    // 2) Validate stock and deduct inventory with rollback tracking
    const orderItems: IOrderItem[] = [];
    const decremented: Array<{
      productId: mongoose.Types.ObjectId;
      quantity: number;
    }> = [];

    try {
      for (const item of itemsToProcess) {
        if (!mongoose.Types.ObjectId.isValid(item.productId)) {
          throw new AppError(
            `Invalid product ID format: "${item.productId}"`,
            400
          );
        }

        // Atomically check active status and available stock while decrementing
        const product = await Product.findOneAndUpdate(
          {
            _id: item.productId,
            status: 'active',
            quantity: { $gte: item.quantity },
          },
          { $inc: { quantity: -item.quantity } },
          { returnDocument: 'after' }
        );

        if (!product) {
          // Check if product exists to provide a helpful error message
          const existing = await Product.findById(item.productId);
          if (!existing) {
            throw new AppError(
              `Product with ID "${item.productId}" was not found`,
              404
            );
          }
          if (existing.status !== 'active') {
            throw new AppError(
              `Product "${existing.name}" is currently not available for purchase`,
              400
            );
          }
          throw new AppError(
            `Insufficient stock for "${existing.name}". Only ${existing.quantity} remaining.`,
            400
          );
        }

        decremented.push({
          productId: product._id as mongoose.Types.ObjectId,
          quantity: item.quantity,
        });

        const primaryImg =
          product.images?.find((img) => img.isPrimary)?.url ||
          product.images?.[0]?.url ||
          '';

        orderItems.push({
          product: product._id as mongoose.Types.ObjectId,
          name: product.name,
          sku: product.sku,
          price: product.price,
          quantity: item.quantity,
          size: item.size,
          color: item.color,
          imageUrl: primaryImg,
        });
      }
    } catch (error) {
      // Rollback any successfully decremented products on failure
      for (const dec of decremented) {
        await Product.findByIdAndUpdate(dec.productId, {
          $inc: { quantity: dec.quantity },
        });
      }
      throw error;
    }

    // 3) Calculate totals
    const subtotal = orderItems.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    );
    const shippingFee = data.shippingMethod === 'express' ? 50 : 30;
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
   * Get an order by ID or orderNumber
   */
  async getOrderById(
    orderId: string,
    userId: string,
    userRole: string = 'customer'
  ): Promise<IOrder> {
    const isObjectId = mongoose.Types.ObjectId.isValid(orderId);
    const query = isObjectId
      ? { _id: orderId }
      : { orderNumber: orderId.toUpperCase() };

    const order = await Order.findOne(query).populate(
      'user',
      'firstName lastName email phone'
    );

    if (!order) {
      throw new AppError(`Order not found with identifier "${orderId}"`, 404);
    }

    // Check ownership unless admin
    const ownerId = order.user
      ? (order.user as any)._id
        ? (order.user as any)._id.toString()
        : order.user.toString()
      : undefined;

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
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      throw new AppError(`Invalid user ID format: "${userId}"`, 400);
    }

    const baseFilter: Record<string, any> = { user: userId };
    if (queryString.status) {
      baseFilter.status = queryString.status;
    }

    // 1) Count total documents
    const countFeatures = new APIFeatures(
      Order.find(baseFilter),
      queryString
    ).filter();
    const totalResults = await countFeatures.mongooseQuery.countDocuments();

    // 2) Query with sorting and pagination
    const features = new APIFeatures(Order.find(baseFilter), queryString)
      .filter()
      .sort()
      .limitFields()
      .paginate(totalResults);

    const data = await features.mongooseQuery;

    return {
      data,
      ...features.pagination,
    };
  }

  /**
   * Get all orders with filtering and pagination (Admin only)
   */
  async getAllOrders(
    queryString: QueryString
  ): Promise<PaginatedResult<IOrder>> {
    const countFeatures = new APIFeatures(Order.find(), queryString)
      .filter()
      .search();
    const totalResults = await countFeatures.mongooseQuery.countDocuments();

    const features = new APIFeatures(
      Order.find().populate('user', 'firstName lastName email phone'),
      queryString
    )
      .filter()
      .search()
      .sort()
      .limitFields()
      .paginate(totalResults);

    const data = await features.mongooseQuery;

    return {
      data,
      ...features.pagination,
    };
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
    const isObjectId = mongoose.Types.ObjectId.isValid(orderId);
    const query = isObjectId
      ? { _id: orderId }
      : { orderNumber: orderId.toUpperCase() };

    const order = await Order.findOne(query);

    if (!order) {
      throw new AppError(`Order not found with identifier "${orderId}"`, 404);
    }

    const ownerId = order.user
      ? (order.user as any)._id
        ? (order.user as any)._id.toString()
        : order.user.toString()
      : undefined;

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
    if (
      userRole !== 'admin' &&
      !['pending', 'confirmed'].includes(order.status)
    ) {
      throw new AppError(
        `Orders in "${order.status}" status cannot be cancelled by customer`,
        400
      );
    }

    // Restore product quantities
    for (const item of order.items) {
      await Product.findByIdAndUpdate(item.product, {
        $inc: { quantity: item.quantity },
      });
    }

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
    const isObjectId = mongoose.Types.ObjectId.isValid(orderId);
    const query = isObjectId
      ? { _id: orderId }
      : { orderNumber: orderId.toUpperCase() };

    const order = await Order.findOne(query);

    if (!order) {
      throw new AppError(`Order not found with identifier "${orderId}"`, 404);
    }

    if (order.status === newStatus) {
      return order;
    }

    // If changing to cancelled, restore stock
    if (newStatus === 'cancelled' && order.status !== 'cancelled') {
      for (const item of order.items) {
        await Product.findByIdAndUpdate(item.product, {
          $inc: { quantity: item.quantity },
        });
      }
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
    const isObjectId = mongoose.Types.ObjectId.isValid(orderId);
    const query = isObjectId
      ? { _id: orderId }
      : { orderNumber: orderId.toUpperCase() };

    const order = await Order.findOne(query);

    if (!order) {
      throw new AppError(`Order not found with identifier "${orderId}"`, 404);
    }

    order.paymentStatus = paymentStatus;
    if (paymentStatus === 'paid' && order.status === 'pending') {
      order.status = 'confirmed';
    }

    await order.save();
    return order;
  }
}

export const orderService = new OrderService();
