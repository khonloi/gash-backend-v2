import { Cart } from '../models/Cart.js';
import { Product } from '../models/Product.js';
import { ICart, ICartItem } from '../types/index.js';
import { AppError } from '../utils/AppError.js';
import {
  AddToCartInput,
  MergeCartInput,
} from '../validations/cartValidation.js';
import { assertObjectId, isValidObjectId } from '../utils/objectId.js';
import { resolveOwnerId } from '../utils/resolveOwnerId.js';
import {
  normalizeVariantAttr,
  resolveProductVariant,
} from '../utils/productVariants.js';

export const CART_PRODUCT_PROJECTION =
  'name slug price images quantity variants sku brand status';

/**
 * Checks whether a cart item matches the target product ID, size, and color.
 */
export function isSameCartItem(
  item: ICartItem,
  match: { productId: string; size?: string; color?: string }
): boolean {
  const itemProdId = resolveOwnerId(item.product) ?? String(item.product);
  const itemSize = normalizeVariantAttr(item.size)?.toLowerCase();
  const itemColor = normalizeVariantAttr(item.color)?.toLowerCase();
  const matchSize = normalizeVariantAttr(match.size)?.toLowerCase();
  const matchColor = normalizeVariantAttr(match.color)?.toLowerCase();

  return (
    itemProdId === match.productId &&
    itemSize === matchSize &&
    itemColor === matchColor
  );
}

/**
 * Finds the index of a matching item in the cart.
 */
export function findCartItemIndex(
  items: ICartItem[],
  productId: string,
  size?: string,
  color?: string
): number {
  return items.findIndex((item) =>
    isSameCartItem(item, { productId, size, color })
  );
}

function getOtherItemsQuantityForProduct(
  items: ICartItem[],
  productId: string,
  excludeItemId?: string
): number {
  return items.reduce((sum, i) => {
    if (excludeItemId && i._id?.toString() === excludeItemId) return sum;
    const pid = resolveOwnerId(i.product) ?? String(i.product);
    return pid === productId ? sum + i.quantity : sum;
  }, 0);
}

export class CartService {
  private populateCart(cart: ICart): Promise<ICart> {
    return cart.populate('items.product', CART_PRODUCT_PROJECTION);
  }

  private async getOrCreateCart(userId: string): Promise<ICart> {
    return Cart.findOneAndUpdate(
      { user: userId },
      { $setOnInsert: { user: userId, items: [] } },
      { upsert: true, returnDocument: 'after' }
    );
  }

  private async findCartWithValidItem(
    userId: string,
    itemId: string
  ): Promise<ICart> {
    assertObjectId(itemId, 'item ID');

    const cart = await Cart.findOne({ user: userId });
    if (!cart) {
      throw new AppError('Cart not found', 404);
    }

    return cart;
  }

  async getCart(userId: string): Promise<ICart> {
    const cart = await this.getOrCreateCart(userId);
    return this.populateCart(cart);
  }

  async addItem(userId: string, itemData: AddToCartInput): Promise<ICart> {
    const { productId, quantity } = itemData;
    const size = normalizeVariantAttr(itemData.size);
    const color = normalizeVariantAttr(itemData.color);

    assertObjectId(productId, 'product ID');

    const product = await Product.findById(productId)
      .select('price sku quantity variants status')
      .lean();
    if (!product) {
      throw new AppError('Product not found', 404);
    }

    if (product.status !== 'active') {
      throw new AppError('Product is no longer available', 400);
    }

    const resolved = resolveProductVariant(product, { size, color });
    const cart = await this.getOrCreateCart(userId);

    const existingItemIndex = findCartItemIndex(
      cart.items,
      productId,
      resolved.size,
      resolved.color
    );

    const existingSlotQty =
      existingItemIndex > -1 ? cart.items[existingItemIndex].quantity : 0;
    const newSlotQty = existingSlotQty + quantity;

    if (resolved.hasVariants) {
      if (resolved.availableStock < newSlotQty) {
        throw new AppError(
          `Insufficient stock. Available: ${resolved.availableStock}`,
          400
        );
      }
    } else {
      const otherVariantQty = getOtherItemsQuantityForProduct(
        cart.items,
        productId,
        existingItemIndex > -1
          ? cart.items[existingItemIndex]._id?.toString()
          : undefined
      );
      if (resolved.availableStock < otherVariantQty + newSlotQty) {
        throw new AppError(
          `Insufficient stock. Available: ${resolved.availableStock}`,
          400
        );
      }
    }

    if (existingItemIndex > -1) {
      cart.items[existingItemIndex].quantity = newSlotQty;
      cart.items[existingItemIndex].priceAtAdd = resolved.unitPrice;
    } else {
      cart.items.push({
        product: product._id,
        quantity,
        size: resolved.size,
        color: resolved.color,
        priceAtAdd: resolved.unitPrice,
      } as ICartItem);
    }

    await cart.save();
    return this.populateCart(cart);
  }

  async updateItemQty(
    userId: string,
    itemId: string,
    quantity: number
  ): Promise<ICart> {
    const cart = await this.findCartWithValidItem(userId, itemId);

    const item = cart.items.find((i) => i._id?.toString() === itemId);
    if (!item) {
      throw new AppError('Item not found in cart', 404);
    }

    const product = await Product.findById(item.product)
      .select('price sku quantity variants status')
      .lean();
    if (!product || product.status !== 'active') {
      throw new AppError('Product no longer exists', 404);
    }

    const resolved = resolveProductVariant(product, {
      size: item.size,
      color: item.color,
    });

    if (resolved.hasVariants) {
      if (resolved.availableStock < quantity) {
        throw new AppError(
          `Insufficient stock. Available: ${resolved.availableStock}`,
          400
        );
      }
    } else {
      const otherQty = getOtherItemsQuantityForProduct(
        cart.items,
        product._id.toString(),
        itemId
      );
      if (resolved.availableStock < otherQty + quantity) {
        throw new AppError(
          `Insufficient stock. Available: ${resolved.availableStock}`,
          400
        );
      }
    }

    item.quantity = quantity;
    item.priceAtAdd = resolved.unitPrice;
    await cart.save();

    return this.populateCart(cart);
  }

  async removeItem(userId: string, itemId: string): Promise<ICart> {
    const cart = await this.findCartWithValidItem(userId, itemId);

    const initialLength = cart.items.length;
    cart.items = cart.items.filter((i) => i._id?.toString() !== itemId);
    if (cart.items.length === initialLength) {
      throw new AppError('Item not found in cart', 404);
    }

    await cart.save();
    return this.populateCart(cart);
  }

  async clearCart(userId: string): Promise<void> {
    await Cart.updateOne({ user: userId }, { $set: { items: [] } });
  }

  async mergeCart(
    userId: string,
    localCartData: MergeCartInput
  ): Promise<ICart> {
    const cart = await this.getOrCreateCart(userId);

    const validProductIds = Array.from(
      new Set(
        localCartData.items
          .map((i) => i.productId)
          .filter((id) => isValidObjectId(id))
      )
    );

    if (validProductIds.length === 0) {
      return this.populateCart(cart);
    }

    const products = await Product.find({
      _id: { $in: validProductIds },
      status: 'active',
    })
      .select('price sku quantity variants status')
      .lean();
    const productMap = new Map(products.map((p) => [p._id.toString(), p]));

    for (const localItem of localCartData.items) {
      const product = productMap.get(localItem.productId);
      if (!product) continue;

      let resolved;
      try {
        resolved = resolveProductVariant(product, {
          size: localItem.size,
          color: localItem.color,
        });
      } catch {
        continue;
      }

      const existingItemIndex = findCartItemIndex(
        cart.items,
        localItem.productId,
        resolved.size,
        resolved.color
      );

      const existingSlotQty =
        existingItemIndex > -1 ? cart.items[existingItemIndex].quantity : 0;
      let targetQty = existingSlotQty + localItem.quantity;

      if (resolved.hasVariants) {
        targetQty = Math.min(targetQty, resolved.availableStock);
      } else {
        const otherQty = getOtherItemsQuantityForProduct(
          cart.items,
          localItem.productId,
          existingItemIndex > -1
            ? cart.items[existingItemIndex]._id?.toString()
            : undefined
        );
        const remainingForSlot = Math.max(
          0,
          resolved.availableStock - otherQty
        );
        targetQty = Math.min(targetQty, remainingForSlot);
      }

      if (targetQty <= 0) continue;

      if (existingItemIndex > -1) {
        cart.items[existingItemIndex].quantity = targetQty;
        cart.items[existingItemIndex].priceAtAdd = resolved.unitPrice;
      } else {
        cart.items.push({
          product: product._id,
          quantity: targetQty,
          size: resolved.size,
          color: resolved.color,
          priceAtAdd: resolved.unitPrice,
        } as ICartItem);
      }
    }

    await cart.save();
    return this.populateCart(cart);
  }
}

export const cartService = new CartService();
