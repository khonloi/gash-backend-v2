import mongoose from 'mongoose';
import { User } from '../models/User.js';
import {
  IAddress,
  IUser,
  PaginatedResult,
  QueryString,
  UserRole,
} from '../types/index.js';
import { AppError } from '../utils/AppError.js';
import { APIFeatures } from '../utils/apiFeatures.js';
import { signAccessToken, signRefreshToken } from '../utils/jwt.js';
import {
  UpdateMeInput,
  AddressInput,
  UpdateAddressInput,
} from '../validations/userValidation.js';
import { ChangePasswordInput } from '../validations/authValidation.js';
import { AuthResponse, toSafeUser } from './authService.js';

export class UserService {
  /**
   * Get current user profile
   */
  async getMe(userId: string): Promise<IUser> {
    const user = await User.findById(userId);
    if (!user) {
      throw new AppError('User not found', 404);
    }
    return user;
  }

  /**
   * Update current user profile fields (excludes password and role)
   */
  async updateMe(userId: string, data: UpdateMeInput): Promise<IUser> {
    const filteredData: Record<string, any> = {};
    if (data.firstName !== undefined) filteredData.firstName = data.firstName;
    if (data.lastName !== undefined) filteredData.lastName = data.lastName;
    if (data.phone !== undefined) filteredData.phone = data.phone;
    if (data.avatar !== undefined) filteredData.avatar = data.avatar;

    const user = await User.findByIdAndUpdate(userId, filteredData, {
      returnDocument: 'after',
      runValidators: true,
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    return user;
  }

  /**
   * Change current user's password and reset sessions
   */
  async changePassword(
    userId: string,
    data: ChangePasswordInput
  ): Promise<AuthResponse> {
    const user = await User.findById(userId).select('+password +refreshTokens');
    if (!user) {
      throw new AppError('User not found', 404);
    }

    if (!(await user.comparePassword(data.currentPassword))) {
      throw new AppError('Current password is incorrect', 401);
    }

    user.password = data.newPassword;
    user.refreshTokens = []; // Log out other sessions

    const accessToken = signAccessToken(user._id.toString(), user.role);
    const refreshToken = signRefreshToken(user._id.toString());

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    user.refreshTokens.push({
      token: refreshToken,
      expiresAt,
      createdAt: new Date(),
    });

    await user.save();

    return {
      user: toSafeUser(user),
      tokens: { accessToken, refreshToken },
    };
  }

  /**
   * Soft delete user account (set isActive: false and invalidate sessions)
   */
  async deactivateMe(userId: string): Promise<void> {
    const user = await User.findByIdAndUpdate(userId, {
      isActive: false,
      refreshTokens: [],
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }
  }

  /**
   * Get all addresses for a user
   */
  async getAddresses(userId: string): Promise<IAddress[]> {
    const user = await User.findById(userId);
    if (!user) {
      throw new AppError('User not found', 404);
    }
    return user.addresses;
  }

  /**
   * Add a new address
   */
  async addAddress(
    userId: string,
    addressData: AddressInput
  ): Promise<IAddress[]> {
    const user = await User.findById(userId);
    if (!user) {
      throw new AppError('User not found', 404);
    }

    // If marked as default or it's the first address, unset others
    if (addressData.isDefault || user.addresses.length === 0) {
      user.addresses.forEach((addr) => {
        addr.isDefault = false;
      });
      addressData.isDefault = true;
    }

    user.addresses.push(addressData as IAddress);
    await user.save();

    return user.addresses;
  }

  /**
   * Update an existing address
   */
  async updateAddress(
    userId: string,
    addressId: string,
    data: UpdateAddressInput
  ): Promise<IAddress[]> {
    const user = await User.findById(userId);
    if (!user) {
      throw new AppError('User not found', 404);
    }

    const address = user.addresses.find(
      (addr) => addr._id?.toString() === addressId
    );

    if (!address) {
      throw new AppError(`No address found with ID "${addressId}"`, 404);
    }

    if (data.isDefault) {
      user.addresses.forEach((addr) => {
        addr.isDefault = false;
      });
    }

    Object.assign(address, data);
    await user.save();

    return user.addresses;
  }

  /**
   * Remove an address
   */
  async removeAddress(userId: string, addressId: string): Promise<IAddress[]> {
    const user = await User.findById(userId);
    if (!user) {
      throw new AppError('User not found', 404);
    }

    const addressIndex = user.addresses.findIndex(
      (addr) => addr._id?.toString() === addressId
    );

    if (addressIndex === -1) {
      throw new AppError(`No address found with ID "${addressId}"`, 404);
    }

    const wasDefault = user.addresses[addressIndex].isDefault;
    user.addresses.splice(addressIndex, 1);

    // If we removed the default address, make the first remaining address the default
    if (wasDefault && user.addresses.length > 0) {
      user.addresses[0].isDefault = true;
    }

    await user.save();
    return user.addresses;
  }

  // ================= ADMIN FUNCTIONS =================

  /**
   * Admin: Get all users with search, filtering, and pagination
   */
  async getAllUsers(queryString: QueryString): Promise<PaginatedResult<IUser>> {
    const countFeatures = new APIFeatures(User.find(), queryString)
      .filter()
      .search();
    const totalResults = await countFeatures.mongooseQuery.countDocuments();

    const features = new APIFeatures(User.find(), queryString)
      .filter()
      .search()
      .sort()
      .limitFields()
      .paginate(totalResults);

    const data = await features.mongooseQuery;

    return {
      data,
      ...features.pagination,
    };
  }

  /**
   * Admin: Get a user by ID
   */
  async getUserById(id: string): Promise<IUser> {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError(`Invalid user ID format: "${id}"`, 400);
    }

    const user = await User.findById(id);
    if (!user) {
      throw new AppError(`No user found with ID "${id}"`, 404);
    }

    return user;
  }

  /**
   * Admin: Update user role
   */
  async updateUserRole(id: string, role: UserRole): Promise<IUser> {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError(`Invalid user ID format: "${id}"`, 400);
    }

    const user = await User.findByIdAndUpdate(
      id,
      { role },
      { returnDocument: 'after', runValidators: true }
    );

    if (!user) {
      throw new AppError(`No user found with ID "${id}"`, 404);
    }

    return user;
  }

  /**
   * Admin: Permanently delete a user
   */
  async deleteUser(id: string): Promise<void> {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError(`Invalid user ID format: "${id}"`, 400);
    }

    const user = await User.findByIdAndDelete(id);
    if (!user) {
      throw new AppError(`No user found with ID "${id}"`, 404);
    }
  }
}

export const userService = new UserService();
