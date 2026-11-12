// HTTP helpers: typed errors, request validation, and the API error handler.
import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { z } from 'zod';
import type { ApiErrorBody } from '../../shared/api';
import { PayPalApiError } from './paypal';

export class HttpError extends Error {
  readonly status: number;
  readonly issues: ApiErrorBody['issues'];

  constructor(status: number, message: string, issues?: ApiErrorBody['issues']) {
    super(message);
    this.status = status;
    this.issues = issues;
  }
}

// Parses `value` with `schema` or throws a 400 listing what is wrong.
export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new HttpError(
    400,
    'Invalid request',
    result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  );
}

// Mutations must send JSON. Browsers can't send a cross-site JSON request without a CORS
// preflight (which this API never approves), so this also blocks cross-site form posts.
export const requireJson: RequestHandler = (req, _res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD' && !req.is('application/json')) {
    return next(new HttpError(415, 'Send JSON (Content-Type: application/json)'));
  }
  next();
};

export const apiNotFound: RequestHandler = (_req, _res, next) => next(new HttpError(404, 'Not found'));

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    const body: ApiErrorBody = { error: err.message, ...(err.issues ? { issues: err.issues } : {}) };
    return void res.status(err.status).json(body);
  }
  // express.json() errors: malformed JSON or a body over the size limit.
  if (typeof err?.status === 'number' && err.status >= 400 && err.status < 500) {
    return void res.status(err.status).json({ error: err.type === 'entity.too.large' ? 'Request too large' : 'Malformed JSON' });
  }
  if (err instanceof PayPalApiError) {
    console.error(err.message);
    return void res.status(502).json({ error: 'PayPal did not accept this request. Please try again, or refresh from PayPal.' } satisfies ApiErrorBody);
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' } satisfies ApiErrorBody);
};
