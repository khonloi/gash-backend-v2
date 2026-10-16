import mongoose, { Schema, Model } from 'mongoose';
import { ICart, ICartItem } from '../types/index.js';
import { commonItemVariantFields } from './commonSchema.js';

const cartItemSchema = new Schema<ICartItem>(
  {
    product: {
      type: Schema.Types.ObjectId,
      ref: 'Product',
      required: [true, 'Product reference is required'],
    },
    ...commonItemVariantFields,
    priceAtAdd: {
      type: Number,
      required: [true, 'Price at time of adding is required'],
      min: [0, 'Price cannot be negative'],
    },
  },
  { _id: true }
);

const cartSchema = new Schema<ICart>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User reference is required'],
      unique: true,
    },
    items: {
      type: [cartItemSchema],
      default: [],
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

cartSchema.virtual('totalPrice').get(function (this: ICart) {
  return this.items.reduce(
    (total, item) => total + item.priceAtAdd * item.quantity,
    0
  );
});

cartSchema.virtual('totalItems').get(function (this: ICart) {
  return this.items.reduce((total, item) => total + item.quantity, 0);
});

export const Cart: Model<ICart> = mongoose.model<ICart>('Cart', cartSchema);
