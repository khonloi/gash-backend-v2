import mongoose from 'mongoose';
import { Product } from '../models/Product.js';
import { IOrderItem, IProduct } from '../types/index.js';
import { AppError } from '../utils/AppError.js';
import { assertObjectId } from '../utils/objectId.js';

export interface ProcessOrderItemInput {
  productId: string;
  quantity: number;
  size?: string;
  color?: string;
}

export interface InventoryItemToRestore {
  product: mongoose.Types.ObjectId | IProduct | string;
  quantity: number;
}

export class InventoryService {
  /**
   * Atomically checks stock and decrements inventory for an order with automated rollback if any item fails.
   * Returns populated order item snapshots.
   */
  async processOrderItems(
    items: ProcessOrderItemInput[]
  ): Promise<IOrderItem[]> {
    const orderItems: IOrderItem[] = [];
    const decremented: Array<{
      productId: mongoose.Types.ObjectId;
      quantity: number;
    }> = [];

    try {
      for (const item of items) {
        assertObjectId(item.productId, 'product ID');

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

    return orderItems;
  }

  /**
   * Restores inventory quantities for cancelled orders or refunded items.
   */
  async restoreInventory(items: InventoryItemToRestore[]): Promise<void> {
    for (const item of items) {
      const productId =
        typeof item.product === 'object' && '_id' in item.product
          ? item.product._id
          : item.product;

      await Product.findByIdAndUpdate(productId, {
        $inc: { quantity: item.quantity },
      });
    }
  }
}

export const inventoryService = new InventoryService();
