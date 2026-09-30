import { prisma } from '../database/prisma';
import { env } from '../../config/env';

export const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] || character);

type SendEmailInput = {
  template: string;
  to: string;
  subject: string;
  html: string;
  userId?: string;
  entityType?: string;
  entityId?: string;
};

/** Registra em EmailLog e envia via Resend; nunca lança, retorna se o envio foi aceito. */
export const sendEmail = async ({ template, to, subject, html, userId, entityType, entityId }: SendEmailInput): Promise<boolean> => {
  const emailLog = await prisma.emailLog.create({ data: { template, to, subject, userId, entityType, entityId } });
  if (!env.email.apiKey) {
    await prisma.emailLog.update({ where: { id: emailLog.id }, data: { status: 'FAILED', attempts: 1, errorMessage: 'RESEND_API_KEY não configurada' } });
    return false;
  }
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.email.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: `${env.email.fromName} <${env.email.from}>`, to: [to], subject, html }),
    });
    const result = await response.json() as { id?: string; message?: string };
    await prisma.emailLog.update({ where: { id: emailLog.id }, data: response.ok
      ? { status: 'SENT', attempts: 1, providerMessageId: result.id, sentAt: new Date() }
      : { status: 'FAILED', attempts: 1, errorMessage: result.message || 'Falha ao enviar e-mail' } });
    return response.ok;
  } catch (error) {
    await prisma.emailLog.update({ where: { id: emailLog.id }, data: { status: 'FAILED', attempts: 1, errorMessage: error instanceof Error ? error.message.slice(0, 500) : 'Falha ao enviar e-mail' } });
    return false;
  }
};
