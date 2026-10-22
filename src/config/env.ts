import dotenv from 'dotenv';
import { z } from 'zod';

// Load environment variables from .env
dotenv.config();

const baseEnvSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(5000),
  MONGO_URI: z
    .string()
    .min(1, 'MONGO_URI is required')
    .default('mongodb://127.0.0.1:27017/gash-backend'),
  JWT_SECRET: z
    .string()
    .min(16, 'JWT_SECRET must be at least 16 characters')
    .default('your_jwt_secret_key_change_in_production'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  BCRYPT_COST: z.coerce.number().min(4).max(16).default(12),
  FRONTEND_URL: z.string().default('http://localhost:3000'),
  ALLOWED_ORIGINS: z.string().optional(),
});

const envSchema = baseEnvSchema.superRefine((data, ctx) => {
  if (data.NODE_ENV === 'production') {
    if (
      !process.env.JWT_SECRET ||
      data.JWT_SECRET === 'your_jwt_secret_key_change_in_production' ||
      data.JWT_SECRET.length < 32
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_SECRET'],
        message:
          'In production, JWT_SECRET must be explicitly set and be at least 32 characters long.',
      });
    }

    if (
      !process.env.MONGO_URI ||
      data.MONGO_URI.includes('127.0.0.1') ||
      data.MONGO_URI.includes('localhost')
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['MONGO_URI'],
        message:
          'In production, MONGO_URI must be explicitly set to a production database URI.',
      });
    }
  }
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const formattedErrors = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  // eslint-disable-next-line no-console
  console.error(
    `\n❌ Invalid environment variable configuration:\n${formattedErrors}\n`
  );
  throw new Error('Invalid environment configuration');
}

export const env = parsed.data;
export type Env = z.infer<typeof envSchema>;
