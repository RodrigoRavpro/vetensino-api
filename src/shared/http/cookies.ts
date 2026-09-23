import type { CookieOptions } from 'express';
import { env } from '../../config/env';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * `secure` só liga em produção — em http://localhost o browser descartaria o cookie.
 * `domain` fica undefined em local: o browser rejeita Domain para "localhost".
 */
export const sessionCookieOptions = (maxAgeMs: number = SEVEN_DAYS_MS): CookieOptions => ({
  httpOnly: true,
  secure: env.isProduction,
  sameSite: 'lax',
  domain: env.session.cookieDomain,
  path: '/',
  maxAge: maxAgeMs,
});

/** Precisa repetir domain/path/sameSite, senão o browser não remove o cookie. */
export const clearSessionCookieOptions = (): CookieOptions => ({
  httpOnly: true,
  secure: env.isProduction,
  sameSite: 'lax',
  domain: env.session.cookieDomain,
  path: '/',
});
