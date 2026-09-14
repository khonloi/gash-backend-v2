import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../src/app.js';
import { Product } from '../src/models/Product.js';
import { User } from '../src/models/User.js';
import { signAccessToken } from '../src/utils/jwt.js';

let mongoServer: MongoMemoryServer;
let adminToken: string;

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
  await Product.deleteMany({});
  await User.deleteMany({});

  const admin = await User.create({
    firstName: 'Admin',
    lastName: 'User',
    email: 'admin@example.com',
    password: 'Password123!',
    role: 'admin',
  });
  adminToken = signAccessToken(admin._id.toString(), 'admin');
});

const sampleProductData = {
  name: 'Wireless Noise Canceling Headphones',
  description: 'High fidelity audio headphones with active noise cancellation.',
  price: 199.99,
  compareAtPrice: 249.99,
  sku: 'TECH-HEADPHONE-001',
  quantity: 50,
  lowStockThreshold: 10,
  category: 'Electronics',
  subcategory: 'Audio',
  brand: 'SoundPro',
  tags: ['wireless', 'bluetooth', 'audio'],
  status: 'active' as const,
  isFeatured: true,
};

describe('Product API Integration Tests', () => {
  describe('POST /api/v1/products', () => {
    it('should fail with 401 when user is not authenticated', async () => {
      const res = await request(app)
        .post('/api/v1/products')
        .send(sampleProductData);

      expect(res.statusCode).toBe(401);
      expect(res.body.status).toBe('fail');
    });

    it('should fail with 403 when user is not admin or seller', async () => {
      const customer = await User.create({
        firstName: 'Customer',
        lastName: 'User',
        email: 'customer@example.com',
        password: 'Password123!',
        role: 'customer',
      });
      const customerToken = signAccessToken(
        customer._id.toString(),
        'customer'
      );

      const res = await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${customerToken}`)
        .send(sampleProductData);

      expect(res.statusCode).toBe(403);
      expect(res.body.status).toBe('fail');
    });

    it('should create a product and generate a slug automatically', async () => {
      const res = await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(sampleProductData);

      expect(res.statusCode).toBe(201);
      expect(res.body.status).toBe('success');
      expect(res.body.data.product).toHaveProperty('_id');
      expect(res.body.data.product.name).toBe(sampleProductData.name);
      expect(res.body.data.product.slug).toBe(
        'wireless-noise-canceling-headphones'
      );
      expect(res.body.data.product.sku).toBe('TECH-HEADPHONE-001');
      expect(res.body.data.product.isOnSale).toBe(true);
      expect(res.body.data.product.discountPercentage).toBe(20);
    });

    it('should fail with 400 when required fields are missing', async () => {
      const res = await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Incomplete Product',
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.status).toBe('fail');
      expect(res.body.message).toMatch(/Validation error/i);
    });

    it('should fail with 400 when creating a product with duplicate SKU', async () => {
      await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(sampleProductData);

      const res = await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          ...sampleProductData,
          name: 'Another Headphone',
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.status).toBe('fail');
      expect(res.body.message).toMatch(/already exists/i);
    });
  });

  describe('GET /api/v1/products', () => {
    beforeEach(async () => {
      await Product.create([
        {
          ...sampleProductData,
          name: 'Item A',
          sku: 'SKU-001',
          price: 50,
          compareAtPrice: 80,
          category: 'Books',
        },
        {
          ...sampleProductData,
          name: 'Item B',
          sku: 'SKU-002',
          price: 150,
          compareAtPrice: 200,
          category: 'Electronics',
        },
        {
          ...sampleProductData,
          name: 'Item C',
          sku: 'SKU-003',
          price: 250,
          compareAtPrice: 300,
          category: 'Electronics',
        },
      ]);
    });

    it('should return all products with pagination metadata', async () => {
      const res = await request(app).get('/api/v1/products');

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.results).toBe(3);
      expect(res.body.pagination).toEqual({
        page: 1,
        limit: 10,
        totalPages: 1,
        totalResults: 3,
      });
      expect(res.body.data.products.length).toBe(3);
    });

    it('should filter products by category', async () => {
      const res = await request(app).get('/api/v1/products?category=Books');

      expect(res.statusCode).toBe(200);
      expect(res.body.results).toBe(1);
      expect(res.body.data.products[0].name).toBe('Item A');
    });

    it('should filter products by price range', async () => {
      const res = await request(app).get(
        '/api/v1/products?minPrice=100&maxPrice=200'
      );

      expect(res.statusCode).toBe(200);
      expect(res.body.results).toBe(1);
      expect(res.body.data.products[0].name).toBe('Item B');
    });

    it('should sort products by price descending', async () => {
      const res = await request(app).get('/api/v1/products?sort=-price');

      expect(res.statusCode).toBe(200);
      expect(res.body.data.products[0].name).toBe('Item C');
      expect(res.body.data.products[2].name).toBe('Item A');
    });

    it('should select specific fields', async () => {
      const res = await request(app).get('/api/v1/products?fields=name,price');

      expect(res.statusCode).toBe(200);
      expect(res.body.data.products[0]).toHaveProperty('name');
      expect(res.body.data.products[0]).toHaveProperty('price');
      expect(res.body.data.products[0]).not.toHaveProperty('description');
    });
  });

  describe('GET /api/v1/products/:id', () => {
    it('should return product by valid ID', async () => {
      const created = await Product.create(sampleProductData);

      const res = await request(app).get(`/api/v1/products/${created._id}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.product.name).toBe(sampleProductData.name);
    });

    it('should return 404 for non-existent ObjectId', async () => {
      const nonExistentId = new mongoose.Types.ObjectId();
      const res = await request(app).get(`/api/v1/products/${nonExistentId}`);

      expect(res.statusCode).toBe(404);
      expect(res.body.status).toBe('fail');
    });

    it('should return 400 for invalid ObjectId format', async () => {
      const res = await request(app).get('/api/v1/products/invalid-id-123');

      expect(res.statusCode).toBe(400);
      expect(res.body.status).toBe('fail');
    });
  });

  describe('GET /api/v1/products/slug/:slug', () => {
    it('should return product by slug', async () => {
      const created = await Product.create(sampleProductData);

      const res = await request(app).get(
        `/api/v1/products/slug/${created.slug}`
      );

      expect(res.statusCode).toBe(200);
      expect(res.body.data.product._id.toString()).toBe(created._id.toString());
    });

    it('should return 404 for unknown slug', async () => {
      const res = await request(app).get(
        '/api/v1/products/slug/unknown-product-slug'
      );

      expect(res.statusCode).toBe(404);
      expect(res.body.status).toBe('fail');
    });
  });

  describe('PATCH /api/v1/products/:id', () => {
    it('should update product and regenerate slug when name changes', async () => {
      const created = await Product.create(sampleProductData);

      const res = await request(app)
        .patch(`/api/v1/products/${created._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Premium Bluetooth Headphones', price: 219.99 });

      expect(res.statusCode).toBe(200);
      expect(res.body.data.product.name).toBe('Premium Bluetooth Headphones');
      expect(res.body.data.product.slug).toBe('premium-bluetooth-headphones');
      expect(res.body.data.product.price).toBe(219.99);
    });
  });

  describe('PATCH /api/v1/products/:id/stock', () => {
    it('should atomically increment stock', async () => {
      const created = await Product.create({
        ...sampleProductData,
        quantity: 10,
      });

      const res = await request(app)
        .patch(`/api/v1/products/${created._id}/stock`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ quantity: 15, operation: 'increment' });

      expect(res.statusCode).toBe(200);
      expect(res.body.data.product.quantity).toBe(25);
    });

    it('should atomically decrement stock', async () => {
      const created = await Product.create({
        ...sampleProductData,
        quantity: 10,
      });

      const res = await request(app)
        .patch(`/api/v1/products/${created._id}/stock`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ quantity: 4, operation: 'decrement' });

      expect(res.statusCode).toBe(200);
      expect(res.body.data.product.quantity).toBe(6);
    });

    it('should fail with 400 when decrementing more than available stock', async () => {
      const created = await Product.create({
        ...sampleProductData,
        quantity: 5,
      });

      const res = await request(app)
        .patch(`/api/v1/products/${created._id}/stock`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ quantity: 10, operation: 'decrement' });

      expect(res.statusCode).toBe(400);
      expect(res.body.status).toBe('fail');
      expect(res.body.message).toMatch(/insufficient stock/i);
    });
  });

  describe('DELETE /api/v1/products/:id', () => {
    it('should delete product and return 204', async () => {
      const created = await Product.create(sampleProductData);

      const res = await request(app)
        .delete(`/api/v1/products/${created._id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.statusCode).toBe(204);

      const check = await Product.findById(created._id);
      expect(check).toBeNull();
    });
  });

  describe('GET /api/v1/products/stats', () => {
    it('should calculate category aggregation statistics', async () => {
      await Product.create([
        {
          ...sampleProductData,
          name: 'Stats Product 1',
          sku: 'S1',
          price: 100,
          compareAtPrice: 150,
          category: 'Electronics',
        },
        {
          ...sampleProductData,
          name: 'Stats Product 2',
          sku: 'S2',
          price: 200,
          compareAtPrice: 250,
          category: 'Electronics',
        },
        {
          ...sampleProductData,
          name: 'Stats Product 3',
          sku: 'S3',
          price: 50,
          compareAtPrice: 80,
          category: 'Accessories',
        },
      ]);

      const res = await request(app).get('/api/v1/products/stats');

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
      expect(Array.isArray(res.body.data.stats)).toBe(true);
      expect(res.body.data.stats.length).toBe(2);

      const electronicsStat = res.body.data.stats.find(
        (s: any) => s.category === 'Electronics'
      );
      expect(electronicsStat).toBeDefined();
      expect(electronicsStat.numProducts).toBe(2);
      expect(electronicsStat.avgPrice).toBe(150);
    });
  });

  describe('GET /api/v1/products/featured', () => {
    it('should return only active featured products', async () => {
      await Product.create([
        {
          ...sampleProductData,
          name: 'Featured Product 1',
          sku: 'F1',
          isFeatured: true,
          status: 'active',
        },
        {
          ...sampleProductData,
          name: 'Featured Product 2',
          sku: 'F2',
          isFeatured: false,
          status: 'active',
        },
        {
          ...sampleProductData,
          name: 'Featured Product 3',
          sku: 'F3',
          isFeatured: true,
          status: 'draft',
        },
      ]);

      const res = await request(app).get('/api/v1/products/featured');

      expect(res.statusCode).toBe(200);
      expect(res.body.results).toBe(1);
      expect(res.body.data.products[0].sku).toBe('F1');
    });
  });
});
