// Teacher sign-in: one account from the environment, a signed httpOnly session cookie. On the
// public demo the cookie also names the visitor's private copy of the data.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Router, type RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import type { AuthConfig, AuthSession, Me } from '../../shared/api';
import { loginSchema } from '../../shared/schemas';
import { config } from './config';
import { runInContext } from './context';
import { HttpError, parse } from './http';
import { createWorkspace, workspaceDir } from './workspaces';

const COOKIE = 'tanpura_session';
const TTL_MS = 12 * 60 * 60 * 1000;

const sign = (expires: number, workspace: string) => createHmac('sha256', config.auth.secret).update(`v2.${expires}.${workspace}`).digest('base64url');

// Compares via fixed-length digests so neither content nor length leaks through timing.
const sameText = (a: string, b: string) =>
  timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());

// The session's workspace ('' for the main data), or undefined if the token is not valid.
function readToken(token: unknown): string | undefined {
  if (typeof token !== 'string') return undefined;
  const [expires, workspace, signature, extra] = token.split('.');
  const exp = Number(expires);
  const ok = extra === undefined && Number.isSafeInteger(exp) && exp > Date.now() && typeof workspace === 'string' && typeof signature === 'string' && sameText(signature, sign(exp, workspace));
  return ok ? workspace : undefined;
}

export const requireAuth: RequestHandler = async (req, _res, next) => {
  const workspace = readToken(req.cookies?.[COOKIE]);
  if (workspace === undefined) return next(new HttpError(401, 'Please sign in'));
  let dir = config.dataDir;
  if (workspace) {
    const found = await workspaceDir(workspace);
    if (!found) return next(new HttpError(401, 'This demo session has ended. Please sign in again.'));
    dir = found;
  }
  runInContext({ dir, workspace: workspace || undefined, visitor: req.ip }, () => next());
};

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.env === 'test' ? 1000 : 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many sign-in attempts. Try again in 15 minutes.' },
});

export const authRouter = Router();

authRouter.get('/config', (_req, res) => {
  const body: AuthConfig = { demo: config.demoMode ? { email: config.auth.email, password: config.auth.password } : null };
  res.json(body);
});

authRouter.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = parse(loginSchema, req.body);
  // Evaluate both so a wrong email and a wrong password take the same time.
  const emailOk = sameText(email.toLowerCase(), config.auth.email);
  const passwordOk = sameText(password, config.auth.password);
  if (!emailOk || !passwordOk) throw new HttpError(401, 'Email or password is incorrect');

  const workspace = config.visitorCopies ? await createWorkspace() : '';
  const expires = Date.now() + TTL_MS;
  res.cookie(COOKIE, `${expires}.${workspace}.${sign(expires, workspace)}`, {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.production,
    maxAge: TTL_MS,
    path: '/',
  });
  res.json({ email: config.auth.email } satisfies Me);
});

authRouter.post('/logout', (_req, res) => {
  res.clearCookie(COOKIE, { httpOnly: true, sameSite: 'strict', secure: config.production, path: '/' });
  res.status(204).end();
});

// Who is signed in, if anyone. Always 200, so the sign-in check never logs an error.
authRouter.get('/session', (req, res) => {
  res.json({ user: readToken(req.cookies?.[COOKIE]) !== undefined ? { email: config.auth.email } : null } satisfies AuthSession);
});
