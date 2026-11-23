import { z } from 'zod';

const optionalNormalizedVariantAttr = z
  .string()
  .trim()
  .max(40)
  .optional()
  .transform((val) => (val && val.length > 0 ? val : undefined));

export const cartItemBaseSchema = z.object({
  productId: z.string().min(1, 'Product ID is required'),
  quantity: z
    .number()
    .int('Quantity must be an integer')
    .min(1, 'Quantity must be at least 1'),
  size: optionalNormalizedVariantAttr,
  color: optionalNormalizedVariantAttr,
});

export const addToCartSchema = cartItemBaseSchema;

export const updateCartItemSchema = z.object({
  quantity: z
    .number()
    .int('Quantity must be an integer')
    .min(1, 'Quantity must be at least 1'),
});

export const mergeCartSchema = z.object({
  items: z.array(cartItemBaseSchema).max(50).default([]),
});

export type AddToCartInput = z.infer<typeof addToCartSchema>;
export type UpdateCartItemInput = z.infer<typeof updateCartItemSchema>;
export type MergeCartInput = z.infer<typeof mergeCartSchema>;
