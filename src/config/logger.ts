import winston from 'winston';
import { env } from './env.js';

const { combine, timestamp, printf, colorize, json, errors } = winston.format;

const devFormat = printf(
  ({ level, message, timestamp: ts, stack, ...meta }) => {
    const metaKeys = Object.keys(meta);
    const metaStr = metaKeys.length > 0 ? ` ${JSON.stringify(meta)}` : '';
    return `${ts} [${level}]: ${stack || message}${metaStr}`;
  }
);

// Emit structured JSON logs to stdout/stderr in production (container-safe under non-root USER node)
export const logger = winston.createLogger({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: combine(errors({ stack: true }), timestamp()),
  transports: [
    new winston.transports.Console({
      format:
        env.NODE_ENV === 'production'
          ? combine(timestamp(), json())
          : combine(
              colorize(),
              timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
              devFormat
            ),
    }),
  ],
});
