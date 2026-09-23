import { Router } from 'express';
import { z } from 'zod';
import { EnrollmentStatus, OrderStatus, Prisma, UserRole } from '@prisma/client';
import { prisma } from '../../../infrastructure/database/prisma';
import { asyncHandler } from '../../../shared/http/asyncHandler';
import { authenticate, requireRole } from '../../../shared/http/auth';
import { requireClassOwnership, requireCourseOwnership, requireEnrollmentOwnership } from '../../../shared/http/ownership';
import { sensitiveRateLimiter } from '../../../shared/http/security';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/errors/AppError';
import { audit, classInput, prismaJson, publicCourse, sanitizeDescription, toCsv } from './course.shared';

// `instructorId` nunca é aceito no body: sempre o docente autenticado. `.strict()` rejeita
// (em vez de descartar silenciosamente) qualquer tentativa de enviar o campo mesmo assim.
const courseInput = z
  .object({
    slug: z.string().min(3).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    title: z.string().min(3).max(180),
    subtitle: z.string().max(240).optional().nullable(),
    description: z.string().max(20_000).optional().nullable(),
    coverImageUrl: z.string().url().optional().nullable(),
    promoVideoUrl: z.string().url().optional().nullable(),
    price: z.number().nonnegative().finite(),
    promoPrice: z.number().nonnegative().finite().optional().nullable(),
    workloadHours: z.number().int().positive().max(10_000).optional().nullable(),
    accessDurationDays: z.number().int().positive().max(3_650).optional().nullable(),
    certificateEnabled: z.boolean().optional(),
    contentJson: z.record(z.unknown()).optional().nullable(),
  })
  .strict();

const createSchema = courseInput.extend({
  classes: z.array(classInput).max(100).default([]),
});

const updateSchema = courseInput.partial();

const enrollmentStatusSchema = z.object({
  status: z.nativeEnum(EnrollmentStatus),
});

const paginationSchema = z.object({
  page: z.coerce.number().int().positive().max(10_000).default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

export const buildInstructorCourseRoutes = (): Router => {
  const router = Router();
  router.use(authenticate, requireRole(UserRole.TEACHER));

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const courses = await prisma.course.findMany({
        where: { instructorId: req.auth!.id },
        orderBy: { updatedAt: 'desc' },
        include: {
          classes: { include: { _count: { select: { enrollments: true } } }, orderBy: { startsAt: 'asc' } },
          _count: { select: { enrollments: true } },
        },
      });

      const courseIds = courses.map((course) => course.id);
      const paidItems = courseIds.length
        ? await prisma.orderItem.findMany({
            where: { courseId: { in: courseIds }, order: { status: OrderStatus.PAID } },
            select: { courseId: true, unitPrice: true, quantity: true },
          })
        : [];
      const revenueByCourse = new Map<string, number>();
      for (const item of paidItems) {
        const amount = Number(item.unitPrice) * item.quantity;
        revenueByCourse.set(item.courseId, (revenueByCourse.get(item.courseId) ?? 0) + amount);
      }

      res.json({
        success: true,
        courses: courses.map((course) => ({
          ...publicCourse(course),
          enrollmentsCount: course._count.enrollments,
          revenue: revenueByCourse.get(course.id) ?? 0,
          classes: course.classes.map((courseClass) => ({
            ...courseClass,
            seatsRemaining: Math.max(courseClass.capacity - courseClass._count.enrollments, 0),
          })),
        })),
      });
    }),
  );

  router.get(
    '/:courseId',
    requireCourseOwnership,
    asyncHandler(async (req, res) => {
      const course = await prisma.course.findUnique({
        where: { id: req.params.courseId },
        include: {
          classes: { orderBy: { startsAt: 'asc' } },
          modules: { include: { lessons: { orderBy: { order: 'asc' } } }, orderBy: { order: 'asc' } },
        },
      });
      if (!course) throw new NotFoundError('Curso não encontrado');
      res.json({ success: true, course: publicCourse(course) });
    }),
  );

  router.post(
    '/',
    sensitiveRateLimiter,
    asyncHandler(async (req, res) => {
      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('Dados do curso inválidos', parsed.error.flatten());
      const { classes, ...input } = parsed.data;
      const course = await prisma.course.create({
        data: {
          ...input,
          instructor: { connect: { id: req.auth!.id } },
          contentJson: prismaJson(input.contentJson),
          description: sanitizeDescription(input.description),
          classes: classes.length ? { create: classes } : undefined,
        },
        include: { classes: true },
      });
      await audit(req, 'COURSE_CREATED', 'Course', course.id, course);
      res.status(201).json({ success: true, course: publicCourse(course) });
    }),
  );

  router.patch(
    '/:courseId',
    requireCourseOwnership,
    asyncHandler(async (req, res) => {
      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('Dados do curso inválidos', parsed.error.flatten());
      const before = await prisma.course.findUnique({ where: { id: req.params.courseId } });
      if (!before) throw new NotFoundError('Curso não encontrado');
      const input = parsed.data;
      const course = await prisma.course.update({
        where: { id: before.id },
        data: {
          ...input,
          contentJson: prismaJson(input.contentJson),
          description: sanitizeDescription(input.description),
        },
        include: { classes: true },
      });
      await audit(req, 'COURSE_UPDATED', 'Course', course.id, course, before);
      res.json({ success: true, course: publicCourse(course) });
    }),
  );

  router.post(
    '/:courseId/classes',
    requireCourseOwnership,
    asyncHandler(async (req, res) => {
      const parsed = classInput.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('Dados da turma inválidos', parsed.error.flatten());
      const created = await prisma.courseClass.create({ data: { ...parsed.data, courseId: req.params.courseId as string } });
      await audit(req, 'COURSE_CLASS_CREATED', 'CourseClass', created.id, created);
      res.status(201).json({ success: true, class: created });
    }),
  );

  router.patch(
    '/:courseId/classes/:classId',
    requireCourseOwnership,
    requireClassOwnership,
    asyncHandler(async (req, res) => {
      const parsed = classInput.partial().safeParse(req.body);
      if (!parsed.success) throw new ValidationError('Dados da turma inválidos', parsed.error.flatten());
      const before = await prisma.courseClass.findUniqueOrThrow({ where: { id: req.params.classId } });
      const updated = await prisma.courseClass.update({ where: { id: before.id }, data: parsed.data });
      await audit(req, 'COURSE_CLASS_UPDATED', 'CourseClass', updated.id, updated, before);
      res.json({ success: true, class: updated });
    }),
  );

  router.delete(
    '/:courseId/classes/:classId',
    requireCourseOwnership,
    requireClassOwnership,
    asyncHandler(async (req, res) => {
      const before = await prisma.courseClass.findUniqueOrThrow({
        where: { id: req.params.classId },
        include: { enrollments: { take: 1 }, reservations: { take: 1 } },
      });
      if (before.enrollments.length || before.reservations.length) throw new ConflictError('Turma com inscrições ou reservas deve ser encerrada, não excluída');
      await prisma.courseClass.delete({ where: { id: before.id } });
      await audit(req, 'COURSE_CLASS_DELETED', 'CourseClass', before.id, { deleted: true }, before);
      res.json({ success: true });
    }),
  );

  router.post(
    '/:courseId/publish',
    requireCourseOwnership,
    asyncHandler(async (req, res) => {
      const before = await prisma.course.findUniqueOrThrow({ where: { id: req.params.courseId }, include: { classes: true } });
      if (!before.title || !before.price || before.classes.length === 0) {
        throw new ValidationError('O curso precisa de título, preço e pelo menos uma turma antes da publicação');
      }
      const course = await prisma.course.update({
        where: { id: before.id },
        data: { status: 'PUBLISHED', publishedAt: new Date() },
        include: { classes: true },
      });
      await audit(req, 'COURSE_PUBLISHED', 'Course', course.id, course, before);
      res.json({ success: true, course: publicCourse(course) });
    }),
  );

  router.post(
    '/:courseId/archive',
    requireCourseOwnership,
    asyncHandler(async (req, res) => {
      const before = await prisma.course.findUniqueOrThrow({ where: { id: req.params.courseId }, include: { classes: true } });
      const course = await prisma.course.update({ where: { id: before.id }, data: { status: 'ARCHIVED' }, include: { classes: true } });
      await audit(req, 'COURSE_ARCHIVED', 'Course', course.id, course, before);
      res.json({ success: true, course: publicCourse(course) });
    }),
  );

  router.delete(
    '/:courseId',
    requireCourseOwnership,
    asyncHandler(async (req, res) => {
      const before = await prisma.course.findUniqueOrThrow({
        where: { id: req.params.courseId },
        include: { enrollments: { take: 1 }, orderItems: { take: 1 } },
      });
      if (before.enrollments.length || before.orderItems.length) throw new ConflictError('Curso com histórico comercial deve ser arquivado, não excluído');
      await prisma.course.delete({ where: { id: before.id } });
      await audit(req, 'COURSE_DELETED', 'Course', before.id, { deleted: true }, before);
      res.json({ success: true });
    }),
  );

  router.get(
    '/:courseId/enrollments',
    requireCourseOwnership,
    asyncHandler(async (req, res) => {
      const parsed = paginationSchema.safeParse(req.query);
      if (!parsed.success) throw new ValidationError('Parâmetros de paginação inválidos', parsed.error.flatten());
      const { page, pageSize } = parsed.data;
      const where = { courseId: req.params.courseId };
      const [total, enrollments] = await Promise.all([
        prisma.enrollment.count({ where }),
        prisma.enrollment.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: { user: { select: { id: true, name: true, email: true } }, class: { select: { id: true, name: true } } },
        }),
      ]);
      res.json({ success: true, page, pageSize, total, enrollments });
    }),
  );

  router.patch(
    '/:courseId/enrollments/:enrollmentId',
    requireCourseOwnership,
    requireEnrollmentOwnership,
    asyncHandler(async (req, res) => {
      const parsed = enrollmentStatusSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('Status de inscrição inválido', parsed.error.flatten());
      const before = await prisma.enrollment.findUniqueOrThrow({ where: { id: req.params.enrollmentId } });
      // Matrícula expirada é um estado controlado pelo sistema (accessDurationDays); docente não reabre manualmente.
      if (before.status === EnrollmentStatus.EXPIRED) throw new ConflictError('Inscrição expirada não pode ser alterada manualmente');
      const data: Prisma.EnrollmentUpdateInput = { status: parsed.data.status };
      if (parsed.data.status === EnrollmentStatus.COMPLETED) data.completedAt = new Date();
      const updated = await prisma.enrollment.update({ where: { id: before.id }, data });
      await audit(req, 'ENROLLMENT_STATUS_UPDATED', 'Enrollment', updated.id, updated, before);
      res.json({ success: true, enrollment: updated });
    }),
  );

  router.get(
    '/:courseId/enrollments/export',
    requireCourseOwnership,
    sensitiveRateLimiter,
    asyncHandler(async (req, res) => {
      const enrollments = await prisma.enrollment.findMany({
        where: { courseId: req.params.courseId },
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { name: true, email: true } }, class: { select: { name: true } } },
      });
      const csv = toCsv(
        ['Nome', 'Email', 'Turma', 'Status', 'Progresso (%)', 'Início', 'Conclusão'],
        enrollments.map((enrollment) => [
          enrollment.user.name,
          enrollment.user.email,
          enrollment.class?.name ?? '',
          enrollment.status,
          enrollment.progressPercent,
          enrollment.startedAt?.toISOString() ?? '',
          enrollment.completedAt?.toISOString() ?? '',
        ]),
      );
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="inscricoes-${req.params.courseId}.csv"`);
      res.send(`\uFEFF${csv}`);
    }),
  );

  return router;
};
