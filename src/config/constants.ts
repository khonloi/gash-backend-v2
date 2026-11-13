import { OrderStatus } from '../types/order.js';
import { ConversationStatus } from '../types/chat.js';

/**
 * Security & Token Lifetimes (in milliseconds)
 */
export const REFRESH_TOKEN_EXPIRES_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const REFRESH_TOKEN_GRACE_PERIOD_MS = 30 * 1000; // 30 seconds rotation grace window
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

/**
 * Chat System Projections & Constants
 */
export const CHAT_PRODUCT_PROJECTION =
  'name slug price compareAtPrice images category brand status quantity';

export const CHAT_ORDER_PROJECTION =
  'orderNumber status paymentStatus shippingMethod subtotal shippingFee total createdAt';

export const CHAT_USER_PROJECTION = '_id firstName lastName avatar role email';

export const MAX_CONTEXT_CARDS_PER_MESSAGE = 5;
export const DEFAULT_CHAT_PAGE_LIMIT = 30;

/**
 * Valid Conversation Status Transitions
 */
export const VALID_CONVERSATION_STATUS_TRANSITIONS: Record<
  ConversationStatus,
  ConversationStatus[]
> = {
  bot_active: ['queued', 'closed', 'resolved'],
  queued: ['assigned', 'closed', 'resolved', 'bot_active'],
  assigned: ['resolved', 'closed', 'queued'],
  resolved: ['queued', 'closed', 'bot_active'],
  closed: ['queued', 'bot_active'],
};
