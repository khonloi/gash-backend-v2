import { z } from 'zod';

export const objectIdSchema = z
  .string()
  .trim()
  .regex(/^[0-9a-fA-F]{24}$/, 'Invalid ObjectId format');

export const idParamSchema = z.object({
  id: objectIdSchema,
});

export const orderIdParamSchema = z.object({
  orderId: z.string().trim().min(1, 'Order ID is required'),
});

export const itemIdParamSchema = z.object({
  itemId: objectIdSchema,
});

export const addressIdParamSchema = z.object({
  addressId: objectIdSchema,
});

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  sort: z.string().max(200).optional(),
  fields: z.string().max(500).optional(),
});

export const booleanQuerySchema = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((val) => val === true || val === 'true' || val === '1');

export const numericComparisonFilterSchema = z.union([
  z.coerce.number(),
  z.object({
    gte: z.coerce.number().optional(),
    gt: z.coerce.number().optional(),
    lte: z.coerce.number().optional(),
    lt: z.coerce.number().optional(),
    ne: z.coerce.number().optional(),
  }),
]);

export type PaginationQueryInput = z.infer<typeof paginationQuerySchema>;
export type IdParamInput = z.infer<typeof idParamSchema>;
export type OrderIdParamInput = z.infer<typeof orderIdParamSchema>;
export type ItemIdParamInput = z.infer<typeof itemIdParamSchema>;
export type AddressIdParamInput = z.infer<typeof addressIdParamSchema>;
