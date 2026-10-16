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
import { itemIdParamSchema } from '../validations/commonValidation.js';

const router: Router = Router();

// All cart routes require auth
router.use(protect);

router.route('/').get(getCart).delete(clearCart);

router.route('/items').post(validate(addToCartSchema, 'body'), addToCart);

router
  .route('/items/:itemId')
  .patch(
    validate(itemIdParamSchema, 'params'),
    validate(updateCartItemSchema, 'body'),
    updateCartItem
  )
  .delete(validate(itemIdParamSchema, 'params'), removeCartItem);

router.post('/merge', validate(mergeCartSchema, 'body'), mergeCart);

export default router;
