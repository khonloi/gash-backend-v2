import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../src/app.js';
import { User } from '../src/models/User.js';

let mongoServer: MongoMemoryServer;

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
});

const sampleUser = {
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'jane.doe@example.com',
  password: 'Password123!',
  passwordConfirm: 'Password123!',
};

describe('Auth Integration Tests', () => {
  describe('POST /api/v1/auth/register', () => {
    it('should register a new user successfully and return tokens', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send(sampleUser);

      expect(res.statusCode).toBe(201);
      expect(res.body.status).toBe('success');
      expect(res.body.data.user).toHaveProperty('_id');
      expect(res.body.data.user.email).toBe(sampleUser.email.toLowerCase());
      expect(res.body.data.user.role).toBe('customer');
      expect(res.body.data.user).not.toHaveProperty('password');
      expect(res.body.data.user).not.toHaveProperty('refreshTokens');
      expect(res.body.data.tokens).toHaveProperty('accessToken');
      expect(res.body.data.tokens).toHaveProperty('refreshToken');

      // Verify email verification token was generated on user record
      const dbUser = await User.findOne({
        email: sampleUser.email.toLowerCase(),
      }).select('+emailVerificationToken +emailVerificationExpires');
      expect(dbUser?.emailVerificationToken).toBeDefined();
      expect(dbUser?.emailVerificationExpires).toBeDefined();
    });

    it('should fail with 400 when registering with duplicate email', async () => {
      await request(app).post('/api/v1/auth/register').send(sampleUser);

      const res = await request(app)
        .post('/api/v1/auth/register')
        .send(sampleUser);

      expect(res.statusCode).toBe(400);
      expect(res.body.status).toBe('fail');
      expect(res.body.message).toMatch(/already exists/i);
    });

    it('should fail with 400 when passwords do not match', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          ...sampleUser,
          passwordConfirm: 'DifferentPassword123!',
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.status).toBe('fail');
      expect(res.body.message).toMatch(/Passwords do not match/i);
    });

    it('should fail with 400 when password does not meet complexity requirements', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          ...sampleUser,
          password: 'weak',
          passwordConfirm: 'weak',
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.status).toBe('fail');
      expect(res.body.message).toMatch(/Password must/i);
    });

    it('should fail with 400 when required fields are missing', async () => {
      const res = await request(app).post('/api/v1/auth/register').send({
        email: 'incomplete@example.com',
      });

      expect(res.statusCode).toBe(400);
      expect(res.body.status).toBe('fail');
    });
  });

  describe('POST /api/v1/auth/login', () => {
    beforeEach(async () => {
      await request(app).post('/api/v1/auth/register').send(sampleUser);
    });

    it('should login successfully with correct credentials', async () => {
      const res = await request(app).post('/api/v1/auth/login').send({
        email: sampleUser.email,
        password: sampleUser.password,
      });

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.user.email).toBe(sampleUser.email.toLowerCase());
      expect(res.body.data.tokens).toHaveProperty('accessToken');
      expect(res.body.data.tokens).toHaveProperty('refreshToken');
    });

    it('should fail with 401 for incorrect password', async () => {
      const res = await request(app).post('/api/v1/auth/login').send({
        email: sampleUser.email,
        password: 'WrongPassword123!',
      });

      expect(res.statusCode).toBe(401);
      expect(res.body.status).toBe('fail');
      expect(res.body.message).toMatch(/Incorrect email or password/i);
    });

    it('should fail with 401 for non-existent email', async () => {
      const res = await request(app).post('/api/v1/auth/login').send({
        email: 'nobody@example.com',
        password: sampleUser.password,
      });

      expect(res.statusCode).toBe(401);
      expect(res.body.status).toBe('fail');
    });

    it('should fail with 401 when account is deactivated', async () => {
      await User.findOneAndUpdate(
        { email: sampleUser.email.toLowerCase() },
        { isActive: false }
      );

      const res = await request(app).post('/api/v1/auth/login').send({
        email: sampleUser.email,
        password: sampleUser.password,
      });

      expect(res.statusCode).toBe(401);
      expect(res.body.message).toMatch(/deactivated/i);
    });
  });

  describe('POST /api/v1/auth/refresh-token (Token Rotation)', () => {
    it('should rotate refresh token and issue new token pair', async () => {
      const reg = await request(app)
        .post('/api/v1/auth/register')
        .send(sampleUser);

      const initialRefreshToken = reg.body.data.tokens.refreshToken;

      const res = await request(app)
        .post('/api/v1/auth/refresh-token')
        .send({ refreshToken: initialRefreshToken });

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.tokens).toHaveProperty('accessToken');
      expect(res.body.data.tokens).toHaveProperty('refreshToken');
      expect(res.body.data.tokens.refreshToken).not.toBe(initialRefreshToken);

      // Verify that using the old token again fails and triggers reuse detection
      const reuseRes = await request(app)
        .post('/api/v1/auth/refresh-token')
        .send({ refreshToken: initialRefreshToken });

      expect(reuseRes.statusCode).toBe(401);
      expect(reuseRes.body.message).toMatch(/reused/i);

      // Verify all sessions were invalidated on reuse detection
      const user = await User.findOne({
        email: sampleUser.email.toLowerCase(),
      }).select('+refreshTokens');
      expect(user?.refreshTokens).toHaveLength(0);
    });

    it('should fail with 401 for invalid refresh token', async () => {
      const res = await request(app)
        .post('/api/v1/auth/refresh-token')
        .send({ refreshToken: 'invalid.token.here' });

      expect(res.statusCode).toBe(401);
    });
  });

  describe('POST /api/v1/auth/logout and /logout-all', () => {
    it('should log out single session by removing specific refresh token', async () => {
      const reg = await request(app)
        .post('/api/v1/auth/register')
        .send(sampleUser);

      const { accessToken, refreshToken } = reg.body.data.tokens;

      const res = await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ refreshToken });

      expect(res.statusCode).toBe(200);
      expect(res.body.message).toMatch(/Logged out successfully/i);

      // Refreshing with that token should now fail
      const refreshRes = await request(app)
        .post('/api/v1/auth/refresh-token')
        .send({ refreshToken });

      expect(refreshRes.statusCode).toBe(401);
    });

    it('should log out all sessions', async () => {
      const reg = await request(app)
        .post('/api/v1/auth/register')
        .send(sampleUser);

      const { accessToken } = reg.body.data.tokens;

      const res = await request(app)
        .post('/api/v1/auth/logout-all')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.statusCode).toBe(200);

      const user = await User.findOne({
        email: sampleUser.email.toLowerCase(),
      }).select('+refreshTokens');
      expect(user?.refreshTokens).toHaveLength(0);
    });
  });

  describe('POST /api/v1/auth/forgot-password & PATCH /reset-password/:token', () => {
    it('should generate reset token and allow password reset', async () => {
      await request(app).post('/api/v1/auth/register').send(sampleUser);

      // 1) Request forgot password
      const forgotRes = await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({ email: sampleUser.email });

      expect(forgotRes.statusCode).toBe(200);
      expect(forgotRes.body.message).toMatch(/instructions have been sent/i);

      // Retrieve user and generate a known reset token to test the endpoint
      const user = await User.findOne({
        email: sampleUser.email.toLowerCase(),
      });
      const resetToken = user!.createPasswordResetToken();
      await user!.save();

      // 2) Reset password with token
      const newPassword = 'NewPassword999!';
      const resetRes = await request(app)
        .patch(`/api/v1/auth/reset-password/${resetToken}`)
        .send({
          password: newPassword,
          passwordConfirm: newPassword,
        });

      expect(resetRes.statusCode).toBe(200);
      expect(resetRes.body.data.tokens).toHaveProperty('accessToken');

      // 3) Verify can login with new password
      const loginRes = await request(app).post('/api/v1/auth/login').send({
        email: sampleUser.email,
        password: newPassword,
      });

      expect(loginRes.statusCode).toBe(200);
    });

    it('should return 200 for forgot-password even if email does not exist (anti-enumeration)', async () => {
      const res = await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({ email: 'nonexistent@example.com' });

      expect(res.statusCode).toBe(200);
      expect(res.body.message).toMatch(/instructions have been sent/i);
    });

    it('should fail with 400 when reset token is invalid or expired', async () => {
      const res = await request(app)
        .patch('/api/v1/auth/reset-password/invalid-or-expired-token')
        .send({
          password: 'ValidPassword123!',
          passwordConfirm: 'ValidPassword123!',
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(/invalid or has expired/i);
    });
  });

  describe('GET /api/v1/auth/verify-email/:token', () => {
    it('should verify email successfully with valid token', async () => {
      await request(app).post('/api/v1/auth/register').send(sampleUser);

      const user = await User.findOne({
        email: sampleUser.email.toLowerCase(),
      });
      const token = user!.createEmailVerificationToken();
      await user!.save();

      const res = await request(app).get(`/api/v1/auth/verify-email/${token}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.message).toMatch(/successfully verified/i);

      const verifiedUser = await User.findOne({
        email: sampleUser.email.toLowerCase(),
      });
      expect(verifiedUser?.isEmailVerified).toBe(true);
    });

    it('should fail with 400 for invalid email verification token', async () => {
      const res = await request(app).get(
        '/api/v1/auth/verify-email/fake-token-123'
      );

      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(/invalid or has expired/i);
    });
  });
});
