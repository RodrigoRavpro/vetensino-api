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
import { hashPasswordToken, sendPasswordReset } from '../application/passwordTokens';

const devLoginSchema = z.object({
  role: z.nativeEnum(UserRole),
});

const passwordSchema = z.string().min(8).refine((value) => Buffer.byteLength(value, 'utf8') <= 72, 'A senha deve ter no máximo 72 bytes');

const loginSchema = z.object({
  email: z.string().email(),
  password: passwordSchema,
  recaptchaToken: z.string().optional(),
});

const forgotPasswordSchema = z.object({ email: z.string().trim().email().max(240) });
const setPasswordSchema = z.object({ token: z.string().min(20).max(200), password: passwordSchema });

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
    '/password/forgot',
    sensitiveRateLimiter,
    asyncHandler(async (req, res) => {
      const parsed = forgotPasswordSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('Informe um e-mail válido');
      const email = parsed.data.email.toLowerCase();
      const user = await prisma.user.findUnique({ where: { email } });
      if (user?.isActive) {
        await sendPasswordReset(user);
        await prisma.authEvent.create({ data: { userId: user.id, email, type: 'PASSWORD_RESET_REQUESTED', success: true, ipAddress: req.ip, userAgent: req.get('user-agent') } });
      }
      // Resposta idêntica exista ou não a conta, para não permitir enumeração de e-mails.
      res.json({ success: true, message: 'Se o e-mail estiver cadastrado, você receberá um link para definir a senha.' });
    }),
  );

  router.post(
    '/password/set',
    sensitiveRateLimiter,
    asyncHandler(async (req, res) => {
      const parsed = setPasswordSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('A senha deve ter pelo menos 8 caracteres');
      const hash = hashPasswordToken(parsed.data.token);
      const now = new Date();
      const user = await prisma.user.findFirst({
        where: {
          isActive: true,
          OR: [
            { setPasswordTokenHash: hash, setPasswordExpiresAt: { gt: now } },
            { passwordResetTokenHash: hash, passwordResetExpiresAt: { gt: now } },
          ],
        },
      });
      if (!user) throw new ValidationError('Link inválido ou expirado. Solicite um novo.');

      const hadPassword = Boolean(user.password);
      const updated = await prisma.user.update({
        where: { id: user.id },
        data: {
          password: await bcrypt.hash(parsed.data.password, 12),
          setPasswordTokenHash: null,
          setPasswordExpiresAt: null,
          passwordResetTokenHash: null,
          passwordResetExpiresAt: null,
          emailVerifiedAt: user.emailVerifiedAt ?? now,
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      });
      const session = await createSession(updated, req);
      setSessionCookie(res, session.token);
      await prisma.authEvent.create({ data: { userId: user.id, email: user.email, type: hadPassword ? 'PASSWORD_CHANGED' : 'PASSWORD_DEFINED', success: true, ipAddress: req.ip, userAgent: req.get('user-agent'), sessionId: session.sessionId } });
      res.json({ success: true, user: { id: updated.id, name: updated.name, email: updated.email, role: updated.role } });
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
