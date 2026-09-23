import { Router } from 'express';
import { ClassStatus, CourseStatus, UserRole } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../../infrastructure/database/prisma';
import { env } from '../../../config/env';
import { asyncHandler } from '../../../shared/http/asyncHandler';
import { AppError, NotFoundError } from '../../../shared/errors/AppError';
import { sensitiveRateLimiter } from '../../../shared/http/security';
import { authenticate, requireRole } from '../../../shared/http/auth';

const toPublicCourse = (course: any) => ({
  id: course.id,
  slug: course.slug,
  title: course.title,
  subtitle: course.subtitle,
  description: course.description,
  contentJson: course.contentJson,
  coverImageUrl: course.coverImageUrl,
  promoVideoUrl: course.promoVideoUrl,
  price: course.price.toString(),
  promoPrice: course.promoPrice?.toString() ?? null,
  workloadHours: course.workloadHours,
  certificateEnabled: course.certificateEnabled,
  publishedAt: course.publishedAt,
  classes: course.classes.map((courseClass: any) => ({
    id: courseClass.id,
    name: courseClass.name,
    format: courseClass.format,
    capacity: courseClass.capacity,
    startsAt: courseClass.startsAt,
    endsAt: courseClass.endsAt,
    enrollmentStartsAt: courseClass.enrollmentStartsAt,
    enrollmentEndsAt: courseClass.enrollmentEndsAt,
    locationName: courseClass.locationName,
    city: courseClass.city,
    state: courseClass.state,
  })),
});

const publicInclude = {
  classes: {
    where: { status: { not: ClassStatus.CANCELED } },
    orderBy: { startsAt: 'asc' as const },
  },
};

const preRegistrationFieldSchema = z.enum(['name', 'email', 'phone', 'company']);
type PreRegistrationField = z.infer<typeof preRegistrationFieldSchema>;
const safePreRegistrationContent = (value: unknown) => {
  const content = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const fields: PreRegistrationField[] = Array.isArray(content.preRegistrationFields)
    ? content.preRegistrationFields.filter((field): field is PreRegistrationField => typeof field === 'string' && preRegistrationFieldSchema.safeParse(field).success)
    : ['name', 'email'];
  return {
    fields: [...new Set(fields)].slice(0, 4),
    buttonLabel: typeof content.preRegistrationButtonLabel === 'string' && content.preRegistrationButtonLabel.trim().length >= 2 && content.preRegistrationButtonLabel.length <= 80
      ? content.preRegistrationButtonLabel.trim()
      : 'Quero ser avisado',
  };
};

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] || character);

export const buildPublicCourseRoutes = (): Router => {
  const router = Router();

  router.get('/mine', authenticate, requireRole(UserRole.TEACHER, UserRole.STUDENT), asyncHandler(async (req, res) => {
    const isTeacher = req.auth!.role === UserRole.TEACHER;
    const courses = await prisma.course.findMany({
      where: isTeacher
        ? { instructorId: req.auth!.id }
        : { enrollments: { some: { userId: req.auth!.id } } },
      include: {
        enrollments: {
          where: isTeacher
            ? undefined
            : { userId: req.auth!.id },
          include: { user: { select: { id: true, name: true, email: true } } },
        },
        classes: {
          where: isTeacher ? undefined : { enrollments: { some: { userId: req.auth!.id } } },
          orderBy: { startsAt: 'asc' },
          include: isTeacher
            ? { enrollments: { include: { user: { select: { id: true, name: true, email: true } } }, orderBy: { createdAt: 'desc' } } }
            : { enrollments: { where: { userId: req.auth!.id }, select: { id: true, status: true, startedAt: true, completedAt: true } } },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
    res.json({ success: true, courses: courses.map((course) => ({
      ...toPublicCourse(course),
      ...(isTeacher
        ? { students: course.enrollments.map((enrollment) => ({ id: enrollment.user.id, name: enrollment.user.name, email: enrollment.user.email, enrollmentStatus: enrollment.status })) }
        : { enrollment: course.enrollments[0] ? { id: course.enrollments[0].id, status: course.enrollments[0].status, startedAt: course.enrollments[0].startedAt, completedAt: course.enrollments[0].completedAt } : null }),
      classes: course.classes.map((courseClass) => ({
        id: courseClass.id,
        name: courseClass.name,
        startsAt: courseClass.startsAt,
        endsAt: courseClass.endsAt,
        ...(isTeacher
          ? { students: courseClass.enrollments.flatMap((enrollment) => 'user' in enrollment ? [{ id: enrollment.user.id, name: enrollment.user.name, email: enrollment.user.email, enrollmentStatus: enrollment.status }] : []) }
          : { enrollment: courseClass.enrollments[0] ?? null }),
      })),
    })) });
  }));

  router.post('/:slug/pre-registration', sensitiveRateLimiter, asyncHandler(async (req, res) => {
    const course = await prisma.course.findFirst({ where: { slug: req.params.slug, status: CourseStatus.PUBLISHED }, select: { id: true, title: true, contentJson: true } });
    if (!course) throw new NotFoundError('Curso não encontrado');
    const registration = safePreRegistrationContent(course.contentJson);
    const input = z.object({
      name: z.string().trim().min(2).max(160).optional(),
      email: z.string().trim().email().max(240).optional(),
      phone: z.string().trim().regex(/^[0-9+() .-]{8,30}$/).optional(),
      company: z.string().trim().min(2).max(160).optional(),
    }).strict().parse(req.body);
    for (const field of registration.fields) if (!input[field]) throw new AppError(`Campo obrigatório ausente: ${field}`, 422, 'VALIDATION_ERROR');
    if (!input.email) throw new AppError('E-mail é obrigatório', 422, 'VALIDATION_ERROR');
    if (!env.email.adminEmail) throw new AppError('E-mail de recebimento não configurado', 503, 'EMAIL_NOT_CONFIGURED');

    const subject = `Pré-inscrição: ${course.title}`;
    const emailLog = await prisma.emailLog.create({ data: { template: 'COURSE_PRE_REGISTRATION', to: env.email.adminEmail, subject, entityType: 'Course', entityId: course.id, payload: input } });
    if (!env.email.apiKey) {
      await prisma.emailLog.update({ where: { id: emailLog.id }, data: { status: 'FAILED', attempts: 1, errorMessage: 'RESEND_API_KEY não configurada' } });
      throw new AppError('Serviço de e-mail não configurado', 503, 'EMAIL_NOT_CONFIGURED');
    }

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.email.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: `${env.email.fromName} <${env.email.from}>`, to: [env.email.adminEmail], subject, html: `<p>Nova pré-inscrição no curso <strong>${escapeHtml(course.title)}</strong>.</p><dl>${Object.entries(input).map(([key, value]) => `<dt><strong>${escapeHtml(key)}</strong></dt><dd>${escapeHtml(String(value))}</dd>`).join('')}</dl>` }),
    });
    const result = await response.json() as { id?: string; message?: string };
    if (!response.ok) {
      await prisma.emailLog.update({ where: { id: emailLog.id }, data: { status: 'FAILED', attempts: 1, errorMessage: result.message || 'Falha ao enviar e-mail' } });
      throw new AppError('Não foi possível enviar a pré-inscrição', 502, 'EMAIL_SEND_FAILED');
    }
    await prisma.emailLog.update({ where: { id: emailLog.id }, data: { status: 'SENT', attempts: 1, providerMessageId: result.id, sentAt: new Date() } });
    res.status(201).json({ success: true, message: 'Pré-inscrição enviada.' });
  }));

  router.get('/', asyncHandler(async (_req, res) => {
    const courses = await prisma.course.findMany({ where: { status: CourseStatus.PUBLISHED }, include: publicInclude, orderBy: { publishedAt: 'desc' } });
    res.json({ success: true, courses: courses.map(toPublicCourse) });
  }));

  router.get('/:slug', asyncHandler(async (req, res) => {
    const course = await prisma.course.findFirst({ where: { slug: req.params.slug, status: CourseStatus.PUBLISHED }, include: publicInclude });
    if (!course) throw new NotFoundError('Curso não encontrado');
    res.json({ success: true, course: toPublicCourse(course) });
  }));

  return router;
};
