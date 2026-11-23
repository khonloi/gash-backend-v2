import mongoose from 'mongoose';
import { Product } from '../models/Product.js';
import { IOrderItem, IProduct } from '../types/index.js';
import { AppError } from '../utils/AppError.js';
import { assertObjectId } from '../utils/objectId.js';
import { resolveProductVariant } from '../utils/productVariants.js';
import { logger } from '../config/logger.js';

export interface ProcessOrderItemInput {
  productId: string;
  quantity: number;
  size?: string;
  color?: string;
}

export interface InventoryItemToRestore {
  product: mongoose.Types.ObjectId | IProduct | string;
  quantity: number;
  sku?: string;
}

export class InventoryService {
  /**
   * Atomically checks stock and decrements inventory (at variant-SKU level when variants exist,
   * or product level otherwise) with automated Saga rollback if any subsequent item fails.
   */
  async processOrderItems(
    items: ProcessOrderItemInput[],
    session?: mongoose.ClientSession
  ): Promise<IOrderItem[]> {
    const orderItems: IOrderItem[] = [];
    const decremented: Array<{
      productId: mongoose.Types.ObjectId;
      quantity: number;
      variantSku?: string;
    }> = [];

    try {
      for (const item of items) {
        assertObjectId(item.productId, 'product ID');

        const existing = await Product.findById(item.productId, null, {
          ...(session ? { session } : {}),
        })
          .select('name sku price quantity variants status images')
          .lean();

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

        const resolved = resolveProductVariant(existing, {
          size: item.size,
          color: item.color,
        });

        let updated: IProduct | null = null;
        if (resolved.hasVariants) {
          updated = await Product.findOneAndUpdate(
            {
              _id: item.productId,
              status: 'active',
              variants: {
                $elemMatch: {
                  sku: resolved.sku,
                  stock: { $gte: item.quantity },
                },
              },
            },
            {
              $inc: {
                'variants.$.stock': -item.quantity,
                quantity: -item.quantity,
              },
            },
            { returnDocument: 'after', ...(session ? { session } : {}) }
          );
        } else {
          updated = await Product.findOneAndUpdate(
            {
              _id: item.productId,
              status: 'active',
              quantity: { $gte: item.quantity },
            },
            { $inc: { quantity: -item.quantity } },
            { returnDocument: 'after', ...(session ? { session } : {}) }
          );
        }

        if (!updated) {
          const fresh = await Product.findById(item.productId, null, {
            ...(session ? { session } : {}),
          })
            .select('name quantity variants status')
            .lean();
          const availableQty = fresh
            ? resolveProductVariant(fresh as IProduct, {
                size: item.size,
                color: item.color,
              }).availableStock
            : 0;
          throw new AppError(
            `Insufficient stock for "${existing.name}". Only ${availableQty} remaining.`,
            400
          );
        }

        decremented.push({
          productId: existing._id as mongoose.Types.ObjectId,
          quantity: item.quantity,
          variantSku: resolved.hasVariants ? resolved.sku : undefined,
        });

        const primaryImg =
          existing.images?.find((img) => img.isPrimary)?.url ||
          existing.images?.[0]?.url ||
          '';

        orderItems.push({
          product: existing._id as mongoose.Types.ObjectId,
          name: existing.name,
          sku: resolved.sku,
          price: resolved.unitPrice,
          quantity: item.quantity,
          size: resolved.size,
          color: resolved.color,
          imageUrl: primaryImg,
        });
      }
    } catch (error) {
      // If not running within an ACID transaction session, manually rollback decrements (Saga)
      if (!session) {
        for (const dec of decremented) {
          try {
            if (dec.variantSku) {
              await Product.updateOne(
                { _id: dec.productId, 'variants.sku': dec.variantSku },
                {
                  $inc: {
                    'variants.$.stock': dec.quantity,
                    quantity: dec.quantity,
                  },
                }
              );
            } else {
              await Product.updateOne(
                { _id: dec.productId },
                { $inc: { quantity: dec.quantity } }
              );
            }
          } catch (rollbackErr) {
            logger.error('Failed to rollback decremented inventory item:', {
              productId: dec.productId.toString(),
              variantSku: dec.variantSku,
              quantity: dec.quantity,
              rollbackErr,
            });
          }
        }
      }
      throw error;
    }

    return orderItems;
  }

  /**
   * Restores inventory quantities in bulk for cancelled orders or refunded items.
   */
  async restoreInventory(
    items: InventoryItemToRestore[],
    session?: mongoose.ClientSession
  ): Promise<void> {
    if (items.length === 0) return;

    const productIds = items.map((item) =>
      typeof item.product === 'object' && '_id' in item.product
        ? item.product._id
        : item.product
    );

    const products = await Product.find({ _id: { $in: productIds } })
      .select('variants.sku')
      .session(session ?? null)
      .lean();
    const variantSkuMap = new Map<string, Set<string>>();
    for (const prod of products) {
      variantSkuMap.set(
        prod._id.toString(),
        new Set((prod.variants || []).map((v) => v.sku))
      );
    }

    const bulkOps = items.map((item) => {
      const productId =
        typeof item.product === 'object' && '_id' in item.product
          ? item.product._id
          : item.product;
      const pidStr = String(productId);
      const hasVariantSku =
        item.sku && variantSkuMap.get(pidStr)?.has(item.sku.toUpperCase());

      if (hasVariantSku) {
        return {
          updateOne: {
            filter: {
              _id: productId,
              'variants.sku': item.sku!.toUpperCase(),
            },
            update: {
              $inc: {
                'variants.$.stock': item.quantity,
                quantity: item.quantity,
              },
            },
          },
        };
      }

      return {
        updateOne: {
          filter: { _id: productId },
          update: { $inc: { quantity: item.quantity } },
        },
      };
    });

    await Product.bulkWrite(bulkOps, session ? { session } : undefined);
  }
}

export const inventoryService = new InventoryService();
