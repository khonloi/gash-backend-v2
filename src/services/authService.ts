import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { User } from '../models/User.js';
import { RefreshToken } from '../models/RefreshToken.js';
import { IUser } from '../types/index.js';
import { AppError } from '../utils/AppError.js';
import { createTokenHash } from '../utils/crypto.js';
import {
  signAccessToken,
  signRefreshToken,
  verifyToken,
} from '../utils/jwt.js';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';
import {
  RegisterInput,
  LoginInput,
  ResetPasswordInput,
} from '../validations/authValidation.js';
import {
  REFRESH_TOKEN_EXPIRES_MS,
  REFRESH_TOKEN_GRACE_PERIOD_MS,
  MAX_ACTIVE_REFRESH_TOKENS,
  parseDurationToMs,
} from '../config/constants.js';
import { toSafeUser, type ISafeUser } from '../utils/sanitize.js';

export { toSafeUser };
export type { ISafeUser };

export interface AuthTokens {
  accessToken: string;
}

export interface AuthResponse {
  user: ISafeUser;
  tokens: AuthTokens;
}

export interface AuthSessionResult {
  response: AuthResponse;
  refreshToken: string;
}

export interface RefreshResult {
  tokens: AuthTokens;
  refreshToken: string;
}

// Constant valid bcrypt hash used for timing-equalization when login email is unknown
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(
  'timing-equalization-dummy-secret',
  env.BCRYPT_COST
);

function getRefreshTokenExpiryDate(): Date {
  const ttlMs = parseDurationToMs(
    env.JWT_REFRESH_EXPIRES_IN,
    REFRESH_TOKEN_EXPIRES_MS
  );
  return new Date(Date.now() + ttlMs);
}

/**
 * Enforces concurrent session limit by evicting the oldest active refresh tokens.
 */
async function enforceSessionLimit(userId: string): Promise<void> {
  const now = new Date();
  const activeTokens = await RefreshToken.find({
    user: userId,
    revokedAt: null,
    expiresAt: { $gt: now },
  })
    .sort({ createdAt: 1 })
    .select('_id')
    .lean();

  if (activeTokens.length >= MAX_ACTIVE_REFRESH_TOKENS) {
    const excessCount = activeTokens.length - MAX_ACTIVE_REFRESH_TOKENS + 1;
    const idsToEvict = activeTokens.slice(0, excessCount).map((t) => t._id);
    await RefreshToken.updateMany(
      { _id: { $in: idsToEvict } },
      { $set: { revokedAt: now, revokedReason: 'evicted' } }
    );
  }
}

/**
 * Persists a new RefreshToken record and returns signed JWTs.
 */
async function mintSessionTokens(
  user: IUser,
  familyId = crypto.randomUUID()
): Promise<{ accessToken: string; refreshToken: string; tokenHash: string }> {
  const userId = user._id.toString();
  const tokenVersion = user.tokenVersion ?? 0;
  const accessToken = signAccessToken(userId, user.role, tokenVersion);
  const refreshToken = signRefreshToken(userId, tokenVersion);
  const tokenHash = createTokenHash(refreshToken);

  await RefreshToken.create({
    user: user._id,
    tokenHash,
    familyId,
    expiresAt: getRefreshTokenExpiryDate(),
  });

  return { accessToken, refreshToken, tokenHash };
}

/**
 * Issues fresh JWT access & refresh tokens, persists session in RefreshToken collection,
 * and returns the safe API response paired with the raw refresh token for HttpOnly cookie delivery.
 */
export async function issueTokensAndSave(
  user: IUser,
  resetExisting = false
): Promise<AuthSessionResult> {
  if (user.isNew || user.isModified()) {
    await user.save();
  }

  const userId = user._id.toString();
  if (resetExisting) {
    await RefreshToken.deleteMany({ user: user._id });
  } else {
    await enforceSessionLimit(userId);
  }

  const { accessToken, refreshToken } = await mintSessionTokens(user);

  return {
    response: {
      user: toSafeUser(user),
      tokens: { accessToken },
    },
    refreshToken,
  };
}

export class AuthService {
  /**
   * Register a new user account
   */
  async register(data: RegisterInput): Promise<AuthSessionResult> {
    const existingUser = await User.findOne({ email: data.email })
      .select('_id')
      .lean();
    if (existingUser) {
      throw new AppError('An account with this email already exists', 400);
    }

    const user = new User({
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email,
      password: data.password,
    });

    const verificationToken = user.createEmailVerificationToken();

    if (env.NODE_ENV !== 'production') {
      logger.info(
        `[DEV ONLY] Email verification token for ${user.email}: ${verificationToken}`
      );
    }

    return issueTokensAndSave(user, true);
  }

  /**
   * Log in an existing user (with constant-time bcrypt guard against user enumeration)
   */
  async login(data: LoginInput): Promise<AuthSessionResult> {
    const user = await User.findOne({ email: data.email }).select(
      '+password +tokenVersion'
    );

    if (!user) {
      await bcrypt.compare(data.password, DUMMY_PASSWORD_HASH);
      throw new AppError('Incorrect email or password', 401);
    }

    const passwordValid = await user.comparePassword(data.password);
    if (!passwordValid) {
      throw new AppError('Incorrect email or password', 401);
    }

    if (!user.isActive) {
      throw new AppError(
        'This account has been deactivated. Please contact support.',
        401
      );
    }

    return issueTokensAndSave(user, false);
  }

  /**
   * Atomically rotate refresh token with single-use concurrency grace window and reuse detection
   */
  async refreshAccessToken(refreshToken: string): Promise<RefreshResult> {
    const decoded = verifyToken(refreshToken, 'refresh');

    if (decoded.type !== 'refresh') {
      throw new AppError('Invalid token type', 401);
    }

    const user = await User.findById(decoded.id).select('+tokenVersion');
    if (!user) {
      throw new AppError(
        'The user belonging to this token no longer exists.',
        401
      );
    }

    if (!user.isActive) {
      throw new AppError(
        'This account has been deactivated. Please contact support.',
        401
      );
    }

    if (
      decoded.tokenVersion !== undefined &&
      decoded.tokenVersion !== (user.tokenVersion ?? 0)
    ) {
      throw new AppError(
        'Your session has been invalidated. Please log in again.',
        401
      );
    }

    const now = new Date();
    const tokenHash = createTokenHash(refreshToken);
    const userId = user._id.toString();
    const newAccessToken = signAccessToken(
      userId,
      user.role,
      user.tokenVersion ?? 0
    );
    const newRefreshToken = signRefreshToken(userId, user.tokenVersion ?? 0);
    const newTokenHash = createTokenHash(newRefreshToken);

    // 1) Atomic claim of an active, unrevoked refresh token
    const claimed = await RefreshToken.findOneAndUpdate(
      {
        user: user._id,
        tokenHash,
        revokedAt: null,
        expiresAt: { $gt: now },
      },
      {
        $set: {
          revokedAt: now,
          revokedReason: 'rotated',
          replacedByTokenHash: newTokenHash,
        },
      },
      { returnDocument: 'before' }
    );

    if (claimed) {
      await enforceSessionLimit(userId);
      await RefreshToken.create({
        user: user._id,
        tokenHash: newTokenHash,
        familyId: claimed.familyId,
        expiresAt: getRefreshTokenExpiryDate(),
      });

      return {
        tokens: { accessToken: newAccessToken },
        refreshToken: newRefreshToken,
      };
    }

    // 2) Inspect why the atomic claim missed
    const existing = await RefreshToken.findOne({ user: user._id, tokenHash });

    if (existing) {
      if (existing.revokedReason === 'rotated' && existing.revokedAt) {
        const graceCutoff = new Date(
          Date.now() - REFRESH_TOKEN_GRACE_PERIOD_MS
        );
        // Allow at most one concurrent grace-window retry per rotated token
        const graceClaimed = await RefreshToken.findOneAndUpdate(
          {
            _id: existing._id,
            graceConsumed: false,
            revokedAt: { $gte: graceCutoff },
            expiresAt: { $gt: now },
          },
          { $set: { graceConsumed: true } },
          { returnDocument: 'after' }
        );

        if (graceClaimed) {
          await enforceSessionLimit(userId);
          await RefreshToken.create({
            user: user._id,
            tokenHash: newTokenHash,
            familyId: existing.familyId,
            expiresAt: getRefreshTokenExpiryDate(),
          });

          return {
            tokens: { accessToken: newAccessToken },
            refreshToken: newRefreshToken,
          };
        }
      } else if (
        existing.revokedReason === 'evicted' ||
        existing.revokedReason === 'logout'
      ) {
        throw new AppError(
          'Refresh token has been revoked. Please log in again.',
          401
        );
      } else if (existing.expiresAt <= now) {
        throw new AppError(
          'Refresh token has expired. Please log in again.',
          401
        );
      }
    }

    // 3) Reuse or unknown token detected: terminate all sessions and bump tokenVersion
    await Promise.all([
      RefreshToken.deleteMany({ user: user._id }),
      User.findByIdAndUpdate(user._id, { $inc: { tokenVersion: 1 } }),
    ]);

    throw new AppError(
      'Invalid or reused refresh token. All sessions terminated.',
      401
    );
  }

  /**
   * Log out current session by revoking specific refresh token
   */
  async logout(userId?: string, refreshToken?: string): Promise<void> {
    if (!refreshToken) return;
    const tokenHash = createTokenHash(refreshToken);
    const filter: Record<string, unknown> = { tokenHash };
    if (userId) {
      filter.user = userId;
    }
    await RefreshToken.deleteOne(filter);
  }

  /**
   * Log out all sessions across all devices and invalidate active access tokens
   */
  async logoutAll(userId: string): Promise<void> {
    await Promise.all([
      RefreshToken.deleteMany({ user: userId }),
      User.findByIdAndUpdate(userId, { $inc: { tokenVersion: 1 } }),
    ]);
  }

  /**
   * Generate password reset token
   */
  async forgotPassword(email: string): Promise<void> {
    const user = await User.findOne({ email });
    if (!user || !user.isActive) {
      // Prevent user enumeration: always succeed silently
      return;
    }

    const resetToken = user.createPasswordResetToken();
    await user.save();

    if (env.NODE_ENV !== 'production') {
      logger.info(
        `[DEV ONLY] Password reset token for ${user.email}: ${resetToken}`
      );
    }
  }

  /**
   * Reset password using token in request body
   */
  async resetPassword(data: ResetPasswordInput): Promise<AuthSessionResult> {
    const hashedToken = createTokenHash(data.token);

    const user = await User.findOne({
      passwordResetToken: hashedToken,
      passwordResetExpires: { $gt: new Date() },
    }).select('+tokenVersion');

    if (!user) {
      throw new AppError('Token is invalid or has expired', 400);
    }

    if (!user.isActive) {
      throw new AppError(
        'This account has been deactivated. Please contact support.',
        401
      );
    }

    user.password = data.password;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    user.tokenVersion = (user.tokenVersion ?? 0) + 1;

    // Persist password & tokenVersion BEFORE issuing new JWTs so iat >= passwordChangedAt
    await user.save();

    return issueTokensAndSave(user, true);
  }

  /**
   * Verify user email via token
   */
  async verifyEmail(token: string): Promise<void> {
    const hashedToken = createTokenHash(token);

    const user = await User.findOne({
      emailVerificationToken: hashedToken,
      emailVerificationExpires: { $gt: new Date() },
    });

    if (!user) {
      throw new AppError('Verification token is invalid or has expired', 400);
    }

    if (!user.isActive) {
      throw new AppError(
        'This account has been deactivated. Please contact support.',
        401
      );
    }

    user.isEmailVerified = true;
    user.emailVerificationToken = undefined;
    user.emailVerificationExpires = undefined;

    await user.save();
  }
}

export const authService = new AuthService();
