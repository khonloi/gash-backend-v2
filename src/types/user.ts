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
  user: Types.ObjectId;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
  createdAt: Date;
  revokedAt?: Date | null;
  revokedReason?: 'rotated' | 'logout' | 'evicted' | 'security' | null;
  replacedByTokenHash?: string | null;
  graceConsumed?: boolean;
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
  tokenVersion: number;
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
  jti?: string;
  tokenVersion?: number;
  iat?: number;
  exp?: number;
}
