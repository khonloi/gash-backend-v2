import { z } from 'zod';
import {
  booleanQuerySchema,
  paginationQuerySchema,
} from './commonValidation.js';

const safeHttpUrlSchema = z
  .string()
  .trim()
  .max(2048, 'URL cannot exceed 2048 characters')
  .url('Must be a valid URL')
  .refine(
    (url) => url.startsWith('https://') || url.startsWith('http://'),
    'URL must use http:// or https://'
  );

export const updateMeSchema = z
  .object({
    firstName: z
      .string()
      .trim()
      .min(1, 'First name cannot be empty')
      .max(50, 'First name cannot exceed 50 characters')
      .optional(),
    lastName: z
      .string()
      .trim()
      .min(1, 'Last name cannot be empty')
      .max(50, 'Last name cannot exceed 50 characters')
      .optional(),
    phone: z
      .string()
      .trim()
      .max(20, 'Phone number cannot exceed 20 characters')
      .optional(),
    avatar: safeHttpUrlSchema.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one profile field must be provided',
  });

const addressBaseSchema = z.object({
  label: z
    .string()
    .trim()
    .min(1, 'Label cannot be empty')
    .max(50, 'Label cannot exceed 50 characters'),
  fullName: z
    .string({ message: 'Full name is required' })
    .trim()
    .min(1, 'Full name cannot be empty')
    .max(100, 'Full name cannot exceed 100 characters'),
  addressLine1: z
    .string({ message: 'Address line 1 is required' })
    .trim()
    .min(1, 'Address line 1 cannot be empty')
    .max(200, 'Address line 1 cannot exceed 200 characters'),
  addressLine2: z
    .string()
    .trim()
    .max(200, 'Address line 2 cannot exceed 200 characters')
    .optional(),
  city: z
    .string({ message: 'City is required' })
    .trim()
    .min(1, 'City cannot be empty')
    .max(100, 'City cannot exceed 100 characters'),
  state: z
    .string({ message: 'State/Province is required' })
    .trim()
    .min(1, 'State cannot be empty')
    .max(100, 'State cannot exceed 100 characters'),
  postalCode: z
    .string({ message: 'Postal code is required' })
    .trim()
    .min(1, 'Postal code cannot be empty')
    .max(20, 'Postal code cannot exceed 20 characters'),
  country: z
    .string()
    .trim()
    .min(1, 'Country cannot be empty')
    .max(60, 'Country cannot exceed 60 characters'),
  phone: z
    .string()
    .trim()
    .max(20, 'Phone number cannot exceed 20 characters')
    .optional(),
  isDefault: z.boolean(),
});

export const addressSchema = addressBaseSchema.extend({
  label: addressBaseSchema.shape.label.default('Home'),
  country: addressBaseSchema.shape.country.default('US'),
  isDefault: addressBaseSchema.shape.isDefault.default(false),
});

export const updateAddressSchema = addressBaseSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one address field must be provided',
  });

export const updateUserRoleSchema = z.object({
  role: z.enum(['customer', 'seller', 'admin'], {
    message: 'Role must be customer, seller, or admin',
  }),
});

export const userQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
  keyword: z.string().trim().max(200).optional(),
  role: z.enum(['customer', 'seller', 'admin']).optional(),
  isActive: booleanQuerySchema.optional(),
});

export type UpdateMeInput = z.infer<typeof updateMeSchema>;
export type AddressInput = z.infer<typeof addressSchema>;
export type UpdateAddressInput = z.infer<typeof updateAddressSchema>;
export type UpdateUserRoleInput = z.infer<typeof updateUserRoleSchema>;
export type UserQueryInput = z.infer<typeof userQuerySchema>;
