import mongoose from 'mongoose';
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

let isShuttingDown = false;

const gracefulShutdown = async (signal: string) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info(`${signal} received. Initiating graceful shutdown...`);

  // Force process exit after 10 seconds if connections fail to drain
  const forceExitTimeout = setTimeout(() => {
    logger.error('Graceful shutdown timed out after 10 seconds. Forcing exit.');
    process.exit(1);
  }, 10000);
  forceExitTimeout.unref();

  server.close(async () => {
    logger.info('HTTP server closed. All active requests completed.');
    try {
      if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
        logger.info('MongoDB connection closed.');
      }
      process.exit(0);
    } catch (err) {
      logger.error('Error during database disconnection:', err);
      process.exit(1);
    }
  });
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
