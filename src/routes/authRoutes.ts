import { Router } from 'express';
import {
  register,
  login,
  refreshToken,
  logout,
  logoutAll,
  forgotPassword,
  resetPassword,
  verifyEmail,
} from '../controllers/authController.js';
import { validate } from '../middlewares/validate.js';
import { protect } from '../middlewares/auth.js';
import {
  registerSchema,
  loginSchema,
  refreshTokenSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from '../validations/authValidation.js';

const router: Router = Router();

router.post('/register', validate(registerSchema, 'body'), register);
router.post('/login', validate(loginSchema, 'body'), login);
router.post(
  '/refresh-token',
  validate(refreshTokenSchema, 'body'),
  refreshToken
);
router.post('/logout', protect, logout);
router.post('/logout-all', protect, logoutAll);
router.post(
  '/forgot-password',
  validate(forgotPasswordSchema, 'body'),
  forgotPassword
);
router.patch(
  '/reset-password/:token',
  validate(resetPasswordSchema, 'body'),
  resetPassword
);
router.get('/verify-email/:token', verifyEmail);

export default router;
