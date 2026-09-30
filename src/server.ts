import { env } from './config/env.js';
import app from './app.js';
import { connectDB } from './config/db.js';
import { logger } from './config/logger.js';

process.on('uncaughtException', (err: Error) => {
  logger.error('UNCAUGHT EXCEPTION! Shutting down...');
  logger.error(`${err.name}: ${err.message}`);
  process.exit(1);
});

// Connect to database
if (env.MONGO_URI) {
  connectDB();
} else {
  logger.warn(
    'MONGO_URI is not defined. Server running without MongoDB connection.'
  );
}

const server = app.listen(env.PORT, () => {
  logger.info(`Server running in ${env.NODE_ENV} mode on port ${env.PORT}`);
});

process.on('unhandledRejection', (reason: unknown) => {
  logger.error('UNHANDLED REJECTION! Shutting down...');
  if (reason instanceof Error) {
    logger.error(`${reason.name}: ${reason.message}`);
  } else {
    logger.error(`Reason: ${String(reason)}`);
  }
  server.close(() => {
    process.exit(1);
  });
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM RECEIVED. Shutting down gracefully');
  server.close(() => {
    logger.info('Process terminated!');
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT RECEIVED. Shutting down gracefully');
  server.close(() => {
    logger.info('Process terminated!');
    process.exit(0);
  });
});
