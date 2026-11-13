import { z } from 'zod';
import { MAX_CONTEXT_CARDS_PER_MESSAGE } from '../config/constants.js';
import { objectIdSchema } from './commonValidation.js';

export const chatContextCardInputSchema = z
  .object({
    cardType: z.enum(['product', 'order']),
    productId: objectIdSchema.optional(),
    orderId: z.string().trim().optional(),
    note: z.string().trim().max(200).optional(),
  })
  .refine(
    (data) => {
      if (data.cardType === 'product') return Boolean(data.productId);
      if (data.cardType === 'order') return Boolean(data.orderId);
      return false;
    },
    {
      message:
        'Context card must provide productId for product type, or orderId for order type',
    }
  );

export const createConversationSchema = z.object({
  subject: z.string().trim().max(200).optional(),
  mode: z.enum(['ai', 'support', 'seller']).default('ai'),
  initialMessage: z.string().trim().min(1).max(4000).optional(),
  contextCards: z
    .array(chatContextCardInputSchema)
    .max(MAX_CONTEXT_CARDS_PER_MESSAGE)
    .optional(),
});

export const sendMessageSchema = z.object({
  content: z
    .string()
    .trim()
    .min(1, 'Message cannot be empty')
    .max(4000, 'Message cannot exceed 4000 characters'),
  contextCards: z
    .array(chatContextCardInputSchema)
    .max(MAX_CONTEXT_CARDS_PER_MESSAGE)
    .optional(),
});

export const handoffSchema = z.object({
  reason: z
    .string()
    .trim()
    .max(500, 'Reason cannot exceed 500 characters')
    .optional(),
});

export const updateConversationStatusSchema = z.object({
  status: z.enum(['bot_active', 'queued', 'assigned', 'resolved', 'closed']),
});

export const conversationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  status: z
    .enum(['bot_active', 'queued', 'assigned', 'resolved', 'closed'])
    .optional(),
  mode: z.enum(['ai', 'support', 'seller']).optional(),
  assignedAgent: objectIdSchema.optional(),
  sort: z.string().optional(),
});

export const mergeChatSchema = z.object({
  guestId: z
    .string()
    .trim()
    .min(8, 'Guest ID must be at least 8 characters')
    .max(128, 'Guest ID cannot exceed 128 characters'),
});

export type ChatContextCardInput = z.infer<typeof chatContextCardInputSchema>;
export type CreateConversationInput = z.infer<typeof createConversationSchema>;
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type HandoffInput = z.infer<typeof handoffSchema>;
export type UpdateConversationStatusInput = z.infer<
  typeof updateConversationStatusSchema
>;
export type ConversationQueryInput = z.infer<typeof conversationQuerySchema>;
export type MergeChatInput = z.infer<typeof mergeChatSchema>;
