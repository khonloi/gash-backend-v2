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
import { healthCheck } from './controllers/healthController.js';

const app: Application = express();

// Set security HTTP headers
app.use(helmet());

// Development logging
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// Limit requests from same API
const limiter = rateLimit({
  max: 100, // 100 requests
  windowMs: 60 * 60 * 1000, // 1 hour
  message: 'Too many requests from this IP, please try again in an hour!',
});
app.use('/api', limiter);

// Body parser, reading data from body into req.body
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Data sanitization against NoSQL query injection
app.use(sanitizeData);

// Protect against HTTP Parameter Pollution attacks
app.use(hpp());

// Compress responses
app.use(compression());

// Implement CORS
app.use(cors());

// Routes setup will go here
// app.use('/api/v1/users', userRouter);

// Health check endpoint
app.get('/api/v1/health', healthCheck);

// Handle unhandled routes
app.use((req: Request, _res: Response, next: NextFunction) => {
  next(new AppError(`Can't find ${req.originalUrl} on this server!`, 404));
});

// Global Error Handling Middleware
app.use(globalErrorHandler);

export default app;
