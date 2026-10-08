import { User } from '../models/User.js';
import { IUser } from '../types/index.js';
import { AppError } from '../utils/AppError.js';
import { createTokenHash } from '../utils/crypto.js';
import {
  signAccessToken,
  signRefreshToken,
  verifyToken,
} from '../utils/jwt.js';
import { logger } from '../config/logger.js';
import {
  RegisterInput,
  LoginInput,
  ResetPasswordInput,
} from '../validations/authValidation.js';

import {
  REFRESH_TOKEN_EXPIRES_MS,
  MAX_ACTIVE_REFRESH_TOKENS,
} from '../config/constants.js';
import { toSafeUser, type ISafeUser } from '../utils/sanitize.js';

export { toSafeUser };
export type { ISafeUser };

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResponse {
  user: ISafeUser;
  tokens: AuthTokens;
}

/**
 * Issues fresh JWT access & refresh tokens, saves them on the user, and returns AuthResponse.
 */
export async function issueTokensAndSave(
  user: IUser,
  resetExisting = false
): Promise<AuthResponse> {
  const accessToken = signAccessToken(user._id.toString(), user.role);
  const refreshToken = signRefreshToken(user._id.toString());
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRES_MS);

  const newToken = {
    token: createTokenHash(refreshToken),
    expiresAt,
    createdAt: new Date(),
  };

  if (resetExisting) {
    user.refreshTokens = [newToken];
  } else {
    const activeTokens = (user.refreshTokens || []).filter(
      (rt) => rt.expiresAt > new Date()
    );
    activeTokens.push(newToken);
    if (activeTokens.length > MAX_ACTIVE_REFRESH_TOKENS) {
      activeTokens.shift();
    }
    user.refreshTokens = activeTokens;
  }

  await user.save();

  return {
    user: toSafeUser(user),
    tokens: { accessToken, refreshToken },
  };
}

export class AuthService {
  /**
   * Register a new user account
   */
  async register(data: RegisterInput): Promise<AuthResponse> {
    const existingUser = await User.findOne({ email: data.email });
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

    logger.info(
      `[DEV ONLY] Email verification token for ${user.email}: ${verificationToken}`
    );

    return issueTokensAndSave(user, true);
  }

  /**
   * Log in an existing user
   */
  async login(data: LoginInput): Promise<AuthResponse> {
    const user = await User.findOne({ email: data.email }).select(
      '+password +refreshTokens'
    );

    if (!user || !(await user.comparePassword(data.password))) {
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
   * Rotate refresh token and issue new token pair
   */
  async refreshAccessToken(refreshToken: string): Promise<AuthTokens> {
    const decoded = verifyToken(refreshToken);

    if (decoded.type !== 'refresh') {
      throw new AppError('Invalid token type', 401);
    }

    const user = await User.findById(decoded.id).select('+refreshTokens');
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

    // Check if token exists in user's active list
    const hashedIncomingToken = createTokenHash(refreshToken);
    const tokenIndex = user.refreshTokens.findIndex(
      (rt) => rt.token === hashedIncomingToken
    );

    if (tokenIndex === -1) {
      // Reuse detection: clear all sessions if unknown or reused token is provided
      user.refreshTokens = [];
      await user.save();
      throw new AppError(
        'Invalid or reused refresh token. All sessions terminated.',
        401
      );
    }

    // Remove the used refresh token (rotation)
    user.refreshTokens.splice(tokenIndex, 1);

    // Filter out any expired tokens
    user.refreshTokens = user.refreshTokens.filter(
      (rt) => rt.expiresAt > new Date()
    );

    // Issue new pair
    const newAccessToken = signAccessToken(user._id.toString(), user.role);
    const newRefreshToken = signRefreshToken(user._id.toString());

    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRES_MS);
    user.refreshTokens.push({
      token: createTokenHash(newRefreshToken),
      expiresAt,
      createdAt: new Date(),
    });

    await user.save();

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    };
  }

  /**
   * Log out current session by removing specific refresh token
   */
  async logout(userId: string, refreshToken?: string): Promise<void> {
    if (refreshToken) {
      const hashedToken = createTokenHash(refreshToken);
      await User.findByIdAndUpdate(userId, {
        $pull: { refreshTokens: { token: hashedToken } },
      });
    }
  }

  /**
   * Log out all sessions across all devices
   */
  async logoutAll(userId: string): Promise<void> {
    await User.findByIdAndUpdate(userId, {
      $set: { refreshTokens: [] },
    });
  }

  /**
   * Generate password reset token
   */
  async forgotPassword(email: string): Promise<void> {
    const user = await User.findOne({ email });
    if (!user) {
      // Prevent user enumeration: always succeed
      return;
    }

    const resetToken = user.createPasswordResetToken();
    await user.save();

    logger.info(
      `[DEV ONLY] Password reset token for ${user.email}: ${resetToken}`
    );
  }

  /**
   * Reset password using token
   */
  async resetPassword(
    token: string,
    data: ResetPasswordInput
  ): Promise<AuthResponse> {
    const hashedToken = createTokenHash(token);

    const user = await User.findOne({
      passwordResetToken: hashedToken,
      passwordResetExpires: { $gt: new Date() },
    }).select('+refreshTokens');

    if (!user) {
      throw new AppError('Token is invalid or has expired', 400);
    }

    user.password = data.password;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;

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

    user.isEmailVerified = true;
    user.emailVerificationToken = undefined;
    user.emailVerificationExpires = undefined;

    await user.save();
  }
}

export const authService = new AuthService();
