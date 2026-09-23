import { env } from '../../config/env';

const MAX_ATTEMPTS_BEFORE_CAPTCHA = 3;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const CAPTCHA_REQUIRED_MS = 30 * 60 * 1000;

type AttemptState = {
  count: number;
  lastAttemptAt: number;
  requiresCaptcha: boolean;
};

const attempts = new Map<string, AttemptState>();

const keyFor = (ip: string, email: string): string => `${ip}:${email.toLowerCase()}`;

const getState = (key: string): AttemptState | undefined => {
  const state = attempts.get(key);
  if (!state) return undefined;

  const age = Date.now() - state.lastAttemptAt;
  if (age > CAPTCHA_REQUIRED_MS) {
    attempts.delete(key);
    return undefined;
  }

  return state;
};

export const isCaptchaRequired = (ip: string, email: string): boolean =>
  Boolean(getState(keyFor(ip, email))?.requiresCaptcha);

export const recordFailedLogin = (ip: string, email: string): void => {
  const key = keyFor(ip, email);
  const current = getState(key);
  const now = Date.now();
  const count = current && now - current.lastAttemptAt <= ATTEMPT_WINDOW_MS ? current.count + 1 : 1;

  attempts.set(key, {
    count,
    lastAttemptAt: now,
    requiresCaptcha: count >= MAX_ATTEMPTS_BEFORE_CAPTCHA,
  });
};

export const clearFailedLogins = (ip: string, email: string): void => {
  attempts.delete(keyFor(ip, email));
};

export const verifyRecaptcha = async (token: string | undefined, ip: string): Promise<boolean> => {
  if (!env.captcha.isConfigured) return !env.isProduction;
  if (!token) return false;

  try {
    const body = new URLSearchParams({
      secret: env.captcha.secretKey,
      response: token,
      remoteip: ip,
    });
    const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return false;

    const result = (await response.json()) as { success?: boolean };
    return result.success === true;
  } catch {
    return false;
  }
};

export const captchaPolicy = {
  maxAttemptsBeforeCaptcha: MAX_ATTEMPTS_BEFORE_CAPTCHA,
  requiredDurationMs: CAPTCHA_REQUIRED_MS,
};
