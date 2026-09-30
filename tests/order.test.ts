import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../src/app.js';
import { Product } from '../src/models/Product.js';
import { User } from '../src/models/User.js';
import { Order } from '../src/models/Order.js';
import { Cart } from '../src/models/Cart.js';
import { signAccessToken } from '../src/utils/jwt.js';

let mongoServer: MongoMemoryServer;
let customerToken: string;
let customerId: string;
let adminToken: string;
let testProduct: any;

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
  await Order.deleteMany({});
  await Product.deleteMany({});
  await User.deleteMany({});
  await Cart.deleteMany({});

  const customer = await User.create({
    firstName: 'Customer',
    lastName: 'User',
    email: 'customer@example.com',
    password: 'Password123!',
    role: 'customer',
  });
  customerId = customer._id.toString();
  customerToken = signAccessToken(customerId, 'customer');

  const admin = await User.create({
    firstName: 'Admin',
    lastName: 'User',
    email: 'admin@example.com',
    password: 'Password123!',
    role: 'admin',
  });
  adminToken = signAccessToken(admin._id.toString(), 'admin');

  testProduct = await Product.create({
    name: 'Running Pro Shoes',
    description: 'High performance running shoes',
    price: 120,
    sku: 'RUN-SHOES-001',
    quantity: 10,
    category: 'Footwear',
    brand: 'SportBrand',
    status: 'active',
  });
});

const sampleShippingAddress = {
  fullName: 'John Doe',
  phone: '0901234567',
  addressLine1: '123 Sport Avenue',
  city: 'Ho Chi Minh',
  country: 'Vietnam',
};

describe('Order API Integration Tests', () => {
  describe('POST /api/v1/orders', () => {
    it('should fail with 400 when placing order with no items and not logged in', async () => {
      const res = await request(app).post('/api/v1/orders').send({
        shippingAddress: sampleShippingAddress,
      });

      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(/Order must contain at least one item/i);
    });

    it('should allow guest to place an order with explicit items', async () => {
      const res = await request(app)
        .post('/api/v1/orders')
        .send({
          shippingAddress: sampleShippingAddress,
          shippingMethod: 'standard',
          paymentMethod: 'cod',
          contactEmail: 'guest@example.com',
          items: [
            {
              productId: testProduct._id.toString(),
              quantity: 1,
            },
          ],
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.status).toBe('success');
      expect(res.body.data.order.user).toBeUndefined();
    });

    it('should successfully place an order with explicit items and decrement stock', async () => {
      const res = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          shippingAddress: sampleShippingAddress,
          shippingMethod: 'standard',
          paymentMethod: 'cod',
          items: [
            {
              productId: testProduct._id.toString(),
              quantity: 2,
              size: 'M',
              color: 'Black',
            },
          ],
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.status).toBe('success');
      expect(res.body.data.order).toBeDefined();
      expect(res.body.data.order.orderNumber).toMatch(/^GS-/);
      expect(res.body.data.order.subtotal).toBe(240);
      expect(res.body.data.order.shippingFee).toBe(30);
      expect(res.body.data.order.total).toBe(270);
      expect(res.body.data.order.status).toBe('pending');

      // Verify stock decrement
      const updatedProduct = await Product.findById(testProduct._id);
      expect(updatedProduct?.quantity).toBe(8);
    });

    it('should fail when ordering more than available stock', async () => {
      const res = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          shippingAddress: sampleShippingAddress,
          items: [
            {
              productId: testProduct._id.toString(),
              quantity: 20, // exceeds available 10
            },
          ],
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(/Insufficient stock/i);

      // Verify stock untouched
      const updatedProduct = await Product.findById(testProduct._id);
      expect(updatedProduct?.quantity).toBe(10);
    });

    it('should place order from cart and empty cart', async () => {
      // Setup cart
      await Cart.create({
        user: customerId,
        items: [
          {
            product: testProduct._id,
            quantity: 3,
            priceAtAdd: testProduct.price,
          },
        ],
      });

      const res = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          shippingAddress: sampleShippingAddress,
          shippingMethod: 'express',
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.data.order.shippingFee).toBe(50);
      expect(res.body.data.order.subtotal).toBe(360);
      expect(res.body.data.order.total).toBe(410);

      // Verify cart emptied
      const cart = await Cart.findOne({ user: customerId });
      expect(cart?.items.length).toBe(0);

      // Verify stock decremented
      const updatedProduct = await Product.findById(testProduct._id);
      expect(updatedProduct?.quantity).toBe(7);
    });
  });

  describe('GET /api/v1/orders/my', () => {
    it('should return paginated orders for the logged-in customer', async () => {
      // Place an order first
      await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          shippingAddress: sampleShippingAddress,
          items: [{ productId: testProduct._id.toString(), quantity: 1 }],
        });

      const res = await request(app)
        .get('/api/v1/orders/my')
        .set('Authorization', `Bearer ${customerToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.results).toBe(1);
      expect(res.body.data.orders.length).toBe(1);
    });

    it('should fail with 401 when unauthenticated', async () => {
      const res = await request(app).get('/api/v1/orders/my');
      expect(res.statusCode).toBe(401);
    });
  });

  describe('PATCH /api/v1/orders/:orderId/cancel', () => {
    it('should cancel pending order and restore product stock', async () => {
      const orderRes = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          shippingAddress: sampleShippingAddress,
          items: [{ productId: testProduct._id.toString(), quantity: 3 }],
        });

      const orderId = orderRes.body.data.order._id;
      let product = await Product.findById(testProduct._id);
      expect(product?.quantity).toBe(7);

      const cancelRes = await request(app)
        .patch(`/api/v1/orders/${orderId}/cancel`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ reason: 'Changed my mind' });

      expect(cancelRes.statusCode).toBe(200);
      expect(cancelRes.body.data.order.status).toBe('cancelled');
      expect(cancelRes.body.data.order.cancelReason).toBe('Changed my mind');

      // Verify stock restored
      product = await Product.findById(testProduct._id);
      expect(product?.quantity).toBe(10);
    });
  });

  describe('Admin Operations: GET /api/v1/orders and status update', () => {
    it('should allow admin to list all orders and update status', async () => {
      // Customer places order
      const orderRes = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          shippingAddress: sampleShippingAddress,
          items: [{ productId: testProduct._id.toString(), quantity: 1 }],
        });

      const orderId = orderRes.body.data.order._id;

      // Admin gets all orders
      const listRes = await request(app)
        .get('/api/v1/orders')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(listRes.statusCode).toBe(200);
      expect(listRes.body.data.orders.length).toBe(1);

      // Customer forbidden from admin listing
      const forbiddenRes = await request(app)
        .get('/api/v1/orders')
        .set('Authorization', `Bearer ${customerToken}`);
      expect(forbiddenRes.statusCode).toBe(403);

      // Admin updates status to shipped
      const statusRes = await request(app)
        .patch(`/api/v1/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'shipped' });

      expect(statusRes.statusCode).toBe(200);
      expect(statusRes.body.data.order.status).toBe('shipped');
      expect(statusRes.body.data.order.shippedAt).toBeDefined();
    });
  });
});
