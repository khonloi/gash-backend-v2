import { z } from 'zod';
import { cartItemBaseSchema } from './cartValidation.js';
import {
  numericComparisonFilterSchema,
  objectIdSchema,
  paginationQuerySchema,
} from './commonValidation.js';

const shippingAddressSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, 'Full name must have at least 2 characters')
    .max(100, 'Full name cannot exceed 100 characters'),
  phone: z
    .string()
    .trim()
    .min(8, 'Phone number must have at least 8 digits')
    .max(20, 'Phone number cannot exceed 20 characters'),
  addressLine1: z
    .string()
    .trim()
    .min(3, 'Address line 1 must have at least 3 characters')
    .max(200, 'Address line 1 cannot exceed 200 characters'),
  addressLine2: z
    .string()
    .trim()
    .max(200, 'Address line 2 cannot exceed 200 characters')
    .optional(),
  city: z.string().trim().min(1, 'City is required'),
  state: z.string().trim().optional(),
  postalCode: z.string().trim().optional(),
  country: z.string().trim().default('Vietnam'),
});

const orderItemInputSchema = cartItemBaseSchema;

export const createOrderSchema = z.object({
  shippingAddress: shippingAddressSchema,
  shippingMethod: z.enum(['standard', 'express']).default('standard'),
  paymentMethod: z
    .enum(['cod', 'credit_card', 'apple_pay', 'paypal', 'momo', 'vnpay'])
    .default('cod'),
  contactEmail: z
    .string()
    .email('Please provide a valid email')
    .optional()
    .or(z.literal('')),
  contactPhone: z.string().trim().optional().or(z.literal('')),
  notes: z
    .string()
    .trim()
    .max(1000, 'Notes cannot exceed 1000 characters')
    .optional(),
  idempotencyKey: z
    .string()
    .trim()
    .min(1, 'Idempotency key cannot be empty')
    .max(128, 'Idempotency key cannot exceed 128 characters')
    .optional(),
  items: z.array(orderItemInputSchema).max(50).optional(),
});

export const updateOrderStatusSchema = z.object({
  status: z.enum(
    [
      'pending',
      'confirmed',
      'processing',
      'shipped',
      'delivered',
      'cancelled',
      'refunded',
    ],
    { message: 'Invalid order status' }
  ),
});

export const updatePaymentStatusSchema = z.object({
  paymentStatus: z.enum(['pending', 'paid', 'failed', 'refunded'], {
    message: 'Invalid payment status',
  }),
});

export const cancelOrderSchema = z.object({
  reason: z
    .string()
    .trim()
    .max(500, 'Cancel reason cannot exceed 500 characters')
    .optional(),
});

const orderStatusEnum = z.enum([
  'pending',
  'confirmed',
  'processing',
  'shipped',
  'delivered',
  'cancelled',
  'refunded',
]);

const paymentStatusEnum = z.enum(['pending', 'paid', 'failed', 'refunded']);
const paymentMethodEnum = z.enum([
  'cod',
  'credit_card',
  'apple_pay',
  'paypal',
  'momo',
  'vnpay',
]);
const shippingMethodEnum = z.enum(['standard', 'express']);

export const myOrderQuerySchema = paginationQuerySchema.extend({
  status: orderStatusEnum.optional(),
  paymentStatus: paymentStatusEnum.optional(),
  paymentMethod: paymentMethodEnum.optional(),
  shippingMethod: shippingMethodEnum.optional(),
  total: numericComparisonFilterSchema.optional(),
});

export const adminOrderQuerySchema = myOrderQuerySchema.extend({
  user: objectIdSchema.optional(),
  keyword: z.string().trim().max(200).optional(),
  orderNumber: z.string().trim().max(50).optional(),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusSchema>;
export type UpdatePaymentStatusInput = z.infer<
  typeof updatePaymentStatusSchema
>;
export type CancelOrderInput = z.infer<typeof cancelOrderSchema>;
export type MyOrderQueryInput = z.infer<typeof myOrderQuerySchema>;
export type AdminOrderQueryInput = z.infer<typeof adminOrderQuerySchema>;
