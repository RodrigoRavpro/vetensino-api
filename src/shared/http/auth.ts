import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { UserRole } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import { env } from '../../config/env';
import { ForbiddenError, UnauthorizedError } from '../errors/AppError';

export type AuthenticatedUser = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  sessionId: string;
};

declare global {
  namespace Express {
    interface Request {
      auth?: AuthenticatedUser;
    }
  }
}

type SessionPayload = {
  sub: string;
};

const hashToken = (token: string): string => crypto.createHash('sha256').update(token).digest('hex');

export const createSession = async (user: { id: string; email: string; name: string; role: UserRole }, req: Request) => {
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await prisma.userSession.updateMany({
    where: { userId: user.id, isActive: true },
    data: { isActive: false, revokedAt: new Date() },
  });

  const signedToken = jwt.sign({ sub: user.id } satisfies SessionPayload, env.jwt.secret, {
    expiresIn: env.jwt.expiresIn as jwt.SignOptions['expiresIn'],
  });

  const session = await prisma.userSession.create({
    data: {
      id: sessionId,
      userId: user.id,
      tokenHash: hashToken(signedToken),
      ipAddress: req.ip,
      deviceInfo: req.get('user-agent'),
      expiresAt,
    },
  });

  return { token: signedToken, sessionId: session.id, expiresAt };
};

export const setSessionCookie = (res: Response, token: string): void => {
  res.cookie(env.session.cookieName, token, {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: 'lax',
    path: '/',
    ...(env.session.cookieDomain ? { domain: env.session.cookieDomain } : {}),
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
};

export const authenticate: RequestHandler = async (req, _res, next) => {
  try {
    const token = req.cookies?.[env.session.cookieName];
    if (!token) throw new UnauthorizedError();

    const verified = jwt.verify(token, env.jwt.secret);
    if (typeof verified !== 'object' || typeof verified.sub !== 'string') {
      throw new UnauthorizedError('Sessão inválida ou expirada');
    }
    const payload = verified as SessionPayload;
    const session = await prisma.userSession.findFirst({
      where: { userId: payload.sub, tokenHash: hashToken(token) },
      include: { user: true },
    });

    if (
      !session ||
      !session.isActive ||
      session.expiresAt <= new Date() ||
      !session.user.isActive ||
      session.tokenHash !== hashToken(token)
    ) {
      throw new UnauthorizedError('Sessão inválida ou expirada');
    }

    req.auth = {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      role: session.user.role,
      sessionId: session.id,
    };
    await prisma.userSession.update({ where: { id: session.id }, data: { lastUsedAt: new Date() } });
    next();
  } catch (error) {
    next(error instanceof UnauthorizedError ? error : new UnauthorizedError('Sessão inválida ou expirada'));
  }
};

export const requireRole = (...roles: UserRole[]): RequestHandler => (req, _res, next: NextFunction) => {
  if (!req.auth) {
    next(new UnauthorizedError());
    return;
  }
  if (!roles.includes(req.auth.role)) {
    next(new ForbiddenError('Acesso restrito ao perfil autorizado'));
    return;
  }
  next();
};

export const clearSessionCookie = (res: Response): void => {
  res.clearCookie(env.session.cookieName, {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: 'lax',
    path: '/',
    ...(env.session.cookieDomain ? { domain: env.session.cookieDomain } : {}),
  });
};

export { hashToken };
