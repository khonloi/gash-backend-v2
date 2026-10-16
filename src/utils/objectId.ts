import mongoose from 'mongoose';
import { AppError } from './AppError.js';

/**
 * Asserts that the provided value is a valid MongoDB ObjectId string.
 * Throws an operational 400 AppError if invalid.
 *
 * @param id - The ID string to test
 * @param entityName - Descriptive name for error message (e.g. 'product ID', 'user ID', 'item ID')
 */
export function assertObjectId(
  id: unknown,
  entityName = 'ID'
): asserts id is string {
  if (typeof id !== 'string' || !mongoose.Types.ObjectId.isValid(id)) {
    throw new AppError(`Invalid ${entityName} format: "${String(id)}"`, 400);
  }
}

/**
 * Checks whether the given value is a valid MongoDB ObjectId.
 */
export function isValidObjectId(
  id: unknown
): id is string | mongoose.Types.ObjectId {
  if (!id) return false;
  if (id instanceof mongoose.Types.ObjectId) return true;
  if (typeof id === 'string') return mongoose.Types.ObjectId.isValid(id);
  return false;
}
