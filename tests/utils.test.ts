import mongoose from 'mongoose';
import { toSafeUser } from '../src/utils/sanitize.js';
import { resolveOwnerId } from '../src/utils/resolveOwnerId.js';
import { sanitizeInPlace } from '../src/middlewares/mongoSanitize.js';
import { slugify } from '../src/utils/slugify.js';
import { createTokenHash, generateRandomToken } from '../src/utils/crypto.js';
import { AppError } from '../src/utils/AppError.js';
import { APIFeatures } from '../src/utils/apiFeatures.js';
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

  describe('slugify', () => {
    it('should generate URL-friendly lowercase slugs', () => {
      expect(slugify('Running Pro Shoes')).toBe('running-pro-shoes');
    });

    it('should normalize accented and unicode characters', () => {
      expect(slugify('Café & Crème Brûlée')).toBe('cafe-creme-brulee');
    });

    it('should remove special characters and symbols', () => {
      expect(slugify('Product #123 (Special Edition!)')).toBe(
        'product-123-special-edition'
      );
    });

    it('should collapse multiple spaces, hyphens, and underscores', () => {
      expect(slugify('multiple   spaces___and---dashes')).toBe(
        'multiple-spaces-and-dashes'
      );
    });

    it('should trim leading and trailing hyphens and whitespace', () => {
      expect(slugify('  --Leading & Trailing--  ')).toBe('leading-trailing');
    });

    it('should return empty string for symbols only', () => {
      expect(slugify('!@#$%^&*()')).toBe('');
    });
  });

  describe('crypto utilities', () => {
    describe('createTokenHash', () => {
      it('should deterministically produce 64-character SHA-256 hex string', () => {
        const hash1 = createTokenHash('test-token-value');
        const hash2 = createTokenHash('test-token-value');
        expect(hash1).toBe(hash2);
        expect(hash1).toHaveLength(64);
        expect(hash1).toMatch(/^[0-9a-f]{64}$/);
      });

      it('should produce different hashes for different inputs', () => {
        expect(createTokenHash('token-A')).not.toBe(createTokenHash('token-B'));
      });
    });

    describe('generateRandomToken', () => {
      it('should generate a 64-character cryptographically secure hex string', () => {
        const token = generateRandomToken();
        expect(token).toHaveLength(64);
        expect(token).toMatch(/^[0-9a-f]{64}$/);
      });

      it('should produce unique tokens across multiple invocations', () => {
        const token1 = generateRandomToken();
        const token2 = generateRandomToken();
        expect(token1).not.toBe(token2);
      });
    });
  });

  describe('AppError', () => {
    it('should create an operational error with status fail for 4xx status codes', () => {
      const err = new AppError('Resource not found', 404);
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toBe('Resource not found');
      expect(err.statusCode).toBe(404);
      expect(err.status).toBe('fail');
      expect(err.isOperational).toBe(true);
      expect(err.stack).toBeDefined();
    });

    it('should create an operational error with status error for 5xx status codes', () => {
      const err = new AppError('Internal database failure', 500);
      expect(err.statusCode).toBe(500);
      expect(err.status).toBe('error');
      expect(err.isOperational).toBe(true);
    });
  });

  describe('APIFeatures', () => {
    const createMockQuery = () => {
      const query: any = {};
      const createChainableFn = () => {
        const calls: unknown[][] = [];
        const fn: any = (...args: unknown[]) => {
          calls.push(args);
          return query;
        };
        fn.calls = calls;
        return fn;
      };
      query.find = createChainableFn();
      query.sort = createChainableFn();
      query.select = createChainableFn();
      query.skip = createChainableFn();
      query.limit = createChainableFn();
      return query;
    };

    it('should filter query parameters and convert comparison operators', () => {
      const mockQuery = createMockQuery();
      const queryString = {
        category: 'Footwear',
        minPrice: '50',
        maxPrice: '200',
        page: '1',
        sort: 'price',
      };

      const features = new APIFeatures(mockQuery as any, queryString);
      features.filter();

      expect(mockQuery.find.calls[0][0]).toEqual({
        category: 'Footwear',
        price: { $gte: 50, $lte: 200 },
      });
    });

    it('should search using $text query when keyword is provided', () => {
      const mockQuery = createMockQuery();
      const features = new APIFeatures(mockQuery as any, {
        keyword: 'sneakers',
      });
      features.search();

      expect(mockQuery.find.calls[0][0]).toEqual({
        $text: { $search: 'sneakers' },
      });
    });

    it('should not add $text query when keyword is missing or empty', () => {
      const mockQuery = createMockQuery();
      const features = new APIFeatures(mockQuery as any, { keyword: '   ' });
      features.search();

      expect(mockQuery.find.calls).toHaveLength(0);
    });

    it('should apply custom sort and fallback to -createdAt by default', () => {
      const mockQueryCustom = createMockQuery();
      new APIFeatures(mockQueryCustom as any, {
        sort: 'price,-ratingsAverage',
      }).sort();
      expect(mockQueryCustom.sort.calls[0][0]).toBe('price -ratingsAverage');

      const mockQueryDefault = createMockQuery();
      new APIFeatures(mockQueryDefault as any, {}).sort();
      expect(mockQueryDefault.sort.calls[0][0]).toBe('-createdAt');
    });

    it('should project specified fields and exclude -__v by default', () => {
      const mockQueryCustom = createMockQuery();
      new APIFeatures(mockQueryCustom as any, {
        fields: 'name,price,slug',
      }).limitFields();
      expect(mockQueryCustom.select.calls[0][0]).toBe('name price slug');

      const mockQueryDefault = createMockQuery();
      new APIFeatures(mockQueryDefault as any, {}).limitFields();
      expect(mockQueryDefault.select.calls[0][0]).toBe('-__v');
    });

    it('should paginate results and compute correct pagination metadata', () => {
      const mockQuery = createMockQuery();
      const features = new APIFeatures(mockQuery as any, {
        page: '3',
        limit: '15',
      });
      features.paginate(50);

      expect(mockQuery.skip.calls[0][0]).toBe(30); // (3 - 1) * 15
      expect(mockQuery.limit.calls[0][0]).toBe(15);
      expect(features.pagination).toEqual({
        page: 3,
        limit: 15,
        totalPages: 4, // Math.ceil(50 / 15)
        totalResults: 50,
      });
    });
  });
});
