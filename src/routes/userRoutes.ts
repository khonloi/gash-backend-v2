import { Router } from 'express';
import {
  getMe,
  updateMe,
  changePassword,
  deactivateMe,
  getAddresses,
  addAddress,
  updateAddress,
  removeAddress,
  getAllUsers,
  getUser,
  updateUserRole,
  deleteUser,
} from '../controllers/userController.js';
import { validate } from '../middlewares/validate.js';
import { protect, restrictTo } from '../middlewares/auth.js';
import {
  updateMeSchema,
  addressSchema,
  updateAddressSchema,
  updateUserRoleSchema,
  userQuerySchema,
} from '../validations/userValidation.js';
import { changePasswordSchema } from '../validations/authValidation.js';

const router: Router = Router();

// Protect all routes after this middleware
router.use(protect);

// Current user profile routes
router.get('/me', getMe);
router.patch('/me', validate(updateMeSchema, 'body'), updateMe);
router.delete('/me', deactivateMe);
router.patch(
  '/me/password',
  validate(changePasswordSchema, 'body'),
  changePassword
);

// Current user addresses
router
  .route('/me/addresses')
  .get(getAddresses)
  .post(validate(addressSchema, 'body'), addAddress);

router
  .route('/me/addresses/:addressId')
  .patch(validate(updateAddressSchema, 'body'), updateAddress)
  .delete(removeAddress);

// Admin-only user management routes
router.use(restrictTo('admin'));

router.get('/', validate(userQuerySchema, 'query'), getAllUsers);
router.route('/:id').get(getUser).delete(deleteUser);
router.patch(
  '/:id/role',
  validate(updateUserRoleSchema, 'body'),
  updateUserRole
);

export default router;
