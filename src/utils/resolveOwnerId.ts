import mongoose from 'mongoose';

type IdLike =
  | mongoose.Types.ObjectId
  | { _id?: mongoose.Types.ObjectId | string }
  | string
  | undefined
  | null;

/**
 * Resolves the string ID of a referenced document from an ObjectId, populated doc, or string.
 */
export const resolveOwnerId = (user: IdLike): string | undefined => {
  if (!user) return undefined;
  if (typeof user === 'string') return user;
  if (user instanceof mongoose.Types.ObjectId) return user.toString();
  if (typeof user === 'object' && '_id' in user && user._id) {
    return user._id.toString();
  }
  return undefined;
};
