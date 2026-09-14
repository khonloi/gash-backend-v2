import { Document, Types } from 'mongoose';

export type UserRole = 'customer' | 'seller' | 'admin';

export interface IAddress {
  _id?: Types.ObjectId | string;
  label: string; // e.g. 'Home', 'Office'
  fullName: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone?: string;
  isDefault: boolean;
}

export interface IRefreshToken {
  token: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface IUser extends Document {
  firstName: string;
  lastName: string;
  email: string;
  password?: string;
  role: UserRole;
  avatar?: string;
  phone?: string;
  isActive: boolean;
  isEmailVerified: boolean;
  emailVerificationToken?: string;
  emailVerificationExpires?: Date;
  passwordResetToken?: string;
  passwordResetExpires?: Date;
  passwordChangedAt?: Date;
  refreshTokens: IRefreshToken[];
  addresses: IAddress[];
  createdAt: Date;
  updatedAt: Date;

  // Instance methods
  comparePassword(candidatePassword: string): Promise<boolean>;
  changedPasswordAfter(jwtTimestamp: number): boolean;
  createPasswordResetToken(): string;
  createEmailVerificationToken(): string;
}

export interface TokenPayload {
  id: string;
  role?: UserRole;
  type?: 'access' | 'refresh';
  iat?: number;
  exp?: number;
}
