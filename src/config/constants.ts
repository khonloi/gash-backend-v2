import { OrderStatus } from '../types/order.js';

/**
 * Security & Token Lifetimes (in milliseconds)
 */
export const REFRESH_TOKEN_EXPIRES_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const PASSWORD_RESET_EXPIRES_MS = 10 * 60 * 1000; // 10 minutes
export const EMAIL_VERIFICATION_EXPIRES_MS = 24 * 60 * 60 * 1000; // 24 hours
export const MAX_ACTIVE_REFRESH_TOKENS = 10;

/**
 * E-commerce Shipping Fees (in USD or base currency)
 */
export const SHIPPING_FEES = {
  STANDARD: 30,
  EXPRESS: 50,
} as const;

/**
 * Safe User Whitelist Fields
 */
export const SAFE_USER_FIELDS = [
  '_id',
  'firstName',
  'lastName',
  'email',
  'role',
  'avatar',
  'phone',
  'isActive',
  'isEmailVerified',
  'addresses',
  'createdAt',
  'updatedAt',
] as const;

export type SafeUserField = (typeof SAFE_USER_FIELDS)[number];

/**
 * Valid Order Status Transitions
 */
export const VALID_ORDER_STATUS_TRANSITIONS: Record<
  OrderStatus,
  OrderStatus[]
> = {
  pending: ['confirmed', 'processing', 'shipped', 'cancelled'],
  confirmed: ['processing', 'shipped', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['delivered', 'cancelled'],
  delivered: ['refunded'],
  cancelled: [],
  refunded: [],
};
