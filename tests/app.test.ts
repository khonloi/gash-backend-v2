import request from 'supertest';
import app from '../src/app.js';

describe('App Endpoints', () => {
  it('GET /api/v1/health should return 200 OK', async () => {
    const res = await request(app).get('/api/v1/health');

    expect(res.statusCode).toEqual(200);
    expect(res.body).toHaveProperty('status', 'success');
    expect(res.body).toHaveProperty('message', 'API is running');
  });

  it('GET /unknown-route should return 404', async () => {
    const res = await request(app).get('/api/v1/unknown-route');

    expect(res.statusCode).toEqual(404);
    expect(res.body).toHaveProperty('status', 'fail');
    expect(res.body.message).toMatch(/Can't find/);
  });

  describe('Security Headers & CORS', () => {
    it('should include hardened Helmet security headers', async () => {
      const res = await request(app).get('/api/v1/health');

      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['strict-transport-security']).toMatch(
        /max-age=31536000/
      );
      expect(res.headers['referrer-policy']).toBe(
        'strict-origin-when-cross-origin'
      );
      expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
      expect(res.headers['content-security-policy']).toBeDefined();
      expect(res.headers['content-security-policy']).toMatch(
        /default-src 'self'/
      );
    });

    it('should set appropriate CORS headers for whitelisted origin', async () => {
      const res = await request(app)
        .get('/api/v1/health')
        .set('Origin', 'http://localhost:3000');

      expect(res.statusCode).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe(
        'http://localhost:3000'
      );
      expect(res.headers['access-control-allow-credentials']).toBe('true');
      expect(res.headers['access-control-expose-headers']).toMatch(
        /X-Request-Id/i
      );
    });
  });

  describe('Request Correlation ID', () => {
    it('should generate and return X-Request-Id header if not provided', async () => {
      const res = await request(app).get('/api/v1/health');

      expect(res.statusCode).toBe(200);
      expect(res.headers['x-request-id']).toBeDefined();
      // UUID v4 regex pattern
      expect(res.headers['x-request-id']).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    });

    it('should preserve and echo back custom client X-Request-Id', async () => {
      const customId = 'client-req-999-custom-id';
      const res = await request(app)
        .get('/api/v1/health')
        .set('X-Request-Id', customId);

      expect(res.statusCode).toBe(200);
      expect(res.headers['x-request-id']).toBe(customId);
    });

    it('should attach X-Request-Id even to 404 responses', async () => {
      const res = await request(app).get('/api/v1/unknown-route');

      expect(res.statusCode).toBe(404);
      expect(res.headers['x-request-id']).toBeDefined();
    });
  });
});
