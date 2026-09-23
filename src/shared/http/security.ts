import type { CorsOptions } from 'cors';
import type { HelmetOptions } from 'helmet';
import rateLimit from 'express-rate-limit';
import { env } from '../../config/env';
import { logger } from '../../config/logger';

/**
 * Whitelist estrita: origem desconhecida é rejeitada, não apenas logada.
 * `credentials` é obrigatório porque a sessão trafega em cookie httpOnly.
 */
export const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    // Requisições server-to-server e same-origin não enviam Origin.
    if (!origin) {
      callback(null, true);
      return;
    }

    if (env.cors.origins.includes(origin)) {
      callback(null, true);
      return;
    }

    logger.warn('CORS bloqueou origem', { origin });
    callback(new Error('Origem não permitida pelo CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  maxAge: 600,
};

export const helmetOptions: HelmetOptions = {
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://www.google.com/recaptcha/', 'https://www.gstatic.com/recaptcha/'],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", ...env.cors.origins],
      frameAncestors: ["'none'"],
      frameSrc: ["'self'", 'https://www.google.com/recaptcha/'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: env.isProduction ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'same-site' },
  hsts: env.isProduction ? { maxAge: 31_536_000, includeSubDomains: true, preload: true } : false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
};

export const globalRateLimiter = rateLimit({
  windowMs: env.rateLimit.windowMs,
  max: env.rateLimit.maxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    code: 'TOO_MANY_REQUESTS',
    message: 'Muitas requisições. Tente novamente em instantes.',
  },
});

/** Limite agressivo para rotas que disparam e-mail ou tentam autenticar. */
export const sensitiveRateLimiter = rateLimit({
  windowMs: 60_000,
  max: env.isProduction ? 10 : 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    code: 'TOO_MANY_REQUESTS',
    message: 'Muitas tentativas. Aguarde um minuto e tente novamente.',
  },
});
