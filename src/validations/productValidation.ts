import { z } from 'zod';

const productImageSchema = z.object({
  url: z.string().min(1, 'Image URL cannot be empty'),
  altText: z.string().optional(),
  isPrimary: z.boolean().optional(),
  displayOrder: z.number().int().optional(),
});

const productVariantSchema = z.object({
  name: z.string().min(1, 'Variant name is required'),
  options: z.array(z.string()).min(1, 'Variant must have at least one option'),
  sku: z.string().optional(),
  priceModifier: z.number().optional(),
  stock: z.number().int().min(0, 'Variant stock cannot be negative').optional(),
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
  tags: z.array(z.string().trim()).default([]),
  images: z.array(productImageSchema).default([]),
  variants: z.array(productVariantSchema).default([]),
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

export const productQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  sort: z.string().optional(),
  fields: z.string().optional(),
  keyword: z.string().optional(),
  category: z.string().optional(),
  subcategory: z.string().optional(),
  brand: z.string().optional(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
  isFeatured: z.coerce.boolean().optional(),
  minPrice: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type UpdateStockInput = z.infer<typeof updateStockSchema>;
export type ProductQueryInput = z.infer<typeof productQuerySchema>;
