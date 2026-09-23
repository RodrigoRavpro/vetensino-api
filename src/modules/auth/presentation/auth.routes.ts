import { Router } from 'express';
import { UserRole } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { env } from '../../../config/env';
import { prisma } from '../../../infrastructure/database/prisma';
import { asyncHandler } from '../../../shared/http/asyncHandler';
import { authenticate, clearSessionCookie, createSession, setSessionCookie } from '../../../shared/http/auth';
import { ForbiddenError, UnauthorizedError, ValidationError } from '../../../shared/errors/AppError';
import { sensitiveRateLimiter } from '../../../shared/http/security';
import { clearFailedLogins, isCaptchaRequired, recordFailedLogin, verifyRecaptcha } from '../../../shared/http/captcha';

const devLoginSchema = z.object({
  role: z.nativeEnum(UserRole),
});

const passwordSchema = z.string().min(8).refine((value) => Buffer.byteLength(value, 'utf8') <= 72, 'A senha deve ter no máximo 72 bytes');

const loginSchema = z.object({
  email: z.string().email(),
  password: passwordSchema,
  recaptchaToken: z.string().optional(),
});

export const buildAuthRoutes = (): Router => {
  const router = Router();

  router.post(
    '/login',
    sensitiveRateLimiter,
    asyncHandler(async (req, res) => {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('E-mail ou senha inválidos');

      const email = parsed.data.email.trim().toLowerCase();
      const ipAddress = req.ip || 'unknown';
      const captchaRequired = isCaptchaRequired(ipAddress, email);

      if (captchaRequired) {
        await prisma.authEvent.create({ data: { email, type: 'CAPTCHA_REQUIRED', ipAddress, userAgent: req.get('user-agent'), reason: 'failed_login_threshold' } });
        const captchaValid = await verifyRecaptcha(parsed.data.recaptchaToken, ipAddress);
        if (!captchaValid) {
          await prisma.authEvent.create({ data: { email, type: 'CAPTCHA_FAILED', ipAddress, userAgent: req.get('user-agent'), reason: 'invalid_or_missing_token' } });
          throw new ForbiddenError('Confirme o reCAPTCHA para continuar', { captchaRequired: true });
        }
      }

      const user = await prisma.user.findUnique({ where: { email } });
      if (!user || !user.isActive || !user.password || !(await bcrypt.compare(parsed.data.password, user.password))) {
        recordFailedLogin(ipAddress, email);
        await prisma.authEvent.create({ data: { userId: user?.id, email, type: 'LOGIN_FAILED', ipAddress, userAgent: req.get('user-agent'), reason: 'invalid_credentials' } });
        throw new UnauthorizedError('E-mail ou senha inválidos');
      }

      clearFailedLogins(ipAddress, email);
      const session = await createSession(user, req);
      setSessionCookie(res, session.token);
      await prisma.authEvent.create({ data: { userId: user.id, email, type: 'LOGIN', success: true, ipAddress, userAgent: req.get('user-agent'), sessionId: session.sessionId } });
      res.json({ success: true, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
    }),
  );

  router.post(
    '/dev-login',
    sensitiveRateLimiter,
    asyncHandler(async (req, res) => {
      if (!env.isTest && env.nodeEnv !== 'development') {
        throw new ForbiddenError('Login de desenvolvimento desabilitado');
      }

      const parsed = devLoginSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('Perfil inválido', parsed.error.flatten());

      const role = parsed.data.role;
      const email = `dev-${role.toLowerCase()}@vetensino.local`;
      const user = await prisma.user.upsert({
        where: { email },
        update: { isActive: true, role },
        create: { email, name: `Usuário ${role}`, role, isActive: true },
      });

      const session = await createSession(user, req);
      setSessionCookie(res, session.token);
      res.json({ success: true, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
    }),
  );

  router.get(
    '/dev-users',
    asyncHandler(async (_req, res) => {
      if (!env.isTest && env.nodeEnv !== 'development') {
        throw new ForbiddenError('Usuários de desenvolvimento desabilitados');
      }

      const users = await prisma.user.findMany({
        where: { email: { startsWith: 'dev-' }, isActive: true },
        select: { id: true, name: true, email: true, role: true },
        orderBy: { role: 'asc' },
      });

      res.json({ success: true, users });
    }),
  );

  router.get(
    '/me',
    authenticate,
    asyncHandler(async (req, res) => {
      res.json({ success: true, user: req.auth });
    }),
  );

  router.post(
    '/logout',
    authenticate,
    asyncHandler(async (req, res) => {
      if (req.auth) {
        await prisma.userSession.update({
          where: { id: req.auth.sessionId },
          data: { isActive: false, revokedAt: new Date() },
        });
      }
      clearSessionCookie(res);
      res.json({ success: true });
    }),
  );

  return router;
};
