import { z } from 'zod';

const passwordRegex =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;

const passwordValidation = z
  .string({ message: 'Password is required' })
  .min(8, 'Password must be at least 8 characters')
  .regex(
    passwordRegex,
    'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character (@$!%*?&)'
  );

export const registerSchema = z
  .object({
    firstName: z
      .string({ message: 'First name is required' })
      .trim()
      .min(1, 'First name cannot be empty')
      .max(50, 'First name cannot exceed 50 characters'),
    lastName: z
      .string({ message: 'Last name is required' })
      .trim()
      .min(1, 'Last name cannot be empty')
      .max(50, 'Last name cannot exceed 50 characters'),
    email: z
      .string({ message: 'Email is required' })
      .trim()
      .email('Please provide a valid email address')
      .toLowerCase(),
    password: passwordValidation,
    passwordConfirm: z.string({ message: 'Please confirm your password' }),
  })
  .refine((data) => data.password === data.passwordConfirm, {
    message: 'Passwords do not match',
    path: ['passwordConfirm'],
  });

export const loginSchema = z.object({
  email: z
    .string({ message: 'Email is required' })
    .trim()
    .email('Please provide a valid email address')
    .toLowerCase(),
  password: z
    .string({ message: 'Password is required' })
    .min(1, 'Password cannot be empty'),
});

export const refreshTokenSchema = z.object({
  refreshToken: z
    .string({ message: 'Refresh token is required' })
    .min(1, 'Refresh token cannot be empty'),
});

export const forgotPasswordSchema = z.object({
  email: z
    .string({ message: 'Email is required' })
    .trim()
    .email('Please provide a valid email address')
    .toLowerCase(),
});

export const resetPasswordSchema = z
  .object({
    password: passwordValidation,
    passwordConfirm: z.string({ message: 'Please confirm your password' }),
  })
  .refine((data) => data.password === data.passwordConfirm, {
    message: 'Passwords do not match',
    path: ['passwordConfirm'],
  });

export const changePasswordSchema = z
  .object({
    currentPassword: z
      .string({ message: 'Current password is required' })
      .min(1, 'Current password cannot be empty'),
    newPassword: passwordValidation,
    newPasswordConfirm: z.string({
      message: 'Please confirm your new password',
    }),
  })
  .refine((data) => data.newPassword === data.newPasswordConfirm, {
    message: 'New passwords do not match',
    path: ['newPasswordConfirm'],
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: 'New password must be different from current password',
    path: ['newPassword'],
  });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
