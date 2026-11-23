import { Router } from 'express';
import {
  createProduct,
  getAllProducts,
  getProduct,
  getProductBySlug,
  updateProduct,
  deleteProduct,
  updateStock,
  getProductStats,
  getFeaturedProducts,
} from '../controllers/productController.js';
import { validate } from '../middlewares/validate.js';
import { optionalAuth, protect, restrictTo } from '../middlewares/auth.js';
import {
  createProductSchema,
  updateProductSchema,
  updateStockSchema,
  productQuerySchema,
  featuredProductsQuerySchema,
} from '../validations/productValidation.js';
import { idParamSchema } from '../validations/commonValidation.js';

const router: Router = Router();

// Protected stats & public featured/slug routes
router.get('/stats', protect, restrictTo('admin', 'seller'), getProductStats);
router.get(
  '/featured',
  validate(featuredProductsQuerySchema, 'query'),
  getFeaturedProducts
);
router.get('/slug/:slug', optionalAuth, getProductBySlug);

// Collection routes
router
  .route('/')
  .get(optionalAuth, validate(productQuerySchema, 'query'), getAllProducts)
  .post(
    protect,
    restrictTo('admin', 'seller'),
    validate(createProductSchema, 'body'),
    createProduct
  );

// Single item routes
router
  .route('/:id')
  .get(optionalAuth, validate(idParamSchema, 'params'), getProduct)
  .patch(
    protect,
    restrictTo('admin', 'seller'),
    validate(idParamSchema, 'params'),
    validate(updateProductSchema, 'body'),
    updateProduct
  )
  .delete(
    protect,
    restrictTo('admin'),
    validate(idParamSchema, 'params'),
    deleteProduct
  );

// Dedicated stock adjustment
router
  .route('/:id/stock')
  .patch(
    protect,
    restrictTo('admin', 'seller'),
    validate(idParamSchema, 'params'),
    validate(updateStockSchema, 'body'),
    updateStock
  );

export default router;
