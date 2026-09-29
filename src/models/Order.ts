import mongoose, { Schema, Model } from 'mongoose';
import crypto from 'crypto';
import { IOrder, IOrderItem, IShippingAddress } from '../types/index.js';

const orderItemSchema = new Schema<IOrderItem>(
  {
    product: {
      type: Schema.Types.ObjectId,
      ref: 'Product',
      required: [true, 'Product reference is required'],
    },
    name: {
      type: String,
      required: [true, 'Product name snapshot is required'],
      trim: true,
    },
    sku: {
      type: String,
      required: [true, 'Product SKU snapshot is required'],
      trim: true,
    },
    price: {
      type: Number,
      required: [true, 'Product price snapshot is required'],
      min: [0, 'Price cannot be negative'],
    },
    quantity: {
      type: Number,
      required: [true, 'Quantity is required'],
      min: [1, 'Quantity must be at least 1'],
    },
    size: {
      type: String,
      trim: true,
    },
    color: {
      type: String,
      trim: true,
    },
    imageUrl: {
      type: String,
      trim: true,
    },
  },
  { _id: true }
);

const shippingAddressSchema = new Schema<IShippingAddress>(
  {
    fullName: {
      type: String,
      required: [true, 'Full name for delivery is required'],
      trim: true,
    },
    phone: {
      type: String,
      required: [true, 'Phone number for delivery is required'],
      trim: true,
    },
    addressLine1: {
      type: String,
      required: [true, 'Address line 1 is required'],
      trim: true,
    },
    addressLine2: {
      type: String,
      trim: true,
    },
    city: {
      type: String,
      required: [true, 'City is required'],
      trim: true,
    },
    state: {
      type: String,
      trim: true,
    },
    postalCode: {
      type: String,
      trim: true,
    },
    country: {
      type: String,
      required: [true, 'Country is required'],
      trim: true,
      default: 'Vietnam',
    },
  },
  { _id: false }
);

const orderSchema = new Schema<IOrder>(
  {
    orderNumber: {
      type: String,
      required: [true, 'Order number is required'],
      unique: true,
      uppercase: true,
      trim: true,
    },
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
    items: {
      type: [orderItemSchema],
      required: [true, 'Order items are required'],
      validate: {
        validator: function (items: IOrderItem[]) {
          return Array.isArray(items) && items.length > 0;
        },
        message: 'Order must contain at least one item',
      },
    },
    shippingAddress: {
      type: shippingAddressSchema,
      required: [true, 'Shipping address is required'],
    },
    shippingMethod: {
      type: String,
      enum: {
        values: ['standard', 'express'],
        message: '{VALUE} is not a valid shipping method',
      },
      default: 'standard',
    },
    shippingFee: {
      type: Number,
      required: [true, 'Shipping fee is required'],
      min: [0, 'Shipping fee cannot be negative'],
      default: 0,
    },
    subtotal: {
      type: Number,
      required: [true, 'Subtotal is required'],
      min: [0, 'Subtotal cannot be negative'],
    },
    total: {
      type: Number,
      required: [true, 'Total is required'],
      min: [0, 'Total cannot be negative'],
    },
    paymentMethod: {
      type: String,
      enum: {
        values: ['cod', 'credit_card', 'momo', 'vnpay'],
        message: '{VALUE} is not a valid payment method',
      },
      required: [true, 'Payment method is required'],
      default: 'cod',
    },
    paymentStatus: {
      type: String,
      enum: {
        values: ['pending', 'paid', 'failed', 'refunded'],
        message: '{VALUE} is not a valid payment status',
      },
      default: 'pending',
      index: true,
    },
    status: {
      type: String,
      enum: {
        values: [
          'pending',
          'confirmed',
          'processing',
          'shipped',
          'delivered',
          'cancelled',
          'refunded',
        ],
        message: '{VALUE} is not a valid order status',
      },
      default: 'pending',
      index: true,
    },
    contactEmail: {
      type: String,
      trim: true,
      lowercase: true,
    },
    contactPhone: {
      type: String,
      trim: true,
    },
    notes: {
      type: String,
      trim: true,
      maxlength: [1000, 'Notes cannot exceed 1000 characters'],
    },
    cancelledAt: {
      type: Date,
    },
    cancelReason: {
      type: String,
      trim: true,
      maxlength: [500, 'Cancel reason cannot exceed 500 characters'],
    },
    deliveredAt: {
      type: Date,
    },
    shippedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes
orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ status: 1, createdAt: -1 });

// Virtual for item count
orderSchema.virtual('itemCount').get(function (this: IOrder) {
  return this.items?.reduce((sum, item) => sum + item.quantity, 0) || 0;
});

// Auto-generate orderNumber before validation if not present
orderSchema.pre('validate', function () {
  if (!this.orderNumber) {
    const dateStr = new Date().toISOString().slice(2, 10).replace(/-/g, '');
    const randomHex = crypto.randomBytes(3).toString('hex').toUpperCase();
    this.orderNumber = `GS-${dateStr}-${randomHex}`;
  }
});

export const Order: Model<IOrder> = mongoose.model<IOrder>(
  'Order',
  orderSchema
);
