import { Router } from 'express';
import {
  createOrder,
  getMyOrders,
  getOrder,
  cancelOrder,
  getAllOrders,
  updateOrderStatus,
  updatePaymentStatus,
} from '../controllers/orderController.js';
import { validate } from '../middlewares/validate.js';
import { protect, restrictTo, optionalAuth } from '../middlewares/auth.js';
import {
  createOrderSchema,
  updateOrderStatusSchema,
  updatePaymentStatusSchema,
  cancelOrderSchema,
} from '../validations/orderValidation.js';

const router: Router = Router();

// Customer specific orders route (must be before /:orderId)
router.get('/my', protect, getMyOrders);

// Collection routes
router
  .route('/')
  .post(optionalAuth, validate(createOrderSchema, 'body'), createOrder)
  .get(protect, restrictTo('admin'), getAllOrders);

// Single order routes
router.route('/:orderId').get(protect, getOrder);

router.patch(
  '/:orderId/cancel',
  protect,
  validate(cancelOrderSchema, 'body'),
  cancelOrder
);

// Admin-only management routes
router.patch(
  '/:orderId/status',
  protect,
  restrictTo('admin'),
  validate(updateOrderStatusSchema, 'body'),
  updateOrderStatus
);

router.patch(
  '/:orderId/payment',
  protect,
  restrictTo('admin'),
  validate(updatePaymentStatusSchema, 'body'),
  updatePaymentStatus
);

export default router;
