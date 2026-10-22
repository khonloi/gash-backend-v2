import { Request, Response } from 'express';
import mongoose from 'mongoose';

/**
 * Liveness probe: reports if the Node/Express process is alive and accepting traffic
 */
export const healthCheck = (_req: Request, res: Response): void => {
  res.status(200).json({
    status: 'success',
    message: 'API is running',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
};

/**
 * Readiness probe: checks dependencies (e.g. MongoDB connection) before routing traffic
 */
export const readinessCheck = (_req: Request, res: Response): void => {
  const isDbConnected = mongoose.connection.readyState === 1;

  if (!isDbConnected) {
    res.status(503).json({
      status: 'error',
      message: 'Database is disconnected',
      database: 'disconnected',
      timestamp: new Date().toISOString(),
    });
    return;
  }

  res.status(200).json({
    status: 'success',
    message: 'API is ready to serve traffic',
    database: 'connected',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
};
