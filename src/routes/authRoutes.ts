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
import { optionalAuth, protect } from '../middlewares/auth.js';
import {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from '../validations/authValidation.js';

const router: Router = Router();

router.post('/register', validate(registerSchema, 'body'), register);
router.post('/login', validate(loginSchema, 'body'), login);
router.post('/refresh-token', refreshToken);
router.post('/logout', optionalAuth, logout);
router.post('/logout-all', protect, logoutAll);
router.post(
  '/forgot-password',
  validate(forgotPasswordSchema, 'body'),
  forgotPassword
);
router.post(
  '/reset-password',
  validate(resetPasswordSchema, 'body'),
  resetPassword
);
router.post('/verify-email', validate(verifyEmailSchema, 'body'), verifyEmail);

export default router;
