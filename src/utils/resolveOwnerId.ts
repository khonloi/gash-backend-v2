import mongoose from 'mongoose';
import { IUser } from '../types/index.js';

/**
 * Resolves the string ID of an owner from an ObjectId, populated IUser, or string.
 */
export const resolveOwnerId = (
  user: mongoose.Types.ObjectId | IUser | string | undefined | null
): string | undefined => {
  if (!user) return undefined;
  if (typeof user === 'string') return user;
  if (user instanceof mongoose.Types.ObjectId) return user.toString();
  if (typeof user === 'object' && '_id' in user && user._id) {
    return user._id.toString();
  }
  return String(user);
};
