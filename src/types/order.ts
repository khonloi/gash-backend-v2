import mongoose, { Document } from 'mongoose';
import { IProduct } from './index.js';
import { IUser } from './user.js';

export type OrderStatus =
  | 'pending'
  | 'confirmed'
  | 'processing'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'refunded';

export type PaymentMethod = 'cod' | 'credit_card' | 'momo' | 'vnpay';

export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded';

export type ShippingMethod = 'standard' | 'express';

export interface IOrderItem {
  product: mongoose.Types.ObjectId | IProduct;
  name: string;
  sku: string;
  price: number;
  quantity: number;
  size?: string;
  color?: string;
  imageUrl?: string;
}

export interface IShippingAddress {
  fullName: string;
  phone: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state?: string;
  postalCode?: string;
  country: string;
}

export interface IOrder extends Document {
  orderNumber: string;
  user?: mongoose.Types.ObjectId | IUser;
  items: IOrderItem[];
  shippingAddress: IShippingAddress;
  shippingMethod: ShippingMethod;
  shippingFee: number;
  subtotal: number;
  total: number;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  status: OrderStatus;
  contactEmail?: string;
  contactPhone?: string;
  notes?: string;
  cancelledAt?: Date;
  cancelReason?: string;
  deliveredAt?: Date;
  shippedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
