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
  myOrderQuerySchema,
  adminOrderQuerySchema,
} from '../validations/orderValidation.js';
import { orderIdParamSchema } from '../validations/commonValidation.js';

const router: Router = Router();

// Customer specific orders route (must be before /:orderId)
router.get('/my', protect, validate(myOrderQuerySchema, 'query'), getMyOrders);

// Collection routes
router
  .route('/')
  .post(optionalAuth, validate(createOrderSchema, 'body'), createOrder)
  .get(
    protect,
    restrictTo('admin'),
    validate(adminOrderQuerySchema, 'query'),
    getAllOrders
  );

// Single order routes
router
  .route('/:orderId')
  .get(protect, validate(orderIdParamSchema, 'params'), getOrder);

router.patch(
  '/:orderId/cancel',
  protect,
  validate(orderIdParamSchema, 'params'),
  validate(cancelOrderSchema, 'body'),
  cancelOrder
);

// Admin-only management routes
router.patch(
  '/:orderId/status',
  protect,
  restrictTo('admin'),
  validate(orderIdParamSchema, 'params'),
  validate(updateOrderStatusSchema, 'body'),
  updateOrderStatus
);

router.patch(
  '/:orderId/payment',
  protect,
  restrictTo('admin'),
  validate(orderIdParamSchema, 'params'),
  validate(updatePaymentStatusSchema, 'body'),
  updatePaymentStatus
);

export default router;
