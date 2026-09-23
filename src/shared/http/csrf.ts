import type { RequestHandler } from 'express';
import { ForbiddenError } from '../errors/AppError';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Defesa CSRF por header custom: um formulário cross-site não consegue definir
 * `X-Requested-With`, e o preflight de CORS já é barrado pela whitelist.
 * Complementa o `SameSite=Lax` do cookie de sessão.
 */
export const requireCustomHeader: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  if (req.get('X-Requested-With') !== 'XMLHttpRequest') {
    next(new ForbiddenError('Requisição rejeitada por proteção CSRF'));
    return;
  }

  next();
};
