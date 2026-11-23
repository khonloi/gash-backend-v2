import { Request, Response, NextFunction, RequestHandler } from 'express';
import { z, ZodError } from 'zod';
import { AppError } from '../utils/AppError.js';

type RequestLocation = 'body' | 'query' | 'params';

export const validate = (
  schema: z.ZodType,
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

    if (source === 'query') {
      // In Express 5, req.query is a prototype getter; materialize the parsed object on req
      // so defaults, coercions, and stripped unknown keys persist for controllers.
      Object.defineProperty(req, 'query', {
        value: result.data,
        writable: true,
        configurable: true,
        enumerable: true,
      });
    } else if (source === 'params') {
      req.params = {
        ...req.params,
        ...(result.data as typeof req.params),
      };
    } else {
      req.body = result.data;
    }

    next();
  };
};
