import mongoose from 'mongoose';
import { toSafeUser } from '../src/utils/sanitize.js';
import { resolveOwnerId } from '../src/utils/resolveOwnerId.js';
import { sanitizeInPlace } from '../src/middlewares/mongoSanitize.js';
import { IUser } from '../src/types/index.js';

describe('Utility Unit Tests', () => {
  describe('toSafeUser', () => {
    it('should only include whitelisted safe fields and strip sensitive attributes', () => {
      const mockRawUser = {
        _id: new mongoose.Types.ObjectId(),
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
        role: 'customer',
        password: '$2a$12$someHashedPasswordString',
        refreshTokens: [{ token: 'sensitive-token', expiresAt: new Date() }],
        emailVerificationToken: 'sensitive-verify-token',
        emailVerificationExpires: new Date(),
        passwordResetToken: 'sensitive-reset-token',
        passwordResetExpires: new Date(),
        passwordChangedAt: new Date(),
        avatar: 'https://example.com/avatar.jpg',
        phone: '1234567890',
        isActive: true,
        isEmailVerified: true,
        addresses: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        arbitraryUnsafeField: 'should-not-exist',
      } as unknown as IUser;

      const safe = toSafeUser(mockRawUser);

      // Verify safe fields exist
      expect(safe._id).toBe(mockRawUser._id);
      expect(safe.firstName).toBe('Jane');
      expect(safe.lastName).toBe('Doe');
      expect(safe.email).toBe('jane@example.com');
      expect(safe.role).toBe('customer');
      expect(safe.avatar).toBe('https://example.com/avatar.jpg');
      expect(safe.phone).toBe('1234567890');
      expect(safe.isActive).toBe(true);
      expect(safe.isEmailVerified).toBe(true);
      expect(Array.isArray(safe.addresses)).toBe(true);

      // Verify sensitive & arbitrary fields are completely excluded
      expect((safe as Record<string, unknown>).password).toBeUndefined();
      expect((safe as Record<string, unknown>).refreshTokens).toBeUndefined();
      expect(
        (safe as Record<string, unknown>).emailVerificationToken
      ).toBeUndefined();
      expect(
        (safe as Record<string, unknown>).passwordResetToken
      ).toBeUndefined();
      expect(
        (safe as Record<string, unknown>).passwordChangedAt
      ).toBeUndefined();
      expect(
        (safe as Record<string, unknown>).arbitraryUnsafeField
      ).toBeUndefined();
    });
  });

  describe('resolveOwnerId', () => {
    it('should resolve owner ID from string', () => {
      expect(resolveOwnerId('user-123')).toBe('user-123');
    });

    it('should resolve owner ID from ObjectId', () => {
      const id = new mongoose.Types.ObjectId();
      expect(resolveOwnerId(id)).toBe(id.toString());
    });

    it('should resolve owner ID from populated object with _id', () => {
      const id = new mongoose.Types.ObjectId();
      const populated = { _id: id, firstName: 'Alex' } as unknown as IUser;
      expect(resolveOwnerId(populated)).toBe(id.toString());
    });

    it('should return undefined for null or undefined input', () => {
      expect(resolveOwnerId(undefined)).toBeUndefined();
      expect(resolveOwnerId(null)).toBeUndefined();
    });
  });

  describe('sanitizeInPlace', () => {
    it('should recursively remove $ operators and dot keys from objects and arrays in place', () => {
      const payload: Record<string, unknown> = {
        normalKey: 'valid',
        $topLevelBad: 'hacker',
        'key.with.dot': 'bad',
        nested: {
          goodKey: 123,
          $gt: 0,
          'inner.dot': true,
        },
        items: [
          { safe: 'item1' },
          { $where: 'sleep(1000)', fine: 'item2' },
          [{ 'deep.dot': false, allowed: true }],
        ],
      };

      sanitizeInPlace(payload);

      expect(payload).toEqual({
        normalKey: 'valid',
        nested: {
          goodKey: 123,
        },
        items: [{ safe: 'item1' }, { fine: 'item2' }, [{ allowed: true }]],
      });
      expect(payload['$topLevelBad']).toBeUndefined();
      expect(payload['key.with.dot']).toBeUndefined();
      expect(
        (payload.nested as Record<string, unknown>)['$gt']
      ).toBeUndefined();
    });

    it('should handle primitives, null, and empty objects without error', () => {
      expect(() => sanitizeInPlace(null)).not.toThrow();
      expect(() => sanitizeInPlace(undefined)).not.toThrow();
      expect(() => sanitizeInPlace('string')).not.toThrow();
      expect(() => sanitizeInPlace(123)).not.toThrow();
      expect(() => sanitizeInPlace({})).not.toThrow();
      expect(() => sanitizeInPlace([])).not.toThrow();
    });
  });
});
