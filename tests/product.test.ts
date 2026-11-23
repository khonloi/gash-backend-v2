import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../src/app.js';
import { Product } from '../src/models/Product.js';
import { User } from '../src/models/User.js';
import { signAccessToken } from '../src/utils/jwt.js';
import { IProductCategoryStats } from '../src/types/index.js';

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

    it('should automatically append numeric suffix to slug on duplicate name', async () => {
      const res1 = await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(sampleProductData);

      expect(res1.statusCode).toBe(201);
      expect(res1.body.data.product.slug).toBe(
        'wireless-noise-canceling-headphones'
      );

      const res2 = await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          ...sampleProductData,
          sku: 'TECH-HEADPHONE-002',
        });

      expect(res2.statusCode).toBe(201);
      expect(res2.body.data.product.slug).toBe(
        'wireless-noise-canceling-headphones-1'
      );
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

    it('should create product with per-SKU variants and sync total quantity', async () => {
      const res = await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          ...sampleProductData,
          sku: 'SHIRT-BASE-001',
          price: 50,
          compareAtPrice: 70,
          variants: [
            { sku: 'SHIRT-S-BLK', size: 'S', color: 'Black', stock: 5 },
            {
              sku: 'SHIRT-M-BLK',
              size: 'M',
              color: 'Black',
              priceModifier: 5,
              stock: 8,
            },
          ],
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.data.product.quantity).toBe(13);
      expect(res.body.data.product.variants).toHaveLength(2);
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

    it('should parse bracket operators (price[gte]), respect isFeatured=false, and block $where injection', async () => {
      await Product.create({
        ...sampleProductData,
        name: 'Non Featured Item',
        sku: 'SKU-NON-FEAT',
        price: 75,
        isFeatured: false,
      });

      const bracketRes = await request(app).get(
        '/api/v1/products?price[gte]=100&price[lte]=200'
      );
      expect(bracketRes.statusCode).toBe(200);
      expect(bracketRes.body.results).toBe(1);
      expect(bracketRes.body.data.products[0].name).toBe('Item B');

      const falseFeatRes = await request(app).get(
        '/api/v1/products?isFeatured=false'
      );
      expect(falseFeatRes.statusCode).toBe(200);
      expect(falseFeatRes.body.results).toBe(1);
      expect(falseFeatRes.body.data.products[0].sku).toBe('SKU-NON-FEAT');

      const nosqlRes = await request(app).get(
        '/api/v1/products?$where=sleep(5000)&category=Books'
      );
      expect(nosqlRes.statusCode).toBe(200);
      expect(nosqlRes.body.results).toBe(1);
      expect(nosqlRes.body.data.products[0].name).toBe('Item A');
    });

    it('should hide costPrice and draft products from public callers', async () => {
      await Product.create({
        ...sampleProductData,
        name: 'Draft Secret Product',
        sku: 'SKU-DRAFT-1',
        costPrice: 42.5,
        status: 'draft',
      });
      await Product.updateOne(
        { sku: 'SKU-001' },
        { $set: { costPrice: 12.34 } }
      );

      const listRes = await request(app).get('/api/v1/products');
      expect(listRes.statusCode).toBe(200);
      expect(listRes.body.results).toBe(3); // excludes draft
      for (const p of listRes.body.data.products) {
        expect(p.costPrice).toBeUndefined();
      }
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

    it('should enforce seller ownership on product updates and stock adjustments', async () => {
      const sellerA = await User.create({
        firstName: 'Seller',
        lastName: 'A',
        email: 'sellera@example.com',
        password: 'Password123!',
        role: 'seller',
      });
      const sellerB = await User.create({
        firstName: 'Seller',
        lastName: 'B',
        email: 'sellerb@example.com',
        password: 'Password123!',
        role: 'seller',
      });
      const tokenA = signAccessToken(sellerA._id.toString(), 'seller');
      const tokenB = signAccessToken(sellerB._id.toString(), 'seller');

      const createRes = await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${tokenA}`)
        .send(sampleProductData);
      expect(createRes.statusCode).toBe(201);
      const productId = createRes.body.data.product._id;

      // Seller B cannot update Seller A's product
      const forbidUpdate = await request(app)
        .patch(`/api/v1/products/${productId}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ price: 1 });
      expect(forbidUpdate.statusCode).toBe(403);

      // Seller B cannot adjust Seller A's stock
      const forbidStock = await request(app)
        .patch(`/api/v1/products/${productId}/stock`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ quantity: 5, operation: 'decrement' });
      expect(forbidStock.statusCode).toBe(403);

      // Seller A can update their own product
      const ownerUpdate = await request(app)
        .patch(`/api/v1/products/${productId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ price: 179.99 });
      expect(ownerUpdate.statusCode).toBe(200);

      // Cross-field compareAtPrice validation works on PATCH
      const validCompareUpdate = await request(app)
        .patch(`/api/v1/products/${productId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ compareAtPrice: 220 });
      expect(validCompareUpdate.statusCode).toBe(200);

      const invalidPriceUpdate = await request(app)
        .patch(`/api/v1/products/${productId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ price: 250 });
      expect(invalidPriceUpdate.statusCode).toBe(400);
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
    it('should forbid unauthenticated access and allow admin/seller stats calculation', async () => {
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

      const unauthRes = await request(app).get('/api/v1/products/stats');
      expect(unauthRes.statusCode).toBe(401);

      const res = await request(app)
        .get('/api/v1/products/stats')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
      expect(Array.isArray(res.body.data.stats)).toBe(true);
      expect(res.body.data.stats.length).toBe(2);

      const stats = res.body.data.stats as IProductCategoryStats[];
      const electronicsStat = stats.find(
        (s: IProductCategoryStats) => s.category === 'Electronics'
      );
      expect(electronicsStat).toBeDefined();
      expect(electronicsStat?.numProducts).toBe(2);
      expect(electronicsStat?.avgPrice).toBe(150);
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
