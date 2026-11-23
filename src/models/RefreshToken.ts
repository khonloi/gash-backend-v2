import mongoose, { Schema, Model } from 'mongoose';
import { IRefreshToken } from '../types/index.js';

const refreshTokenSchema = new Schema<IRefreshToken>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    tokenHash: {
      type: String,
      required: true,
      unique: true,
    },
    familyId: {
      type: String,
      required: true,
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    revokedAt: {
      type: Date,
      default: null,
    },
    revokedReason: {
      type: String,
      enum: ['rotated', 'logout', 'evicted', 'security'],
      default: null,
    },
    replacedByTokenHash: {
      type: String,
      default: null,
    },
    graceConsumed: {
      type: Boolean,
      default: false,
    },
  },
  {
    versionKey: false,
  }
);

refreshTokenSchema.index({ user: 1, revokedAt: 1, expiresAt: 1 });
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RefreshToken: Model<IRefreshToken> = mongoose.model<IRefreshToken>(
  'RefreshToken',
  refreshTokenSchema
);
