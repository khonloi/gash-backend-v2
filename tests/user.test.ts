import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../src/app.js';
import { User } from '../src/models/User.js';
import { Cart } from '../src/models/Cart.js';
import { signAccessToken } from '../src/utils/jwt.js';
import { IAddress } from '../src/types/index.js';

type SavedAddress = IAddress & { _id: string };

let mongoServer: MongoMemoryServer;
let customerToken: string;
let customerId: string;
let adminToken: string;
let adminId: string;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await User.deleteMany({});

  const customer = await User.create({
    firstName: 'John',
    lastName: 'Doe',
    email: 'john.doe@example.com',
    password: 'Password123!',
    role: 'customer',
  });
  customerId = customer._id.toString();
  customerToken = signAccessToken(customerId, 'customer');

  const admin = await User.create({
    firstName: 'Super',
    lastName: 'Admin',
    email: 'super.admin@example.com',
    password: 'AdminPassword123!',
    role: 'admin',
  });
  adminId = admin._id.toString();
  adminToken = signAccessToken(adminId, 'admin');
});

const sampleAddress = {
  label: 'Home',
  fullName: 'John Doe',
  addressLine1: '123 Main Street',
  city: 'Springfield',
  state: 'IL',
  postalCode: '62701',
  country: 'US',
  phone: '555-123-4567',
};

describe('User Profile & Admin Integration Tests', () => {
  describe('GET /api/v1/users/me', () => {
    it('should return current user profile when authenticated', async () => {
      const res = await request(app)
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${customerToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.user.email).toBe('john.doe@example.com');
      expect(res.body.data.user).not.toHaveProperty('password');
    });

    it('should fail with 401 when unauthenticated', async () => {
      const res = await request(app).get('/api/v1/users/me');

      expect(res.statusCode).toBe(401);
      expect(res.body.status).toBe('fail');
    });
  });

  describe('PATCH /api/v1/users/me', () => {
    it('should update profile fields successfully', async () => {
      const res = await request(app)
        .patch('/api/v1/users/me')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          firstName: 'Jonathan',
          phone: '+15559876543',
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.data.user.firstName).toBe('Jonathan');
      expect(res.body.data.user.phone).toBe('+15559876543');
      expect(res.body.data.user).not.toHaveProperty('passwordChangedAt');
    });

    it('should reject dangerous avatar URI schemes', async () => {
      const res = await request(app)
        .patch('/api/v1/users/me')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          avatar: 'javascript:alert(1)',
        });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('PATCH /api/v1/users/me/password', () => {
    it('should change password, set new HttpOnly refresh cookie, and invalidate old access token', async () => {
      const res = await request(app)
        .patch('/api/v1/users/me/password')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          currentPassword: 'Password123!',
          newPassword: 'BrandNewPassword456!',
          newPasswordConfirm: 'BrandNewPassword456!',
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.data.tokens).toHaveProperty('accessToken');
      expect(res.body.data.tokens).not.toHaveProperty('refreshToken');

      const setCookie = res.headers['set-cookie'] as unknown as string[];
      expect(setCookie).toBeDefined();
      const refreshCookie = setCookie.find((c) =>
        c.startsWith('refreshToken=')
      );
      expect(refreshCookie).toBeDefined();

      // Refreshing using the new cookie works without triggering reuse detection
      const refreshRes = await request(app)
        .post('/api/v1/auth/refresh-token')
        .set('Cookie', refreshCookie!.split(';')[0]);
      expect(refreshRes.statusCode).toBe(200);

      // Old access token is invalidated immediately
      const oldTokenRes = await request(app)
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${customerToken}`);
      expect(oldTokenRes.statusCode).toBe(401);

      // Verify can login with new password
      const loginRes = await request(app).post('/api/v1/auth/login').send({
        email: 'john.doe@example.com',
        password: 'BrandNewPassword456!',
      });
      expect(loginRes.statusCode).toBe(200);
    });

    it('should fail with 401 if current password is incorrect', async () => {
      const res = await request(app)
        .patch('/api/v1/users/me/password')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          currentPassword: 'WrongPassword!',
          newPassword: 'BrandNewPassword456!',
          newPasswordConfirm: 'BrandNewPassword456!',
        });

      expect(res.statusCode).toBe(401);
      expect(res.body.message).toMatch(/incorrect/i);
    });

    it('should fail with 400 if new password equals current password', async () => {
      const res = await request(app)
        .patch('/api/v1/users/me/password')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          currentPassword: 'Password123!',
          newPassword: 'Password123!',
          newPasswordConfirm: 'Password123!',
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(/must be different/i);
    });
  });

  describe('DELETE /api/v1/users/me (Soft Delete)', () => {
    it('should soft delete user account and prevent future login', async () => {
      const res = await request(app)
        .delete('/api/v1/users/me')
        .set('Authorization', `Bearer ${customerToken}`);

      expect(res.statusCode).toBe(204);

      // Verify user in DB is isActive: false
      const dbUser = await User.findById(customerId);
      expect(dbUser?.isActive).toBe(false);

      // Subsequent login attempt should fail with 401
      const loginRes = await request(app).post('/api/v1/auth/login').send({
        email: 'john.doe@example.com',
        password: 'Password123!',
      });
      expect(loginRes.statusCode).toBe(401);
      expect(loginRes.body.message).toMatch(/deactivated/i);
    });
  });

  describe('User Address Management', () => {
    it('should add an address and set it as default when first', async () => {
      const res = await request(app)
        .post('/api/v1/users/me/addresses')
        .set('Authorization', `Bearer ${customerToken}`)
        .send(sampleAddress);

      expect(res.statusCode).toBe(201);
      expect(res.body.data.addresses).toHaveLength(1);
      expect(res.body.data.addresses[0].isDefault).toBe(true);
      expect(res.body.data.addresses[0].addressLine1).toBe(
        sampleAddress.addressLine1
      );
    });

    it('should update default address when adding a second default address', async () => {
      await request(app)
        .post('/api/v1/users/me/addresses')
        .set('Authorization', `Bearer ${customerToken}`)
        .send(sampleAddress);

      const secondAddress = {
        ...sampleAddress,
        label: 'Work',
        addressLine1: '456 Tech Park',
        isDefault: true,
      };

      const res = await request(app)
        .post('/api/v1/users/me/addresses')
        .set('Authorization', `Bearer ${customerToken}`)
        .send(secondAddress);

      expect(res.statusCode).toBe(201);
      const addresses = res.body.data.addresses as SavedAddress[];
      expect(addresses).toHaveLength(2);

      const first = addresses.find((a: SavedAddress) => a.label === 'Home');
      const second = addresses.find((a: SavedAddress) => a.label === 'Work');
      expect(first?.isDefault).toBe(false);
      expect(second?.isDefault).toBe(true);
    });

    it('should update an existing address without resetting label, country, or isDefault', async () => {
      const addRes = await request(app)
        .post('/api/v1/users/me/addresses')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          ...sampleAddress,
          label: 'Office',
          country: 'CA',
          isDefault: true,
        });

      const addressId = addRes.body.data.addresses[0]._id;

      const res = await request(app)
        .patch(`/api/v1/users/me/addresses/${addressId}`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ city: 'Chicago', postalCode: '60601' });

      expect(res.statusCode).toBe(200);
      const updatedAddresses = res.body.data.addresses as SavedAddress[];
      const updated = updatedAddresses.find(
        (a: SavedAddress) => a._id === addressId
      );
      expect(updated?.city).toBe('Chicago');
      expect(updated?.postalCode).toBe('60601');
      expect(updated?.label).toBe('Office');
      expect(updated?.country).toBe('CA');
      expect(updated?.isDefault).toBe(true);
    });

    it('should remove an address', async () => {
      const addRes = await request(app)
        .post('/api/v1/users/me/addresses')
        .set('Authorization', `Bearer ${customerToken}`)
        .send(sampleAddress);

      const addressId = addRes.body.data.addresses[0]._id;

      const res = await request(app)
        .delete(`/api/v1/users/me/addresses/${addressId}`)
        .set('Authorization', `Bearer ${customerToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data.addresses).toHaveLength(0);
    });
  });

  describe('Admin Operations (RBAC)', () => {
    it('should allow admin to list all users', async () => {
      const res = await request(app)
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.results).toBeGreaterThanOrEqual(2);
      expect(res.body).toHaveProperty('pagination');
    });

    it('should never expose password or token hashes via ?fields= projection and should honor ?isActive=false', async () => {
      await User.create({
        firstName: 'Inactive',
        lastName: 'Account',
        email: 'inactive.query@example.com',
        password: 'Password123!',
        isActive: false,
      });

      const projRes = await request(app)
        .get(
          '/api/v1/users?fields=email,password,refreshTokens,passwordResetToken'
        )
        .set('Authorization', `Bearer ${adminToken}`);

      expect(projRes.statusCode).toBe(200);
      for (const u of projRes.body.data.users) {
        expect(u.email).toBeDefined();
        expect(u.password).toBeUndefined();
        expect(u.refreshTokens).toBeUndefined();
        expect(u.passwordResetToken).toBeUndefined();
      }

      const spaceProjRes = await request(app)
        .get('/api/v1/users?fields=email%20+password')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(spaceProjRes.statusCode).toBe(200);
      for (const u of spaceProjRes.body.data.users) {
        expect(u.password).toBeUndefined();
      }

      const inactiveRes = await request(app)
        .get('/api/v1/users?isActive=false')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(inactiveRes.statusCode).toBe(200);
      expect(inactiveRes.body.results).toBe(1);
      expect(inactiveRes.body.data.users[0].email).toBe(
        'inactive.query@example.com'
      );

      const searchRes = await request(app)
        .get('/api/v1/users?search=John')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(searchRes.statusCode).toBe(200);
      expect(searchRes.body.results).toBeGreaterThanOrEqual(1);
    });

    it('should forbid customer from listing all users', async () => {
      const res = await request(app)
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${customerToken}`);

      expect(res.statusCode).toBe(403);
      expect(res.body.status).toBe('fail');
    });

    it('should allow admin to update a user role and prevent admin self-demotion', async () => {
      const res = await request(app)
        .patch(`/api/v1/users/${customerId}/role`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'seller' });

      expect(res.statusCode).toBe(200);
      expect(res.body.data.user.role).toBe('seller');

      const updated = await User.findById(customerId);
      expect(updated?.role).toBe('seller');

      // Previous customer token invalidated on role change
      const staleRes = await request(app)
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${customerToken}`);
      expect(staleRes.statusCode).toBe(401);

      // Admin cannot self-demote
      const selfDemote = await request(app)
        .patch(`/api/v1/users/${adminId}/role`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'customer' });
      expect(selfDemote.statusCode).toBe(400);
    });

    it('should allow admin to delete a user', async () => {
      const res = await request(app)
        .delete(`/api/v1/users/${customerId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.statusCode).toBe(204);

      const check = await User.findById(customerId);
      expect(check).toBeNull();
    });

    it('should prevent admin from deleting their own account', async () => {
      const res = await request(app)
        .delete(`/api/v1/users/${adminId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(/cannot delete their own account/i);

      const check = await User.findById(adminId);
      expect(check).not.toBeNull();
    });

    it('should cascade delete user cart when user is deleted', async () => {
      await Cart.create({ user: customerId, items: [] });
      const cartBefore = await Cart.findOne({ user: customerId });
      expect(cartBefore).not.toBeNull();

      const res = await request(app)
        .delete(`/api/v1/users/${customerId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.statusCode).toBe(204);

      const cartAfter = await Cart.findOne({ user: customerId });
      expect(cartAfter).toBeNull();
    });
  });
});
