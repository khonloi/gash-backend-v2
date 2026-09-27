import { Router } from 'express';
import {
  getCart,
  addToCart,
  updateCartItem,
  removeCartItem,
  clearCart,
  mergeCart,
} from '../controllers/cartController.js';
import { validate } from '../middlewares/validate.js';
import { protect } from '../middlewares/auth.js';
import {
  addToCartSchema,
  updateCartItemSchema,
  mergeCartSchema,
} from '../validations/cartValidation.js';

const router: Router = Router();

// All cart routes require auth
router.use(protect);

router.route('/').get(getCart).delete(clearCart);

router.route('/items').post(validate(addToCartSchema, 'body'), addToCart);

router
  .route('/items/:itemId')
  .patch(validate(updateCartItemSchema, 'body'), updateCartItem)
  .delete(removeCartItem);

router.post('/merge', validate(mergeCartSchema, 'body'), mergeCart);

export default router;
