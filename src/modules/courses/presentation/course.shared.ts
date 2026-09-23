import type { Request } from 'express';
import sanitizeHtml from 'sanitize-html';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../../infrastructure/database/prisma';

/** Compartilhado entre admin e instructor routes para evitar drift de validação. */
export const classInput = z.object({
  name: z.string().min(2).max(160),
  code: z.string().max(60).optional().nullable(),
  capacity: z.number().int().positive().max(100_000),
  format: z.enum(['ONLINE', 'IN_PERSON', 'HYBRID']).default('ONLINE'),
  startsAt: z.coerce.date().optional().nullable(),
  endsAt: z.coerce.date().optional().nullable(),
  enrollmentStartsAt: z.coerce.date().optional().nullable(),
  enrollmentEndsAt: z.coerce.date().optional().nullable(),
  locationName: z.string().max(180).optional().nullable(),
  address: z.string().max(300).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  state: z.string().length(2).optional().nullable(),
  onlineUrl: z.string().url().optional().nullable(),
  notes: z.string().max(5_000).optional().nullable(),
});

/** Sanitiza recursivamente todo valor string de um JSON dinâmico (contentJson) contra XSS armazenado. */
const sanitizeDeep = (value: unknown): unknown => {
  if (typeof value === 'string') return sanitizeHtml(value);
  if (Array.isArray(value)) return value.map(sanitizeDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, sanitizeDeep(item)]));
  }
  return value;
};

export const prismaJson = (value: Record<string, unknown> | null | undefined): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined => {
  if (value === null) return Prisma.JsonNull;
  if (value === undefined) return undefined;
  return sanitizeDeep(value) as Prisma.InputJsonValue;
};

export const sanitizeDescription = (value: string | null | undefined): string | null | undefined =>
  value === undefined || value === null ? value : sanitizeHtml(value);

export const publicCourse = (course: { id: string; price: Prisma.Decimal; promoPrice: Prisma.Decimal | null; [key: string]: unknown }) => ({
  ...course,
  price: course.price.toString(),
  promoPrice: course.promoPrice?.toString() ?? null,
});

const auditJson = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value, (_key, item: unknown) => (typeof item === 'bigint' ? item.toString() : item))) as Prisma.InputJsonValue;

export const audit = async (req: Request, action: string, entityType: string, entityId: string, after: unknown, before?: unknown): Promise<void> => {
  if (!req.auth) return;
  await prisma.auditLog.create({
    data: {
      actorId: req.auth.id,
      actorEmail: req.auth.email,
      actorRole: req.auth.role,
      action,
      entityType,
      entityId,
      before: before === undefined ? undefined : auditJson(before),
      after: auditJson(after),
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    },
  });
};

/** Evita CSV/Formula Injection: campos que o Excel/Sheets interpretaria como fórmula ganham prefixo neutro. */
export const csvSafeCell = (value: unknown): string => {
  const text = value === null || value === undefined ? '' : String(value);
  const guarded = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${guarded.replace(/"/g, '""')}"`;
};

export const toCsv = (headers: string[], rows: unknown[][]): string => {
  const lines = [headers.map(csvSafeCell).join(',')];
  for (const row of rows) lines.push(row.map(csvSafeCell).join(','));
  return lines.join('\r\n');
};
