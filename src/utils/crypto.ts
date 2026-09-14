import crypto from 'crypto';

/**
 * Hash a plain token using SHA-256 for secure DB storage
 */
export const createTokenHash = (token: string): string => {
  return crypto.createHash('sha256').update(token).digest('hex');
};

/**
 * Generate a cryptographically secure random hex string
 */
export const generateRandomToken = (): string => {
  return crypto.randomBytes(32).toString('hex');
};
