import mongoose from 'mongoose';
import { Cart } from '../models/Cart.js';
import { Product } from '../models/Product.js';
import { ICart, ICartItem } from '../types/index.js';
import { AppError } from '../utils/AppError.js';
import {
  AddToCartInput,
  MergeCartInput,
} from '../validations/cartValidation.js';

export class CartService {
  async getCart(userId: string): Promise<ICart> {
    let cart = await Cart.findOne({ user: userId }).populate(
      'items.product',
      'name slug price images quantity brand status'
    );
    if (!cart) {
      cart = await Cart.create({ user: userId, items: [] });
    }
    return cart;
  }

  async addItem(userId: string, itemData: AddToCartInput): Promise<ICart> {
    const { productId, quantity, size, color } = itemData;

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      throw new AppError(`Invalid product ID format: "${productId}"`, 400);
    }

    const product = await Product.findById(productId);
    if (!product) {
      throw new AppError(`Product not found`, 404);
    }

    if (product.status !== 'active') {
      throw new AppError(`Product is no longer available`, 400);
    }

    if (product.quantity < quantity) {
      throw new AppError(
        `Insufficient stock. Available: ${product.quantity}`,
        400
      );
    }

    let cart = await Cart.findOne({ user: userId });
    if (!cart) {
      cart = await Cart.create({ user: userId, items: [] });
    }

    const existingItemIndex = cart.items.findIndex(
      (item) =>
        item.product.toString() === productId &&
        item.size === size &&
        item.color === color
    );

    if (existingItemIndex > -1) {
      const newQuantity = cart.items[existingItemIndex].quantity + quantity;
      if (product.quantity < newQuantity) {
        throw new AppError(
          `Insufficient stock. Available: ${product.quantity}`,
          400
        );
      }
      cart.items[existingItemIndex].quantity = newQuantity;
    } else {
      cart.items.push({
        product: product._id,
        quantity,
        size,
        color,
        priceAtAdd: product.price,
      } as ICartItem);
    }

    await cart.save();
    return cart.populate(
      'items.product',
      'name slug price images quantity brand status'
    );
  }

  async updateItemQty(
    userId: string,
    itemId: string,
    quantity: number
  ): Promise<ICart> {
    if (!mongoose.Types.ObjectId.isValid(itemId)) {
      throw new AppError(`Invalid item ID format: "${itemId}"`, 400);
    }

    const cart = await Cart.findOne({ user: userId });
    if (!cart) {
      throw new AppError('Cart not found', 404);
    }

    const item = cart.items.find((i) => i._id?.toString() === itemId);
    if (!item) {
      throw new AppError('Item not found in cart', 404);
    }

    const product = await Product.findById(item.product);
    if (!product) {
      throw new AppError('Product no longer exists', 404);
    }

    if (product.quantity < quantity) {
      throw new AppError(
        `Insufficient stock. Available: ${product.quantity}`,
        400
      );
    }

    item.quantity = quantity;
    await cart.save();

    return cart.populate(
      'items.product',
      'name slug price images quantity brand status'
    );
  }

  async removeItem(userId: string, itemId: string): Promise<ICart> {
    if (!mongoose.Types.ObjectId.isValid(itemId)) {
      throw new AppError(`Invalid item ID format: "${itemId}"`, 400);
    }

    const cart = await Cart.findOne({ user: userId });
    if (!cart) {
      throw new AppError('Cart not found', 404);
    }

    cart.items = cart.items.filter((i) => i._id?.toString() !== itemId);
    await cart.save();

    return cart.populate(
      'items.product',
      'name slug price images quantity brand status'
    );
  }

  async clearCart(userId: string): Promise<void> {
    const cart = await Cart.findOne({ user: userId });
    if (cart) {
      cart.items = [];
      await cart.save();
    }
  }

  async mergeCart(
    userId: string,
    localCartData: MergeCartInput
  ): Promise<ICart> {
    let cart = await Cart.findOne({ user: userId });
    if (!cart) {
      cart = await Cart.create({ user: userId, items: [] });
    }

    for (const localItem of localCartData.items) {
      const { productId, quantity, size, color } = localItem;
      if (!mongoose.Types.ObjectId.isValid(productId)) continue;

      const product = await Product.findById(productId);
      if (!product || product.status !== 'active') continue;

      const existingItemIndex = cart.items.findIndex(
        (item) =>
          item.product.toString() === productId &&
          item.size === size &&
          item.color === color
      );

      let newQuantity = quantity;
      if (existingItemIndex > -1) {
        newQuantity = cart.items[existingItemIndex].quantity + quantity;
      }

      if (product.quantity < newQuantity) {
        newQuantity = product.quantity;
      }

      if (newQuantity <= 0) continue;

      if (existingItemIndex > -1) {
        cart.items[existingItemIndex].quantity = newQuantity;
      } else {
        cart.items.push({
          product: product._id,
          quantity: newQuantity,
          size,
          color,
          priceAtAdd: product.price,
        } as ICartItem);
      }
    }

    await cart.save();
    return cart.populate(
      'items.product',
      'name slug price images quantity brand status'
    );
  }
}

export const cartService = new CartService();
