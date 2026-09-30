import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { sanitizeData } from './middlewares/mongoSanitize.js';
import compression from 'compression';
import hpp from 'hpp';
import { globalErrorHandler } from './middlewares/errorHandler.js';
import { AppError } from './utils/AppError.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { healthCheck } from './controllers/healthController.js';
import { requestId } from './middlewares/requestId.js';
import productRouter from './routes/productRoutes.js';
import authRouter from './routes/authRoutes.js';
import userRouter from './routes/userRoutes.js';
import cartRouter from './routes/cartRoutes.js';
import orderRouter from './routes/orderRoutes.js';

const app: Application = express();

// Assign correlation ID to all requests
app.use(requestId);

// Parse configured CORS allowed origins
const configuredOrigins = env.ALLOWED_ORIGINS
  ? env.ALLOWED_ORIGINS.split(',')
      .map((o) => o.trim())
      .filter(Boolean)
  : [];

const allowedOrigins = Array.from(
  new Set([
    env.FRONTEND_URL,
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    ...configuredOrigins,
  ])
).filter(Boolean);

// Set security HTTP headers
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'", ...allowedOrigins],
      },
    },
    hsts: {
      maxAge: 31536000, // 1 year in seconds
      includeSubDomains: true,
      preload: true,
    },
    referrerPolicy: {
      policy: 'strict-origin-when-cross-origin',
    },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

// Development logging
if (env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// Limit requests from same API
const limiter = rateLimit({
  max: 1000,
  windowMs: 60 * 60 * 1000, // 1 hour
  message: 'Too many requests from this IP, please try again in an hour!',
  skip: () => env.NODE_ENV === 'test',
});
app.use('/api', limiter);

// Stricter rate limiting for auth endpoints (brute-force protection)
const authLimiter = rateLimit({
  max: 20,
  windowMs: 15 * 60 * 1000, // 15 minutes
  message:
    'Too many login or registration attempts from this IP, please try again in 15 minutes!',
  skip: () => env.NODE_ENV === 'test',
});
app.use('/api/v1/auth/login', authLimiter);
app.use('/api/v1/auth/register', authLimiter);

// Body parser, reading data from body into req.body
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Data sanitization against NoSQL query injection
app.use(sanitizeData);

// Protect against HTTP Parameter Pollution attacks
app.use(
  hpp({
    whitelist: [
      'price',
      'ratingsAverage',
      'ratingsQuantity',
      'category',
      'subcategory',
      'brand',
      'status',
      'isFeatured',
      'tags',
      'role',
    ],
  })
);

// Compress responses
app.use(compression());

// Implement CORS
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      if (env.NODE_ENV !== 'production') {
        logger.warn(
          `CORS: Origin '${origin}' allowed in development mode but not in whitelist`
        );
        return callback(null, true);
      }
      return callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'X-Request-Id',
    ],
    exposedHeaders: ['X-Request-Id'],
  })
);

// Routes setup
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/users', userRouter);
app.use('/api/v1/products', productRouter);
app.use('/api/v1/cart', cartRouter);
app.use('/api/v1/orders', orderRouter);

// Health check endpoint
app.get('/api/v1/health', healthCheck);

// Handle unhandled routes
app.use((req: Request, _res: Response, next: NextFunction) => {
  next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
});

// Global Error Handling Middleware
app.use(globalErrorHandler);

export default app;
