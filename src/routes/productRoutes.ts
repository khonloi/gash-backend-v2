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
import { protect, restrictTo } from '../middlewares/auth.js';
import {
  createProductSchema,
  updateProductSchema,
  updateStockSchema,
  productQuerySchema,
} from '../validations/productValidation.js';
import { idParamSchema } from '../validations/commonValidation.js';

const router: Router = Router();

// Public / special listing routes
router.get('/stats', getProductStats);
router.get('/featured', getFeaturedProducts);
router.get('/slug/:slug', getProductBySlug);

// Collection routes
router
  .route('/')
  .get(validate(productQuerySchema, 'query'), getAllProducts)
  .post(
    protect,
    restrictTo('admin', 'seller'),
    validate(createProductSchema, 'body'),
    createProduct
  );

// Single item routes
router
  .route('/:id')
  .get(validate(idParamSchema, 'params'), getProduct)
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
