import request, { Response } from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../src/app.js';
import { User } from '../src/models/User.js';
import { RefreshToken } from '../src/models/RefreshToken.js';
import { createTokenHash } from '../src/utils/crypto.js';
import { signAccessToken } from '../src/utils/jwt.js';

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
  await Promise.all([User.deleteMany({}), RefreshToken.deleteMany({})]);
});

const sampleUser = {
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'jane.doe@example.com',
  password: 'Password123!',
  passwordConfirm: 'Password123!',
};

function extractRefreshCookie(res: Response): {
  header: string;
  cookiePair: string;
  rawToken: string;
} {
  const setCookieHeaders = res.headers['set-cookie'] as unknown as
    string[] | undefined;
  expect(setCookieHeaders).toBeDefined();
  const header = setCookieHeaders!.find((c) => c.startsWith('refreshToken='));
  expect(header).toBeDefined();
  const cookiePair = header!.split(';')[0];
  const rawToken = decodeURIComponent(cookiePair.slice('refreshToken='.length));
  return { header: header!, cookiePair, rawToken };
}

describe('Auth Integration Tests', () => {
  describe('POST /api/v1/auth/register', () => {
    it('should register a new user, return accessToken only in JSON, and set HttpOnly refresh cookie', async () => {
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
      expect(res.body.data.tokens).not.toHaveProperty('refreshToken');

      const { header } = extractRefreshCookie(res);
      expect(header).toMatch(/HttpOnly/i);
      expect(header).toMatch(/Path=\/api\/v1\/auth/i);

      // Verify email verification token was generated on user record
      const dbUser = await User.findOne({
        email: sampleUser.email.toLowerCase(),
      }).select('+emailVerificationToken +emailVerificationExpires');
      expect(dbUser?.emailVerificationToken).toBeDefined();
      expect(dbUser?.emailVerificationExpires).toBeDefined();
    });

    it('should accept password manager special characters (#, -, _, ^)', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          ...sampleUser,
          email: 'pwmanager@example.com',
          password: 'Valid_Password-2026#',
          passwordConfirm: 'Valid_Password-2026#',
        });

      expect(res.statusCode).toBe(201);
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

    it('should login successfully with correct credentials and set refresh cookie', async () => {
      const res = await request(app).post('/api/v1/auth/login').send({
        email: sampleUser.email,
        password: sampleUser.password,
      });

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.user.email).toBe(sampleUser.email.toLowerCase());
      expect(res.body.data.tokens).toHaveProperty('accessToken');
      expect(res.body.data.tokens).not.toHaveProperty('refreshToken');
      extractRefreshCookie(res);
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

  describe('POST /api/v1/auth/refresh-token (HttpOnly Cookie Rotation)', () => {
    it('should store hashed tokens in RefreshToken collection, rotate atomically, and detect reuse', async () => {
      const reg = await request(app)
        .post('/api/v1/auth/register')
        .send(sampleUser);

      const { cookiePair: initialCookie, rawToken: initialRawToken } =
        extractRefreshCookie(reg);

      // Verify DB stores SHA-256 hash, not raw JWT
      const storedTokens = await RefreshToken.find({});
      expect(storedTokens).toHaveLength(1);
      expect(storedTokens[0].tokenHash).toBe(createTokenHash(initialRawToken));
      expect(storedTokens[0].tokenHash).not.toBe(initialRawToken);

      // Rotate via HttpOnly cookie
      const res = await request(app)
        .post('/api/v1/auth/refresh-token')
        .set('Cookie', initialCookie);

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.tokens).toHaveProperty('accessToken');
      expect(res.body.data.tokens).not.toHaveProperty('refreshToken');
      const { rawToken: rotatedRawToken } = extractRefreshCookie(res);
      expect(rotatedRawToken).not.toBe(initialRawToken);

      // Single concurrent retry within grace window succeeds (multi-tab support)
      const concurrentRes = await request(app)
        .post('/api/v1/auth/refresh-token')
        .set('Cookie', initialCookie);

      expect(concurrentRes.statusCode).toBe(200);
      extractRefreshCookie(concurrentRes);

      // Subsequent replay (grace already consumed) triggers reuse detection and wipes all sessions
      const secondReplayRes = await request(app)
        .post('/api/v1/auth/refresh-token')
        .set('Cookie', initialCookie);

      expect(secondReplayRes.statusCode).toBe(401);
      expect(secondReplayRes.body.message).toMatch(/reused/i);

      const remainingTokens = await RefreshToken.find({});
      expect(remainingTokens).toHaveLength(0);
    });

    it('should detect reuse after grace period expiration and purge all sessions', async () => {
      const registerRes = await request(app)
        .post('/api/v1/auth/register')
        .send(sampleUser);

      const { cookiePair: initialCookie, rawToken: initialRawToken } =
        extractRefreshCookie(registerRes);

      await request(app)
        .post('/api/v1/auth/refresh-token')
        .set('Cookie', initialCookie);

      // Expire grace window on the revoked token
      await RefreshToken.updateOne(
        { tokenHash: createTokenHash(initialRawToken) },
        { $set: { revokedAt: new Date(Date.now() - 35000) } }
      );

      const reuseRes = await request(app)
        .post('/api/v1/auth/refresh-token')
        .set('Cookie', initialCookie);

      expect(reuseRes.statusCode).toBe(401);
      expect(reuseRes.body.message).toMatch(/Invalid or reused refresh token/i);
      expect(await RefreshToken.find({})).toHaveLength(0);
    });

    it('should fail with 400 when refresh cookie is missing and 401 when invalid', async () => {
      const missingRes = await request(app).post('/api/v1/auth/refresh-token');
      expect(missingRes.statusCode).toBe(400);

      const invalidRes = await request(app)
        .post('/api/v1/auth/refresh-token')
        .set('Cookie', 'refreshToken=invalid.token.here');
      expect(invalidRes.statusCode).toBe(401);
    });
  });

  describe('POST /api/v1/auth/logout and /logout-all', () => {
    it('should log out single session via cookie even when access token is omitted/expired', async () => {
      const reg = await request(app)
        .post('/api/v1/auth/register')
        .send(sampleUser);

      const { cookiePair } = extractRefreshCookie(reg);

      // Logout using only the refresh cookie (simulates expired access token)
      const res = await request(app)
        .post('/api/v1/auth/logout')
        .set('Cookie', cookiePair);

      expect(res.statusCode).toBe(200);
      expect(res.body.message).toMatch(/Logged out successfully/i);
      expect(await RefreshToken.find({})).toHaveLength(0);

      // Refreshing with that cookie should now fail
      const refreshRes = await request(app)
        .post('/api/v1/auth/refresh-token')
        .set('Cookie', cookiePair);

      expect(refreshRes.statusCode).toBe(401);
    });

    it('should log out all sessions and immediately invalidate active access tokens', async () => {
      const reg = await request(app)
        .post('/api/v1/auth/register')
        .send(sampleUser);

      const { accessToken } = reg.body.data.tokens;

      const res = await request(app)
        .post('/api/v1/auth/logout-all')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.statusCode).toBe(200);
      expect(await RefreshToken.find({})).toHaveLength(0);

      // Existing access token is invalidated immediately via tokenVersion
      const meRes = await request(app)
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(meRes.statusCode).toBe(401);
    });
  });

  describe('POST /api/v1/auth/forgot-password & POST /reset-password', () => {
    it('should generate reset token and allow password reset with token in body', async () => {
      await request(app).post('/api/v1/auth/register').send(sampleUser);

      // 1) Request forgot password
      const forgotRes = await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({ email: sampleUser.email });

      expect(forgotRes.statusCode).toBe(200);
      expect(forgotRes.body.message).toMatch(/instructions have been sent/i);

      const user = await User.findOne({
        email: sampleUser.email.toLowerCase(),
      });
      const resetToken = user!.createPasswordResetToken();
      await user!.save();

      // 2) Reset password with token in POST body
      const newPassword = 'NewPassword999!';
      const resetRes = await request(app)
        .post('/api/v1/auth/reset-password')
        .send({
          token: resetToken,
          password: newPassword,
          passwordConfirm: newPassword,
        });

      expect(resetRes.statusCode).toBe(200);
      expect(resetRes.body.data.tokens).toHaveProperty('accessToken');
      expect(resetRes.body.data.tokens).not.toHaveProperty('refreshToken');
      extractRefreshCookie(resetRes);

      // 3) Verify can login with new password
      const loginRes = await request(app).post('/api/v1/auth/login').send({
        email: sampleUser.email,
        password: newPassword,
      });

      expect(loginRes.statusCode).toBe(200);
    });

    it('should reject password reset for deactivated account', async () => {
      await request(app).post('/api/v1/auth/register').send(sampleUser);
      const user = await User.findOne({
        email: sampleUser.email.toLowerCase(),
      });
      const resetToken = user!.createPasswordResetToken();
      user!.isActive = false;
      await user!.save();

      const res = await request(app).post('/api/v1/auth/reset-password').send({
        token: resetToken,
        password: 'NewPassword999!',
        passwordConfirm: 'NewPassword999!',
      });

      expect(res.statusCode).toBe(401);
      expect(res.body.message).toMatch(/deactivated/i);
    });

    it('should return 200 for forgot-password even if email does not exist (anti-enumeration)', async () => {
      const res = await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({ email: 'nonexistent@example.com' });

      expect(res.statusCode).toBe(200);
      expect(res.body.message).toMatch(/instructions have been sent/i);
    });

    it('should fail with 400 when reset token is invalid or expired', async () => {
      const res = await request(app).post('/api/v1/auth/reset-password').send({
        token: 'invalid-or-expired-token',
        password: 'ValidPassword123!',
        passwordConfirm: 'ValidPassword123!',
      });

      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(/invalid or has expired/i);
    });
  });

  describe('POST /api/v1/auth/verify-email', () => {
    it('should verify email successfully with valid token in body', async () => {
      await request(app).post('/api/v1/auth/register').send(sampleUser);

      const user = await User.findOne({
        email: sampleUser.email.toLowerCase(),
      });
      const token = user!.createEmailVerificationToken();
      await user!.save();

      const res = await request(app)
        .post('/api/v1/auth/verify-email')
        .send({ token });

      expect(res.statusCode).toBe(200);
      expect(res.body.message).toMatch(/successfully verified/i);

      const verifiedUser = await User.findOne({
        email: sampleUser.email.toLowerCase(),
      });
      expect(verifiedUser?.isEmailVerified).toBe(true);
    });

    it('should fail with 400 for invalid email verification token', async () => {
      const res = await request(app)
        .post('/api/v1/auth/verify-email')
        .send({ token: 'fake-token-123' });

      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(/invalid or has expired/i);
    });

    it('should fail with 401 when verifying email of deactivated account', async () => {
      const user = await User.create({
        firstName: 'Deact',
        lastName: 'User',
        email: 'deact.verify@example.com',
        password: 'Password123!',
        isActive: false,
      });
      const token = user.createEmailVerificationToken();
      await user.save();

      const res = await request(app)
        .post('/api/v1/auth/verify-email')
        .send({ token });

      expect(res.statusCode).toBe(401);
      expect(res.body.message).toMatch(/deactivated/i);
    });
  });

  describe('Access token validation', () => {
    it('should reject access token after tokenVersion mismatch', async () => {
      const user = await User.create({
        firstName: 'Ver',
        lastName: 'User',
        email: 'ver@example.com',
        password: 'Password123!',
        tokenVersion: 2,
      });
      const staleToken = signAccessToken(user._id.toString(), 'customer', 1);

      const res = await request(app)
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${staleToken}`);

      expect(res.statusCode).toBe(401);
    });
  });
});
