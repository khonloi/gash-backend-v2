import { z } from 'zod';

export const updateMeSchema = z.object({
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
  phone: z.string().trim().optional(),
  avatar: z.string().trim().url('Avatar must be a valid URL').optional(),
});

export const addressSchema = z.object({
  label: z.string().trim().min(1, 'Label cannot be empty').default('Home'),
  fullName: z
    .string({ message: 'Full name is required' })
    .trim()
    .min(1, 'Full name cannot be empty'),
  addressLine1: z
    .string({ message: 'Address line 1 is required' })
    .trim()
    .min(1, 'Address line 1 cannot be empty'),
  addressLine2: z.string().trim().optional(),
  city: z
    .string({ message: 'City is required' })
    .trim()
    .min(1, 'City cannot be empty'),
  state: z
    .string({ message: 'State/Province is required' })
    .trim()
    .min(1, 'State cannot be empty'),
  postalCode: z
    .string({ message: 'Postal code is required' })
    .trim()
    .min(1, 'Postal code cannot be empty'),
  country: z.string().trim().min(1, 'Country cannot be empty').default('US'),
  phone: z.string().trim().optional(),
  isDefault: z.boolean().default(false),
});

export const updateAddressSchema = addressSchema.partial();

export const updateUserRoleSchema = z.object({
  role: z.enum(['customer', 'seller', 'admin'], {
    message: 'Role must be customer, seller, or admin',
  }),
});

export const userQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  sort: z.string().optional(),
  fields: z.string().optional(),
  search: z.string().optional(),
  role: z.enum(['customer', 'seller', 'admin']).optional(),
  isActive: z.coerce.boolean().optional(),
});

export type UpdateMeInput = z.infer<typeof updateMeSchema>;
export type AddressInput = z.infer<typeof addressSchema>;
export type UpdateAddressInput = z.infer<typeof updateAddressSchema>;
export type UpdateUserRoleInput = z.infer<typeof updateUserRoleSchema>;
export type UserQueryInput = z.infer<typeof userQuerySchema>;
