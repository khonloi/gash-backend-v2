import { z } from 'zod';
import {
  booleanQuerySchema,
  numericComparisonFilterSchema,
  paginationQuerySchema,
} from './commonValidation.js';

const productImageSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1, 'Image URL cannot be empty')
    .max(2048, 'Image URL cannot exceed 2048 characters')
    .url('Image URL must be a valid URL')
    .refine(
      (url) => url.startsWith('https://') || url.startsWith('http://'),
      'Image URL must use http:// or https://'
    ),
  altText: z.string().trim().max(200).optional(),
  isPrimary: z.boolean().optional(),
  displayOrder: z.number().int().min(0).optional(),
});

const productVariantSchema = z.object({
  sku: z
    .string({ message: 'Variant SKU is required' })
    .trim()
    .min(1, 'Variant SKU cannot be empty')
    .max(64, 'Variant SKU cannot exceed 64 characters'),
  size: z.string().trim().max(40).optional(),
  color: z.string().trim().max(40).optional(),
  price: z.number().min(0, 'Variant price cannot be negative').optional(),
  priceModifier: z.number().optional(),
  stock: z
    .number({ message: 'Variant stock is required' })
    .int('Variant stock must be an integer')
    .min(0, 'Variant stock cannot be negative'),
});

const dimensionsSchema = z.object({
  length: z.number().min(0).optional(),
  width: z.number().min(0).optional(),
  height: z.number().min(0).optional(),
});

export const createProductSchema = z.object({
  name: z
    .string('Product name is required')
    .trim()
    .min(3, 'Product name must be at least 3 characters')
    .max(200, 'Product name cannot exceed 200 characters'),
  description: z
    .string('Product description is required')
    .trim()
    .min(1, 'Product description cannot be empty')
    .max(5000, 'Product description cannot exceed 5000 characters'),
  shortDescription: z
    .string()
    .trim()
    .max(500, 'Short description cannot exceed 500 characters')
    .optional(),
  price: z
    .number('Product price is required')
    .min(0, 'Price must be greater than or equal to 0'),
  compareAtPrice: z
    .number()
    .min(0, 'Compare at price must be greater than or equal to 0')
    .optional(),
  costPrice: z
    .number()
    .min(0, 'Cost price must be greater than or equal to 0')
    .optional(),
  sku: z.string('SKU is required').trim().min(1, 'SKU cannot be empty'),
  barcode: z.string().trim().optional(),
  quantity: z
    .number()
    .int('Quantity must be an integer')
    .min(0, 'Quantity cannot be negative')
    .default(0),
  lowStockThreshold: z
    .number()
    .int('Threshold must be an integer')
    .min(0, 'Threshold cannot be negative')
    .default(5),
  category: z
    .string('Product category is required')
    .trim()
    .min(1, 'Category cannot be empty'),
  subcategory: z.string().trim().optional(),
  brand: z.string().trim().optional(),
  tags: z.array(z.string().trim().max(50)).max(50).default([]),
  images: z.array(productImageSchema).max(20).default([]),
  variants: z.array(productVariantSchema).max(50).default([]),
  attributes: z.record(z.string(), z.string()).optional(),
  status: z.enum(['draft', 'active', 'archived']).default('draft'),
  isFeatured: z.boolean().default(false),
  weight: z.number().min(0).optional(),
  dimensions: dimensionsSchema.optional(),
});

export const updateProductSchema = createProductSchema.partial();

export const updateStockSchema = z.object({
  quantity: z.number('Quantity is required').int('Quantity must be an integer'),
  operation: z.enum(['increment', 'decrement', 'set']).default('set'),
});

export const productQuerySchema = paginationQuerySchema.extend({
  keyword: z.string().trim().max(200).optional(),
  category: z.string().trim().max(100).optional(),
  subcategory: z.string().trim().max(100).optional(),
  brand: z.string().trim().max(100).optional(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
  isFeatured: booleanQuerySchema.optional(),
  minPrice: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
  tags: z.union([z.string().trim(), z.array(z.string().trim())]).optional(),
  price: numericComparisonFilterSchema.optional(),
  ratingsAverage: numericComparisonFilterSchema.optional(),
  ratingsQuantity: numericComparisonFilterSchema.optional(),
});

export const featuredProductsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type UpdateStockInput = z.infer<typeof updateStockSchema>;
export type ProductQueryInput = z.infer<typeof productQuerySchema>;
export type FeaturedProductsQueryInput = z.infer<
  typeof featuredProductsQuerySchema
>;
