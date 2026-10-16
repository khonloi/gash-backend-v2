import mongoose from 'mongoose';
import { assertObjectId, isValidObjectId } from '../src/utils/objectId.js';
import { AppError } from '../src/utils/AppError.js';

describe('ObjectId Utility Tests', () => {
  describe('assertObjectId', () => {
    it('should not throw for valid ObjectId string', () => {
      const validId = new mongoose.Types.ObjectId().toString();
      expect(() => assertObjectId(validId, 'product ID')).not.toThrow();
    });

    it('should throw 400 AppError with custom entity name for invalid format', () => {
      expect(() => assertObjectId('invalid-hex-id', 'user ID')).toThrow(
        AppError
      );
      expect(() => assertObjectId('invalid-hex-id', 'user ID')).toThrow(
        'Invalid user ID format: "invalid-hex-id"'
      );
    });

    it('should throw 400 AppError for non-string values', () => {
      expect(() => assertObjectId(12345, 'order ID')).toThrow(
        'Invalid order ID format: "12345"'
      );
      expect(() => assertObjectId(null, 'order ID')).toThrow(
        'Invalid order ID format: "null"'
      );
      expect(() => assertObjectId(undefined)).toThrow(
        'Invalid ID format: "undefined"'
      );
    });
  });

  describe('isValidObjectId', () => {
    it('should return true for valid ObjectId string and instance', () => {
      const idInstance = new mongoose.Types.ObjectId();
      expect(isValidObjectId(idInstance)).toBe(true);
      expect(isValidObjectId(idInstance.toString())).toBe(true);
    });

    it('should return false for invalid strings and primitives', () => {
      expect(isValidObjectId('not-an-id')).toBe(false);
      expect(isValidObjectId('')).toBe(false);
      expect(isValidObjectId(null)).toBe(false);
      expect(isValidObjectId(undefined)).toBe(false);
      expect(isValidObjectId(42)).toBe(false);
      expect(isValidObjectId({})).toBe(false);
    });
  });
});
