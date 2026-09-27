import { z } from 'zod';

const cartItemBaseSchema = z.object({
  productId: z.string().min(1, 'Product ID is required'),
  quantity: z
    .number()
    .int('Quantity must be an integer')
    .min(1, 'Quantity must be at least 1'),
  size: z.string().trim().optional(),
  color: z.string().trim().optional(),
});

export const addToCartSchema = z.object({
  productId: z.string().min(1, 'Product ID is required'),
  quantity: z
    .number()
    .int('Quantity must be an integer')
    .min(1, 'Quantity must be at least 1'),
  size: z.string().trim().optional(),
  color: z.string().trim().optional(),
});

export const updateCartItemSchema = z.object({
  quantity: z
    .number()
    .int('Quantity must be an integer')
    .min(1, 'Quantity must be at least 1'),
});

export const mergeCartSchema = z.object({
  items: z.array(cartItemBaseSchema).default([]),
});

export type AddToCartInput = z.infer<typeof addToCartSchema>;
export type UpdateCartItemInput = z.infer<typeof updateCartItemSchema>;
export type MergeCartInput = z.infer<typeof mergeCartSchema>;
