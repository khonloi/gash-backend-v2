import { IUser } from '../types/index.js';
import { SAFE_USER_FIELDS } from '../config/constants.js';

export type ISafeUser = Pick<
  IUser,
  | '_id'
  | 'firstName'
  | 'lastName'
  | 'email'
  | 'role'
  | 'avatar'
  | 'phone'
  | 'isActive'
  | 'isEmailVerified'
  | 'addresses'
  | 'createdAt'
  | 'updatedAt'
>;

/**
 * Sanitizes a User document or object by selecting only whitelisted safe fields.
 * Uses a strict whitelist approach so sensitive fields never leak by default.
 */
export const toSafeUser = (
  user: IUser | Record<string, unknown>
): ISafeUser => {
  const obj =
    typeof (user as IUser).toObject === 'function'
      ? (user as IUser).toObject()
      : (user as Record<string, unknown>);

  const safeUser: Partial<ISafeUser> = {};

  for (const field of SAFE_USER_FIELDS) {
    if (field in obj) {
      (safeUser as Record<string, unknown>)[field] = obj[field];
    }
  }

  if (!safeUser.addresses) {
    safeUser.addresses = [];
  }

  return safeUser as ISafeUser;
};
