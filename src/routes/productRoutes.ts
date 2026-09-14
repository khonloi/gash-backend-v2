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
import {
  createProductSchema,
  updateProductSchema,
  updateStockSchema,
  productQuerySchema,
} from '../validations/productValidation.js';

const router: Router = Router();

// Public / special listing routes
router.get('/stats', getProductStats);
router.get('/featured', getFeaturedProducts);
router.get('/slug/:slug', getProductBySlug);

// Collection routes
router
  .route('/')
  .get(validate(productQuerySchema, 'query'), getAllProducts)
  // TODO: Add auth middleware (protect, restrictTo('admin', 'seller'))
  .post(validate(createProductSchema, 'body'), createProduct);

// Single item routes
router
  .route('/:id')
  .get(getProduct)
  // TODO: Add auth middleware (protect, restrictTo('admin', 'seller'))
  .patch(validate(updateProductSchema, 'body'), updateProduct)
  // TODO: Add auth middleware (protect, restrictTo('admin'))
  .delete(deleteProduct);

// Dedicated stock adjustment
router
  .route('/:id/stock')
  // TODO: Add auth middleware (protect, restrictTo('admin', 'seller'))
  .patch(validate(updateStockSchema, 'body'), updateStock);

export default router;
