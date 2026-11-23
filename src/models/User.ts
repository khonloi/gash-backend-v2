import mongoose, { Schema, Model } from 'mongoose';
import bcrypt from 'bcryptjs';
import { IUser, IAddress } from '../types/index.js';
import { createTokenHash, generateRandomToken } from '../utils/crypto.js';
import {
  PASSWORD_RESET_EXPIRES_MS,
  EMAIL_VERIFICATION_EXPIRES_MS,
} from '../config/constants.js';
import { env } from '../config/env.js';
import { createAddressSchemaDefinition } from './commonSchema.js';

const addressSchema = new Schema<IAddress>(
  createAddressSchemaDefinition({
    defaultCountry: 'US',
    includeLabel: true,
    includeIsDefault: true,
    requireState: true,
    requirePostalCode: true,
    fullNameRequiredMessage: 'Full name for address is required',
  }),
  { _id: true }
);

const userSchema = new Schema<IUser>(
  {
    firstName: {
      type: String,
      required: [true, 'First name is required'],
      trim: true,
      maxlength: [50, 'First name cannot exceed 50 characters'],
    },
    lastName: {
      type: String,
      required: [true, 'Last name is required'],
      trim: true,
      maxlength: [50, 'Last name cannot exceed 50 characters'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
        'Please provide a valid email address',
      ],
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [8, 'Password must have at least 8 characters'],
      select: false,
    },
    role: {
      type: String,
      enum: ['customer', 'seller', 'admin'],
      default: 'customer',
    },
    avatar: {
      type: String,
      trim: true,
    },
    phone: {
      type: String,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    isEmailVerified: {
      type: Boolean,
      default: false,
    },
    emailVerificationToken: {
      type: String,
      select: false,
    },
    emailVerificationExpires: {
      type: Date,
      select: false,
    },
    passwordResetToken: {
      type: String,
      select: false,
    },
    passwordResetExpires: {
      type: Date,
      select: false,
    },
    passwordChangedAt: {
      type: Date,
      select: false,
    },
    tokenVersion: {
      type: Number,
      default: 0,
      select: false,
    },
    addresses: {
      type: [addressSchema],
      default: [],
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (_doc, ret) => {
        const obj = ret as unknown as Record<string, unknown>;
        delete obj.password;
        delete obj.emailVerificationToken;
        delete obj.emailVerificationExpires;
        delete obj.passwordResetToken;
        delete obj.passwordResetExpires;
        delete obj.passwordChangedAt;
        delete obj.tokenVersion;
        delete obj.__v;
        return ret;
      },
    },
    toObject: { virtuals: true },
  }
);

// Indexes (email unique index is defined on field)
userSchema.index({ role: 1 });
userSchema.index({ isActive: 1, createdAt: -1 });
userSchema.index({ createdAt: -1 });
userSchema.index({ passwordResetToken: 1 }, { sparse: true });
userSchema.index({ emailVerificationToken: 1 }, { sparse: true });
userSchema.index({ firstName: 'text', lastName: 'text', email: 'text' });

// Pre-save hook: Hash password if modified
userSchema.pre('save', async function () {
  if (!this.isModified('password') || !this.password) return;

  this.password = await bcrypt.hash(this.password, env.BCRYPT_COST);

  // Set passwordChangedAt if modifying an existing user's password
  if (!this.isNew) {
    this.passwordChangedAt = new Date(Date.now() - 1000); // 1 second before to prevent JWT issue
  }
});

// Instance Method: Compare candidate password with hashed password
userSchema.methods.comparePassword = async function (
  candidatePassword: string
): Promise<boolean> {
  if (!this.password) return false;
  return bcrypt.compare(candidatePassword, this.password);
};

// Instance Method: Check if password was changed after token issuance
userSchema.methods.changedPasswordAfter = function (
  jwtTimestamp: number
): boolean {
  if (this.passwordChangedAt) {
    const changedTimestamp = Math.floor(
      this.passwordChangedAt.getTime() / 1000
    );
    return jwtTimestamp < changedTimestamp;
  }
  return false;
};

// Instance Method: Generate hashed password reset token and set expiry
userSchema.methods.createPasswordResetToken = function (): string {
  const resetToken = generateRandomToken();
  this.passwordResetToken = createTokenHash(resetToken);
  this.passwordResetExpires = new Date(Date.now() + PASSWORD_RESET_EXPIRES_MS);

  return resetToken;
};

// Instance Method: Generate hashed email verification token and set expiry
userSchema.methods.createEmailVerificationToken = function (): string {
  const verificationToken = generateRandomToken();
  this.emailVerificationToken = createTokenHash(verificationToken);
  this.emailVerificationExpires = new Date(
    Date.now() + EMAIL_VERIFICATION_EXPIRES_MS
  );

  return verificationToken;
};

export const User: Model<IUser> = mongoose.model<IUser>('User', userSchema);
