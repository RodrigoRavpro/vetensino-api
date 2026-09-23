import { Router, type Request } from 'express';
import sanitizeHtml from 'sanitize-html';
import { z } from 'zod';
import { Prisma, UserRole } from '@prisma/client';
import { prisma } from '../../../infrastructure/database/prisma';
import { asyncHandler } from '../../../shared/http/asyncHandler';
import { authenticate, requireRole } from '../../../shared/http/auth';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/errors/AppError';

const courseInput = z.object({
  slug: z.string().min(3).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().min(3).max(180),
  subtitle: z.string().max(240).optional().nullable(),
  description: z.string().max(20_000).optional().nullable(),
  coverImageUrl: z.string().url().optional().nullable(),
  price: z.number().nonnegative().finite(),
  promoPrice: z.number().nonnegative().finite().optional().nullable(),
  workloadHours: z.number().int().positive().max(10_000).optional().nullable(),
  accessDurationDays: z.number().int().positive().max(3_650).optional().nullable(),
  certificateEnabled: z.boolean().optional(),
  instructorId: z.string().uuid(),
  contentJson: z.record(z.unknown()).optional().nullable(),
});

const classInput = z.object({
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

const createSchema = courseInput.extend({
  classes: z.array(classInput).max(100).default([]),
});

const updateSchema = courseInput.partial();

const ensureTeacher = async (teacherId: string): Promise<void> => {
  const teacher = await prisma.user.findFirst({ where: { id: teacherId, role: UserRole.TEACHER, isActive: true }, select: { id: true } });
  if (!teacher) throw new ValidationError('Selecione um docente ativo para o curso');
};

const prismaJson = (value: Record<string, unknown> | null | undefined): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined =>
  value === null ? Prisma.JsonNull : value as Prisma.InputJsonValue;

const publicCourse = (course: { id: string; slug: string; title: string; subtitle: string | null; description: string | null; price: Prisma.Decimal; promoPrice: Prisma.Decimal | null; workloadHours: number | null; status: string; certificateEnabled: boolean; classes?: unknown }) => ({
  ...course,
  price: course.price.toString(),
  promoPrice: course.promoPrice?.toString() ?? null,
});

const auditJson = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value, (_key, item: unknown) => (typeof item === 'bigint' ? item.toString() : item))) as Prisma.InputJsonValue;

const audit = async (req: Request, action: string, entityType: string, entityId: string, after: unknown, before?: unknown): Promise<void> => {
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

export const buildAdminCourseRoutes = (): Router => {
  const router = Router();
  router.use(authenticate, requireRole(UserRole.ADMIN));

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      const courses = await prisma.course.findMany({
        orderBy: { updatedAt: 'desc' },
        include: { classes: { orderBy: { startsAt: 'asc' } } },
      });
      res.json({ success: true, courses: courses.map(publicCourse) });
    }),
  );

  router.get('/:courseId', asyncHandler(async (req, res) => {
    const course = await prisma.course.findUnique({ where: { id: req.params.courseId }, include: { classes: { orderBy: { startsAt: 'asc' } }, modules: { include: { lessons: { orderBy: { order: 'asc' } } }, orderBy: { order: 'asc' } } } });
    if (!course) throw new NotFoundError('Curso não encontrado');
    res.json({ success: true, course: publicCourse(course) });
  }));

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('Dados do curso inválidos', parsed.error.flatten());
      const { classes, instructorId, ...input } = parsed.data;
      await ensureTeacher(instructorId);
      const course = await prisma.course.create({
        data: {
          ...input,
          instructor: { connect: { id: instructorId } },
          contentJson: prismaJson(input.contentJson),
          description: input.description ? sanitizeHtml(input.description) : input.description,
          classes: classes.length ? { create: classes } : undefined,
        },
        include: { classes: true },
      });
      await audit(req, 'COURSE_CREATED', 'Course', course.id, course);
      res.status(201).json({ success: true, course: publicCourse(course) });
    }),
  );

  router.post('/:courseId/classes', asyncHandler(async (req, res) => {
    const parsed = classInput.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('Dados da turma inválidos', parsed.error.flatten());
    const course = await prisma.course.findUnique({ where: { id: req.params.courseId }, select: { id: true } });
    if (!course) throw new NotFoundError('Curso não encontrado');
    const created = await prisma.courseClass.create({ data: { ...parsed.data, courseId: course.id } });
    await audit(req, 'COURSE_CLASS_CREATED', 'CourseClass', created.id, created);
    res.status(201).json({ success: true, class: created });
  }));

  router.patch('/:courseId/classes/:classId', asyncHandler(async (req, res) => {
    const parsed = classInput.partial().safeParse(req.body);
    if (!parsed.success) throw new ValidationError('Dados da turma inválidos', parsed.error.flatten());
    const before = await prisma.courseClass.findFirst({ where: { id: req.params.classId, courseId: req.params.courseId } });
    if (!before) throw new NotFoundError('Turma não encontrada');
    const updated = await prisma.courseClass.update({ where: { id: before.id }, data: parsed.data });
    await audit(req, 'COURSE_CLASS_UPDATED', 'CourseClass', updated.id, updated, before);
    res.json({ success: true, class: updated });
  }));

  router.delete('/:courseId/classes/:classId', asyncHandler(async (req, res) => {
    const before = await prisma.courseClass.findFirst({ where: { id: req.params.classId, courseId: req.params.courseId }, include: { enrollments: { take: 1 }, reservations: { take: 1 } } });
    if (!before) throw new NotFoundError('Turma não encontrada');
    if (before.enrollments.length || before.reservations.length) throw new ConflictError('Turma com inscrições ou reservas deve ser encerrada, não excluída');
    await prisma.courseClass.delete({ where: { id: before.id } });
    await audit(req, 'COURSE_CLASS_DELETED', 'CourseClass', before.id, { deleted: true }, before);
    res.json({ success: true });
  }));

  router.patch(
    '/:courseId',
    asyncHandler(async (req, res) => {
      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('Dados do curso inválidos', parsed.error.flatten());
      const before = await prisma.course.findUnique({ where: { id: req.params.courseId } });
      if (!before) throw new NotFoundError('Curso não encontrado');
      const input = parsed.data;
      if (input.instructorId !== undefined) await ensureTeacher(input.instructorId);
      const course = await prisma.course.update({
        where: { id: before.id },
        data: {
          ...(() => {
            const { instructorId, ...profile } = input;
            return { ...profile, ...(instructorId !== undefined ? { instructor: { connect: { id: instructorId } } } : {}), contentJson: prismaJson(profile.contentJson) };
          })(),
          description: input.description === undefined || input.description === null ? input.description : sanitizeHtml(input.description),
        },
        include: { classes: true },
      });
      await audit(req, 'COURSE_UPDATED', 'Course', course.id, course, before);
      res.json({ success: true, course: publicCourse(course) });
    }),
  );

  router.post(
    '/:courseId/publish',
    asyncHandler(async (req, res) => {
      const before = await prisma.course.findUnique({ where: { id: req.params.courseId }, include: { classes: true } });
      if (!before) throw new NotFoundError('Curso não encontrado');
      if (!before.title || !before.price || before.classes.length === 0 || !before.instructorId) {
        throw new ValidationError('O curso precisa de título, preço, docente e pelo menos uma turma antes da publicação');
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

  router.post('/:courseId/archive', asyncHandler(async (req, res) => {
    const before = await prisma.course.findUnique({ where: { id: req.params.courseId }, include: { classes: true } });
    if (!before) throw new NotFoundError('Curso não encontrado');
    const course = await prisma.course.update({ where: { id: before.id }, data: { status: 'ARCHIVED' }, include: { classes: true } });
    await audit(req, 'COURSE_ARCHIVED', 'Course', course.id, course, before);
    res.json({ success: true, course: publicCourse(course) });
  }));

  router.delete('/:courseId', asyncHandler(async (req, res) => {
    const before = await prisma.course.findUnique({ where: { id: req.params.courseId }, include: { enrollments: { take: 1 }, orderItems: { take: 1 } } });
    if (!before) throw new NotFoundError('Curso não encontrado');
    if (before.enrollments.length || before.orderItems.length) throw new ConflictError('Curso com histórico comercial deve ser arquivado, não excluído');
    await prisma.course.delete({ where: { id: before.id } });
    await audit(req, 'COURSE_DELETED', 'Course', before.id, { deleted: true }, before);
    res.json({ success: true });
  }));

  return router;
};
