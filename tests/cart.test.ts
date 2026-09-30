import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../src/app.js';
import { Cart } from '../src/models/Cart.js';
import { Product } from '../src/models/Product.js';
import { User } from '../src/models/User.js';
import { signAccessToken } from '../src/utils/jwt.js';
import { IProduct } from '../src/types/index.js';

let mongoServer: MongoMemoryServer;
let customerToken: string;
let customerId: string;
let testProduct: IProduct;

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
  await Cart.deleteMany({});
  await Product.deleteMany({});
  await User.deleteMany({});

  const customer = await User.create({
    firstName: 'Cart',
    lastName: 'Tester',
    email: 'cart.tester@example.com',
    password: 'Password123!',
    role: 'customer',
  });
  customerId = customer._id.toString();
  customerToken = signAccessToken(customerId, 'customer');

  testProduct = await Product.create({
    name: 'Running Pro Shoes',
    slug: 'running-pro-shoes',
    description: 'High performance running shoes',
    price: 120,
    sku: 'RUN-SHOES-CART-001',
    category: 'Footwear',
    brand: 'JockSport',
    quantity: 10,
    status: 'active',
  });
});

describe('Cart Integration Tests', () => {
  describe('Authentication Check', () => {
    it('should reject unauthenticated cart access with 401', async () => {
      const res = await request(app).get('/api/v1/cart');
      expect(res.statusCode).toBe(401);
    });
  });

  describe('GET /api/v1/cart', () => {
    it('should return an empty cart for a new user', async () => {
      const res = await request(app)
        .get('/api/v1/cart')
        .set('Authorization', `Bearer ${customerToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.cart).toBeDefined();
      expect(res.body.data.cart.items).toEqual([]);
    });
  });

  describe('POST /api/v1/cart/items', () => {
    it('should successfully add an item to the cart', async () => {
      const res = await request(app)
        .post('/api/v1/cart/items')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          productId: testProduct._id.toString(),
          quantity: 2,
          size: '42',
          color: 'Black',
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
      const items = res.body.data.cart.items;
      expect(items).toHaveLength(1);
      expect(items[0].product._id).toBe(testProduct._id.toString());
      expect(items[0].quantity).toBe(2);
      expect(items[0].priceAtAdd).toBe(120);
      expect(items[0].size).toBe('42');
      expect(items[0].color).toBe('Black');
    });

    it('should merge quantities when adding the identical item variant', async () => {
      // First addition
      await request(app)
        .post('/api/v1/cart/items')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          productId: testProduct._id.toString(),
          quantity: 2,
          size: '42',
          color: 'Black',
        });

      // Second addition of same variant
      const res = await request(app)
        .post('/api/v1/cart/items')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          productId: testProduct._id.toString(),
          quantity: 3,
          size: '42',
          color: 'Black',
        });

      expect(res.statusCode).toBe(200);
      const items = res.body.data.cart.items;
      expect(items).toHaveLength(1);
      expect(items[0].quantity).toBe(5);
    });

    it('should treat different variants (e.g. size) as distinct cart items', async () => {
      await request(app)
        .post('/api/v1/cart/items')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          productId: testProduct._id.toString(),
          quantity: 1,
          size: '42',
        });

      const res = await request(app)
        .post('/api/v1/cart/items')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          productId: testProduct._id.toString(),
          quantity: 1,
          size: '43',
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.data.cart.items).toHaveLength(2);
    });

    it('should fail with 400 when quantity exceeds available product stock', async () => {
      const res = await request(app)
        .post('/api/v1/cart/items')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          productId: testProduct._id.toString(),
          quantity: 99,
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(/Insufficient stock/i);
    });

    it('should fail with 400 when product ID has an invalid ObjectId format', async () => {
      const res = await request(app)
        .post('/api/v1/cart/items')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          productId: 'not-a-valid-id',
          quantity: 1,
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(/Invalid product ID format/i);
    });

    it('should fail with 404 when product is not found', async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      const res = await request(app)
        .post('/api/v1/cart/items')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          productId: fakeId,
          quantity: 1,
        });

      expect(res.statusCode).toBe(404);
      expect(res.body.message).toMatch(/Product not found/i);
    });

    it('should fail with 400 when product is inactive', async () => {
      await Product.findByIdAndUpdate(testProduct._id, { status: 'draft' });

      const res = await request(app)
        .post('/api/v1/cart/items')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          productId: testProduct._id.toString(),
          quantity: 1,
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(/Product is no longer available/i);
    });
  });

  describe('PATCH /api/v1/cart/items/:itemId', () => {
    it('should successfully update item quantity', async () => {
      const addRes = await request(app)
        .post('/api/v1/cart/items')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          productId: testProduct._id.toString(),
          quantity: 2,
        });

      const itemId = addRes.body.data.cart.items[0]._id;

      const updateRes = await request(app)
        .patch(`/api/v1/cart/items/${itemId}`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ quantity: 5 });

      expect(updateRes.statusCode).toBe(200);
      expect(updateRes.body.data.cart.items[0].quantity).toBe(5);
    });

    it('should fail with 400 when new quantity exceeds stock', async () => {
      const addRes = await request(app)
        .post('/api/v1/cart/items')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          productId: testProduct._id.toString(),
          quantity: 2,
        });

      const itemId = addRes.body.data.cart.items[0]._id;

      const updateRes = await request(app)
        .patch(`/api/v1/cart/items/${itemId}`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ quantity: 20 }); // stock is 10

      expect(updateRes.statusCode).toBe(400);
      expect(updateRes.body.message).toMatch(/Insufficient stock/i);
    });

    it('should fail with 404 for non-existent item ID in cart', async () => {
      // Ensure cart exists with an item
      await request(app)
        .post('/api/v1/cart/items')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          productId: testProduct._id.toString(),
          quantity: 1,
        });

      const fakeItemId = new mongoose.Types.ObjectId().toString();
      const res = await request(app)
        .patch(`/api/v1/cart/items/${fakeItemId}`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ quantity: 2 });

      expect(res.statusCode).toBe(404);
      expect(res.body.message).toMatch(/Item not found in cart/i);
    });
  });

  describe('DELETE /api/v1/cart/items/:itemId', () => {
    it('should remove specific item from cart', async () => {
      const addRes = await request(app)
        .post('/api/v1/cart/items')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          productId: testProduct._id.toString(),
          quantity: 2,
        });

      const itemId = addRes.body.data.cart.items[0]._id;

      const delRes = await request(app)
        .delete(`/api/v1/cart/items/${itemId}`)
        .set('Authorization', `Bearer ${customerToken}`);

      expect(delRes.statusCode).toBe(200);
      expect(delRes.body.data.cart.items).toHaveLength(0);
    });
  });

  describe('DELETE /api/v1/cart', () => {
    it('should clear the entire cart and return 204', async () => {
      await request(app)
        .post('/api/v1/cart/items')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          productId: testProduct._id.toString(),
          quantity: 2,
        });

      const clearRes = await request(app)
        .delete('/api/v1/cart')
        .set('Authorization', `Bearer ${customerToken}`);

      expect(clearRes.statusCode).toBe(204);

      // Verify cart in DB is empty
      const dbCart = await Cart.findOne({ user: customerId });
      expect(dbCart?.items).toHaveLength(0);
    });
  });

  describe('POST /api/v1/cart/merge', () => {
    it('should merge local guest items into authenticated cart capping at available stock', async () => {
      const secondProduct = await Product.create({
        name: 'Training Tee',
        slug: 'training-tee',
        description: 'Moisture wicking athletic tee',
        price: 35,
        sku: 'TEE-TRAIN-CART-002',
        category: 'Apparel',
        brand: 'JockSport',
        quantity: 4,
        status: 'active',
      });

      // Existing item in user's DB cart
      await request(app)
        .post('/api/v1/cart/items')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          productId: testProduct._id.toString(),
          quantity: 2,
          size: 'M',
        });

      // Guest cart to merge: 1 existing variant + 1 new item with requested quantity > stock (10 > 4)
      const mergeRes = await request(app)
        .post('/api/v1/cart/merge')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          items: [
            {
              productId: testProduct._id.toString(),
              quantity: 3,
              size: 'M',
            },
            {
              productId: secondProduct._id.toString(),
              quantity: 10, // exceeds available stock 4
              size: 'L',
            },
          ],
        });

      expect(mergeRes.statusCode).toBe(200);
      interface PopulatedItem {
        product: { _id: string };
        quantity: number;
      }
      const items = mergeRes.body.data.cart.items as PopulatedItem[];
      expect(items).toHaveLength(2);

      const mergedFirst = items.find(
        (i: PopulatedItem) => i.product._id === testProduct._id.toString()
      );
      expect(mergedFirst?.quantity).toBe(5); // 2 + 3

      const mergedSecond = items.find(
        (i: PopulatedItem) => i.product._id === secondProduct._id.toString()
      );
      expect(mergedSecond?.quantity).toBe(4); // capped at stock 4
    });
  });
});
