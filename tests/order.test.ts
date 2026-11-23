import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../src/app.js';
import { Product } from '../src/models/Product.js';
import { User } from '../src/models/User.js';
import { Order } from '../src/models/Order.js';
import { Cart } from '../src/models/Cart.js';
import { signAccessToken } from '../src/utils/jwt.js';
import { IProduct } from '../src/types/index.js';

let mongoServer: MongoMemoryServer;
let customerToken: string;
let customerId: string;
let adminToken: string;
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

    it('should not clear cart when placing order with explicit items and should honor idempotencyKey', async () => {
      await Cart.create({
        user: customerId,
        items: [
          {
            product: testProduct._id,
            quantity: 1,
            priceAtAdd: testProduct.price,
          },
        ],
      });

      const key = 'checkout-idem-key-123';
      const payload = {
        shippingAddress: sampleShippingAddress,
        idempotencyKey: key,
        items: [{ productId: testProduct._id.toString(), quantity: 2 }],
      };

      const res1 = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .send(payload);
      expect(res1.statusCode).toBe(201);

      // Cart remains intact because explicit items were provided
      const cartAfter = await Cart.findOne({ user: customerId });
      expect(cartAfter?.items).toHaveLength(1);

      // Duplicate submission with same idempotencyKey returns the existing order without double-decrementing stock
      const res2 = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .send(payload);
      expect(res2.statusCode).toBe(201);
      expect(res2.body.data.order._id).toBe(res1.body.data.order._id);
      const updatedProduct = await Product.findById(testProduct._id);
      expect(updatedProduct?.quantity).toBe(8);
    });

    it('should decrement and restore per-SKU variant stock and price on checkout and cancel', async () => {
      const variantProduct = await Product.create({
        name: 'Variant Sneakers',
        description: 'Variant test',
        price: 100,
        sku: 'SNK-BASE',
        quantity: 6,
        category: 'Footwear',
        status: 'active',
        variants: [
          {
            sku: 'SNK-42-WHT',
            size: '42',
            color: 'White',
            priceModifier: 20,
            stock: 3,
          },
          {
            sku: 'SNK-43-BLK',
            size: '43',
            color: 'Black',
            price: 140,
            stock: 3,
          },
        ],
      });

      const orderRes = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          shippingAddress: sampleShippingAddress,
          items: [
            {
              productId: variantProduct._id.toString(),
              quantity: 2,
              size: '42',
              color: 'White',
            },
          ],
        });

      expect(orderRes.statusCode).toBe(201);
      expect(orderRes.body.data.order.items[0].sku).toBe('SNK-42-WHT');
      expect(orderRes.body.data.order.items[0].price).toBe(120);
      expect(orderRes.body.data.order.subtotal).toBe(240);

      let refreshed = await Product.findById(variantProduct._id);
      expect(refreshed?.quantity).toBe(4);
      expect(refreshed?.variants[0].stock).toBe(1);
      expect(refreshed?.variants[1].stock).toBe(3);

      // Cancel restores both variant stock and total quantity
      const cancelRes = await request(app)
        .patch(`/api/v1/orders/${orderRes.body.data.order._id}/cancel`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ reason: 'Wrong size' });
      expect(cancelRes.statusCode).toBe(200);

      refreshed = await Product.findById(variantProduct._id);
      expect(refreshed?.quantity).toBe(6);
      expect(refreshed?.variants[0].stock).toBe(3);
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

    it('should not allow BOLA override via ?user=<victimId> and should validate query params', async () => {
      const otherUser = await User.create({
        firstName: 'Victim',
        lastName: 'User',
        email: 'victim@example.com',
        password: 'Password123!',
      });
      const otherToken = signAccessToken(otherUser._id.toString(), 'customer');

      await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${otherToken}`)
        .send({
          shippingAddress: sampleShippingAddress,
          items: [{ productId: testProduct._id.toString(), quantity: 1 }],
        });

      const bolaRes = await request(app)
        .get(`/api/v1/orders/my?user=${otherUser._id.toString()}`)
        .set('Authorization', `Bearer ${customerToken}`);

      expect(bolaRes.statusCode).toBe(200);
      expect(bolaRes.body.results).toBe(0);
      expect(bolaRes.body.data.orders).toHaveLength(0);

      const invalidQueryRes = await request(app)
        .get('/api/v1/orders/my?status=invalid_status')
        .set('Authorization', `Bearer ${customerToken}`);
      expect(invalidQueryRes.statusCode).toBe(400);
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

    it('should fail with 400 when attempting to cancel an already cancelled order', async () => {
      const orderRes = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          shippingAddress: sampleShippingAddress,
          items: [{ productId: testProduct._id.toString(), quantity: 1 }],
        });

      const orderId = orderRes.body.data.order._id;

      // Cancel once
      await request(app)
        .patch(`/api/v1/orders/${orderId}/cancel`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({});

      // Attempt second cancellation
      const secondCancelRes = await request(app)
        .patch(`/api/v1/orders/${orderId}/cancel`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({});

      expect(secondCancelRes.statusCode).toBe(400);
      expect(secondCancelRes.body.message).toMatch(/already cancelled/i);
    });

    it('should fail with 400 when attempting to cancel a delivered order', async () => {
      const orderRes = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          shippingAddress: sampleShippingAddress,
          items: [{ productId: testProduct._id.toString(), quantity: 1 }],
        });

      const orderId = orderRes.body.data.order._id;

      // Admin advances status to shipped, then delivered
      await request(app)
        .patch(`/api/v1/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'shipped' });

      await request(app)
        .patch(`/api/v1/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'delivered' });

      // Customer attempts to cancel delivered order
      const cancelRes = await request(app)
        .patch(`/api/v1/orders/${orderId}/cancel`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({});

      expect(cancelRes.statusCode).toBe(400);
      expect(cancelRes.body.message).toMatch(/cannot be cancelled/i);
    });

    it('should fail with 400 when customer attempts to cancel an order already in shipped status', async () => {
      const orderRes = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          shippingAddress: sampleShippingAddress,
          items: [{ productId: testProduct._id.toString(), quantity: 1 }],
        });

      const orderId = orderRes.body.data.order._id;

      // Admin advances status to shipped
      await request(app)
        .patch(`/api/v1/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'shipped' });

      // Customer attempts to cancel shipped order
      const cancelRes = await request(app)
        .patch(`/api/v1/orders/${orderId}/cancel`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({});

      expect(cancelRes.statusCode).toBe(400);
      expect(cancelRes.body.message).toMatch(
        /cannot be cancelled by customer/i
      );
    });

    it('should fail with 403 when customer tries to cancel another user order', async () => {
      // Create second customer
      const secondUser = await User.create({
        firstName: 'Other',
        lastName: 'Person',
        email: 'other@example.com',
        password: 'Password123!',
        role: 'customer',
      });
      const secondToken = signAccessToken(
        secondUser._id.toString(),
        'customer'
      );

      // First customer places order
      const orderRes = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          shippingAddress: sampleShippingAddress,
          items: [{ productId: testProduct._id.toString(), quantity: 1 }],
        });

      const orderId = orderRes.body.data.order._id;

      // Second customer attempts to cancel first customer's order
      const cancelRes = await request(app)
        .patch(`/api/v1/orders/${orderId}/cancel`)
        .set('Authorization', `Bearer ${secondToken}`)
        .send({});

      expect(cancelRes.statusCode).toBe(403);
      expect(cancelRes.body.message).toMatch(/not have permission/i);
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

      // Admin keyword search works via text index without 500
      const orderNum = listRes.body.data.orders[0].orderNumber;
      const searchRes = await request(app)
        .get(`/api/v1/orders?keyword=${orderNum}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(searchRes.statusCode).toBe(200);
      expect(searchRes.body.results).toBe(1);

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

    it('should reject illegal status transitions and terminal state changes', async () => {
      // Customer places order
      const orderRes = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          shippingAddress: sampleShippingAddress,
          items: [{ productId: testProduct._id.toString(), quantity: 1 }],
        });

      const orderId = orderRes.body.data.order._id;

      // Advance: pending -> shipped -> delivered
      await request(app)
        .patch(`/api/v1/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'shipped' });

      const deliveredRes = await request(app)
        .patch(`/api/v1/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'delivered' });

      expect(deliveredRes.statusCode).toBe(200);
      expect(deliveredRes.body.data.order.status).toBe('delivered');
      expect(deliveredRes.body.data.order.deliveredAt).toBeDefined();
      expect(deliveredRes.body.data.order.paymentStatus).toBe('paid'); // COD auto-paid on delivery

      // Illegal transition: delivered -> pending
      const backwardRes = await request(app)
        .patch(`/api/v1/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'pending' });

      expect(backwardRes.statusCode).toBe(400);
      expect(backwardRes.body.message).toMatch(
        /Cannot transition order status/i
      );

      // Delivered -> refunded syncs paymentStatus to refunded, and refunded cannot be cancelled
      const refundRes = await request(app)
        .patch(`/api/v1/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'refunded' });
      expect(refundRes.statusCode).toBe(200);
      expect(refundRes.body.data.order.paymentStatus).toBe('refunded');
      expect(refundRes.body.data.order.refundedAt).toBeDefined();

      const cancelRefundedRes = await request(app)
        .patch(`/api/v1/orders/${orderId}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});
      expect(cancelRefundedRes.statusCode).toBe(400);
      expect(cancelRefundedRes.body.message).toMatch(/Refunded orders/i);
    });

    it('should support order lookup by orderNumber, PATCH /payment transitions, and admin status cancellation', async () => {
      const orderRes = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          shippingAddress: sampleShippingAddress,
          paymentMethod: 'credit_card',
          items: [{ productId: testProduct._id.toString(), quantity: 2 }],
        });

      const orderId = orderRes.body.data.order._id;
      const orderNum = orderRes.body.data.order.orderNumber;

      // GET single order by orderNumber (hits getOrder + non-ObjectId path)
      const byNumRes = await request(app)
        .get(`/api/v1/orders/${orderNum}`)
        .set('Authorization', `Bearer ${customerToken}`);
      expect(byNumRes.statusCode).toBe(200);
      expect(byNumRes.body.data.order._id).toBe(orderId);

      // Missing orderNumber returns 404
      const missingRes = await request(app)
        .get('/api/v1/orders/GS-000000-NONE')
        .set('Authorization', `Bearer ${customerToken}`);
      expect(missingRes.statusCode).toBe(404);

      // Admin updates paymentStatus pending -> paid (auto-confirms pending order)
      const payRes = await request(app)
        .patch(`/api/v1/orders/${orderId}/payment`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ paymentStatus: 'paid' });
      expect(payRes.statusCode).toBe(200);
      expect(payRes.body.data.order.paymentStatus).toBe('paid');
      expect(payRes.body.data.order.status).toBe('confirmed');

      // Invalid payment transition paid -> pending returns 400
      const invalidPayRes = await request(app)
        .patch(`/api/v1/orders/${orderId}/payment`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ paymentStatus: 'pending' });
      expect(invalidPayRes.statusCode).toBe(400);

      // Admin transitions status confirmed -> cancelled (restores stock + refunds payment)
      const cancelStatusRes = await request(app)
        .patch(`/api/v1/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'cancelled' });
      expect(cancelStatusRes.statusCode).toBe(200);
      expect(cancelStatusRes.body.data.order.status).toBe('cancelled');
      expect(cancelStatusRes.body.data.order.paymentStatus).toBe('refunded');

      // Payment update on cancelled order returns 400
      const postCancelPayRes = await request(app)
        .patch(`/api/v1/orders/${orderId}/payment`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ paymentStatus: 'paid' });
      expect(postCancelPayRes.statusCode).toBe(400);
    });
  });
});
