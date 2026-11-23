import { User } from '../models/User.js';
import { Cart } from '../models/Cart.js';
import { RefreshToken } from '../models/RefreshToken.js';
import {
  IAddress,
  IUser,
  PaginatedResult,
  QueryString,
  UserRole,
} from '../types/index.js';
import { AppError } from '../utils/AppError.js';
import { paginateQuery } from '../utils/apiFeatures.js';
import { MAX_USER_ADDRESSES, SAFE_USER_FIELDS } from '../config/constants.js';
import {
  UpdateMeInput,
  AddressInput,
  UpdateAddressInput,
} from '../validations/userValidation.js';
import { ChangePasswordInput } from '../validations/authValidation.js';
import {
  AuthSessionResult,
  issueTokensAndSave,
  toSafeUser,
  type ISafeUser,
} from './authService.js';
import { assertObjectId } from '../utils/objectId.js';

export class UserService {
  /**
   * Get current user profile
   */
  async getMe(userId: string): Promise<ISafeUser> {
    const user = await User.findById(userId);
    if (!user) {
      throw new AppError('User not found', 404);
    }
    return toSafeUser(user);
  }

  /**
   * Update current user profile fields (excludes password and role)
   */
  async updateMe(userId: string, data: UpdateMeInput): Promise<ISafeUser> {
    const filteredData: Partial<
      Pick<IUser, 'firstName' | 'lastName' | 'phone' | 'avatar'>
    > = {};
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

    return toSafeUser(user);
  }

  /**
   * Change current user's password and reset sessions
   */
  async changePassword(
    userId: string,
    data: ChangePasswordInput
  ): Promise<AuthSessionResult> {
    const user = await User.findById(userId).select('+password +tokenVersion');
    if (!user) {
      throw new AppError('User not found', 404);
    }

    if (!(await user.comparePassword(data.currentPassword))) {
      throw new AppError('Current password is incorrect', 401);
    }

    user.password = data.newPassword;
    user.tokenVersion = (user.tokenVersion ?? 0) + 1;

    // Persist password & tokenVersion BEFORE issuing new JWTs
    await user.save();

    return issueTokensAndSave(user, true);
  }

  /**
   * Soft delete user account (set isActive: false and invalidate all sessions)
   */
  async deactivateMe(userId: string): Promise<void> {
    const user = await User.findByIdAndUpdate(userId, {
      isActive: false,
      $inc: { tokenVersion: 1 },
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    await RefreshToken.deleteMany({ user: userId });
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

    if (user.addresses.length >= MAX_USER_ADDRESSES) {
      throw new AppError(
        `You cannot store more than ${MAX_USER_ADDRESSES} addresses`,
        400
      );
    }

    const newAddress: IAddress = { ...addressData };

    // If marked as default or it's the first address, unset others
    if (newAddress.isDefault || user.addresses.length === 0) {
      user.addresses.forEach((addr) => {
        addr.isDefault = false;
      });
      newAddress.isDefault = true;
    }

    user.addresses.push(newAddress);
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
    assertObjectId(addressId, 'address ID');

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
    } else if (
      data.isDefault === false &&
      address.isDefault &&
      user.addresses.length > 1
    ) {
      const fallback = user.addresses.find(
        (addr) => addr._id?.toString() !== addressId
      );
      if (fallback) {
        fallback.isDefault = true;
      }
    }

    Object.assign(address, data);
    await user.save();

    return user.addresses;
  }

  /**
   * Remove an address
   */
  async removeAddress(userId: string, addressId: string): Promise<IAddress[]> {
    assertObjectId(addressId, 'address ID');

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
    const normalizedQuery: QueryString = {
      ...queryString,
      ...(queryString.search && !queryString.keyword
        ? { keyword: String(queryString.search) }
        : {}),
    };

    return paginateQuery(() => User.find(), normalizedQuery, {
      search: true,
      allowedFilterFields: ['role', 'isActive', 'isEmailVerified'],
      allowedSortFields: [
        'createdAt',
        'updatedAt',
        'firstName',
        'lastName',
        'email',
        'role',
      ],
      allowedSelectFields: SAFE_USER_FIELDS,
    });
  }

  /**
   * Admin: Get a user by ID
   */
  async getUserById(id: string): Promise<ISafeUser> {
    assertObjectId(id, 'user ID');

    const user = await User.findById(id);
    if (!user) {
      throw new AppError(`No user found with ID "${id}"`, 404);
    }

    return toSafeUser(user);
  }

  /**
   * Admin: Update user role (prevents self-demotion and revokes sessions on role change)
   */
  async updateUserRole(
    id: string,
    role: UserRole,
    actorId?: string
  ): Promise<ISafeUser> {
    assertObjectId(id, 'user ID');

    if (actorId && actorId === id && role !== 'admin') {
      throw new AppError('Administrators cannot demote their own role', 400);
    }

    const existing = await User.findById(id);
    if (!existing) {
      throw new AppError(`No user found with ID "${id}"`, 404);
    }

    if (existing.role === 'admin' && role !== 'admin') {
      const otherAdmins = await User.countDocuments({
        _id: { $ne: id },
        role: 'admin',
        isActive: true,
      });
      if (otherAdmins === 0) {
        throw new AppError('Cannot demote the last active administrator', 400);
      }
    }

    const roleChanged = existing.role !== role;
    existing.role = role;
    if (roleChanged) {
      existing.tokenVersion = (existing.tokenVersion ?? 0) + 1;
    }
    await existing.save();

    if (roleChanged) {
      await RefreshToken.deleteMany({ user: id });
    }

    return toSafeUser(existing);
  }

  /**
   * Admin: Permanently delete a user
   */
  async deleteUser(id: string, adminId?: string): Promise<void> {
    assertObjectId(id, 'user ID');

    if (adminId && adminId === id) {
      throw new AppError('Administrators cannot delete their own account', 400);
    }

    const user = await User.findByIdAndDelete(id);
    if (!user) {
      throw new AppError(`No user found with ID "${id}"`, 404);
    }

    // Cascade: Clean up associated user cart & refresh tokens
    await Promise.all([
      Cart.findOneAndDelete({ user: id }),
      RefreshToken.deleteMany({ user: id }),
    ]);
  }
}

export const userService = new UserService();
