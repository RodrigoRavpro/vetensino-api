import crypto from 'node:crypto';
import { prisma } from '../../../infrastructure/database/prisma';
import { escapeHtml, sendEmail } from '../../../infrastructure/email/sendEmail';
import { env } from '../../../config/env';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;

export const hashPasswordToken = (token: string): string => crypto.createHash('sha256').update(token).digest('hex');

const newToken = () => {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, hash: hashPasswordToken(token) };
};

const passwordLink = (token: string) => `${env.urls.web}/definir-senha?token=${encodeURIComponent(token)}`;

type UserRef = { id: string; email: string; name: string };

export const sendAccessInvite = async (user: UserRef, courseTitle: string): Promise<boolean> => {
  const { token, hash } = newToken();
  await prisma.user.update({ where: { id: user.id }, data: { setPasswordTokenHash: hash, setPasswordExpiresAt: new Date(Date.now() + INVITE_TTL_MS) } });
  return sendEmail({
    template: 'ENROLLMENT_ACCESS_INVITE',
    to: user.email,
    subject: `Sua matrícula em ${courseTitle} foi confirmada`,
    userId: user.id,
    entityType: 'User',
    entityId: user.id,
    html: `<p>Olá, ${escapeHtml(user.name)}!</p><p>Sua matrícula no curso <strong>${escapeHtml(courseTitle)}</strong> foi confirmada.</p><p>Para acessar a plataforma, defina sua senha pelo link abaixo (válido por 7 dias):</p><p><a href="${passwordLink(token)}">Definir minha senha</a></p>`,
  });
};

export const sendEnrollmentConfirmation = async (user: UserRef, courseTitle: string): Promise<boolean> => sendEmail({
  template: 'ENROLLMENT_CONFIRMED',
  to: user.email,
  subject: `Sua matrícula em ${courseTitle} foi confirmada`,
  userId: user.id,
  entityType: 'User',
  entityId: user.id,
  html: `<p>Olá, ${escapeHtml(user.name)}!</p><p>Sua matrícula no curso <strong>${escapeHtml(courseTitle)}</strong> foi confirmada.</p><p><a href="${env.urls.web}/login">Acessar a plataforma</a></p>`,
});

export const sendPasswordReset = async (user: UserRef): Promise<boolean> => {
  const { token, hash } = newToken();
  await prisma.user.update({ where: { id: user.id }, data: { passwordResetTokenHash: hash, passwordResetExpiresAt: new Date(Date.now() + RESET_TTL_MS) } });
  return sendEmail({
    template: 'PASSWORD_RESET',
    to: user.email,
    subject: 'Redefinição de senha — VetEnsino',
    userId: user.id,
    entityType: 'User',
    entityId: user.id,
    html: `<p>Olá, ${escapeHtml(user.name)}!</p><p>Recebemos um pedido para redefinir sua senha. O link abaixo é válido por 1 hora:</p><p><a href="${passwordLink(token)}">Redefinir minha senha</a></p><p>Se você não fez este pedido, ignore este e-mail.</p>`,
  });
};
