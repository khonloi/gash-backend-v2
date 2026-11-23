import http from 'http';
import mongoose from 'mongoose';
import { env } from './config/env.js';
import app from './app.js';
import { connectDB } from './config/db.js';
import { logger } from './config/logger.js';
import { initSocketServer, closeSocketServer } from './socket/index.js';

process.on('uncaughtException', (err: Error) => {
  logger.error('UNCAUGHT EXCEPTION! Shutting down...', {
    name: err.name,
    message: err.message,
    stack: err.stack,
  });
  process.exit(1);
});

let server: http.Server | null = null;
let isShuttingDown = false;

const gracefulShutdown = async (signal: string, exitCode = 0) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info(`${signal} received. Initiating graceful shutdown...`);

  // Force process exit after 10 seconds if connections fail to drain
  const forceExitTimeout = setTimeout(() => {
    logger.error('Graceful shutdown timed out after 10 seconds. Forcing exit.');
    process.exit(1);
  }, 10000);
  forceExitTimeout.unref();

  try {
    // Close Socket.IO BEFORE server.close() so open WebSocket connections do not deadlock shutdown
    await closeSocketServer();

    if (server) {
      server.closeIdleConnections?.();
      await new Promise<void>((resolve, reject) => {
        server!.close((err) => (err ? reject(err) : resolve()));
      });
      logger.info('HTTP server closed. All active requests completed.');
    }

    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
      logger.info('MongoDB connection closed.');
    }

    process.exit(exitCode);
  } catch (err) {
    logger.error('Error during graceful shutdown:', err);
    process.exit(1);
  }
};

process.on('unhandledRejection', (reason: unknown) => {
  logger.error('UNHANDLED REJECTION! Shutting down...', {
    reason:
      reason instanceof Error
        ? { name: reason.name, message: reason.message, stack: reason.stack }
        : String(reason),
  });
  void gracefulShutdown('unhandledRejection', 1);
});

process.on('SIGTERM', () => void gracefulShutdown('SIGTERM', 0));
process.on('SIGINT', () => void gracefulShutdown('SIGINT', 0));

async function bootstrap(): Promise<void> {
  await connectDB();

  server = app.listen(env.PORT, () => {
    logger.info(`Server running in ${env.NODE_ENV} mode on port ${env.PORT}`);
  });

  initSocketServer(server);
}

void bootstrap();
