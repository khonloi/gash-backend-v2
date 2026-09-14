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
});
