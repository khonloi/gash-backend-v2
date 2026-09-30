import { Response } from 'express';

export interface ResponseMeta {
  results?: number;
  pagination?: {
    page: number;
    limit: number;
    totalPages: number;
    totalResults: number;
  };
  message?: string;
  [key: string]: unknown;
}

export interface ApiResponse<T = unknown> {
  status: 'success';
  results?: number;
  pagination?: ResponseMeta['pagination'];
  message?: string;
  data: T;
  [key: string]: unknown;
}

/**
 * Sends a standardized JSON success response.
 *
 * @param res - Express response object
 * @param data - Payload data attached under the `data` key
 * @param statusCode - HTTP status code (defaults to 200)
 * @param meta - Optional metadata such as pagination info, result counts, or message
 */
export function sendSuccess<T>(
  res: Response,
  data: T,
  statusCode = 200,
  meta?: ResponseMeta
): Response {
  const body: ApiResponse<T> = {
    status: 'success',
    ...meta,
    data,
  };
  return res.status(statusCode).json(body);
}
