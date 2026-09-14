import { Request, Response, NextFunction, RequestHandler } from 'express';
import { ZodTypeAny, ZodError } from 'zod';
import { AppError } from '../utils/AppError.js';

type RequestLocation = 'body' | 'query' | 'params';

export const validate = (
  schema: ZodTypeAny,
  source: RequestLocation = 'body'
): RequestHandler => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const dataToValidate = req[source];
    const result = schema.safeParse(dataToValidate);

    if (!result.success) {
      const error: ZodError = result.error;
      const errorMessages = error.issues.map((issue) => {
        const path = issue.path.join('.');
        return path ? `${path}: ${issue.message}` : issue.message;
      });

      const message = `Validation error: ${errorMessages.join('; ')}`;
      return next(new AppError(message, 400));
    }

    // In Express 5, req.query is a getter, so mutate keys directly instead of reassigning req.query
    if (source === 'query') {
      const queryData = result.data as Record<string, unknown>;
      for (const [key, value] of Object.entries(queryData)) {
        (req.query as Record<string, unknown>)[key] = value;
      }
    } else {
      req[source] = result.data;
    }

    next();
  };
};
