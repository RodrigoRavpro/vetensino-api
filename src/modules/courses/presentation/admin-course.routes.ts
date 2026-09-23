import { Router } from 'express';
import { z } from 'zod';
import { UserRole } from '@prisma/client';
import { prisma } from '../../../infrastructure/database/prisma';
import { asyncHandler } from '../../../shared/http/asyncHandler';
import { authenticate, requireRole } from '../../../shared/http/auth';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/errors/AppError';
import { audit, publicCourse } from './course.shared';

const ensureTeacher = async (teacherId: string): Promise<void> => {
  const teacher = await prisma.user.findFirst({ where: { id: teacherId, role: UserRole.TEACHER, isActive: true }, select: { id: true } });
  if (!teacher) throw new ValidationError('Selecione um docente ativo para o curso');
};

// Admin não edita conteúdo do curso (isso é responsabilidade do docente em /instructor/courses):
// só pode reatribuir o docente responsável e/ou trocar o status por moderação.
const adminUpdateSchema = z
  .object({
    instructorId: z.string().uuid().optional(),
    status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).optional(),
  })
  .strict()
  .refine((value) => value.instructorId !== undefined || value.status !== undefined, {
    message: 'Informe ao menos instructorId ou status',
  });

export const buildAdminCourseRoutes = (): Router => {
  const router = Router();
  router.use(authenticate, requireRole(UserRole.ADMIN));

  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      const courses = await prisma.course.findMany({
        orderBy: { updatedAt: 'desc' },
        include: {
          instructor: { select: { id: true, name: true, email: true } },
          classes: { orderBy: { startsAt: 'asc' } },
          _count: { select: { enrollments: true } },
        },
      });
      res.json({ success: true, courses: courses.map((course) => ({ ...publicCourse(course), enrollmentsCount: course._count.enrollments })) });
    }),
  );

  // Somente leitura: inclui inscrições para a visão "ver alunos" do admin (sem edição de conteúdo).
  router.get('/:courseId', asyncHandler(async (req, res) => {
    const course = await prisma.course.findUnique({
      where: { id: req.params.courseId },
      include: {
        instructor: { select: { id: true, name: true, email: true } },
        classes: { orderBy: { startsAt: 'asc' } },
        enrollments: { include: { user: { select: { id: true, name: true, email: true } }, class: { select: { id: true, name: true } } } },
      },
    });
    if (!course) throw new NotFoundError('Curso não encontrado');
    res.json({ success: true, course: publicCourse(course) });
  }));

  // Ação administrativa restrita: apenas reatribuir docente e/ou mudar status (moderação).
  // Edição de conteúdo, preço e turmas é exclusiva do docente em /instructor/courses.
  router.patch(
    '/:courseId',
    asyncHandler(async (req, res) => {
      const parsed = adminUpdateSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('Dados inválidos', parsed.error.flatten());
      const before = await prisma.course.findUnique({ where: { id: req.params.courseId } });
      if (!before) throw new NotFoundError('Curso não encontrado');
      const { instructorId, status } = parsed.data;
      if (instructorId !== undefined) await ensureTeacher(instructorId);
      const course = await prisma.course.update({
        where: { id: before.id },
        data: {
          ...(instructorId !== undefined ? { instructor: { connect: { id: instructorId } } } : {}),
          ...(status !== undefined ? { status } : {}),
        },
        include: { classes: true },
      });
      await audit(req, 'COURSE_ADMIN_UPDATED', 'Course', course.id, course, before);
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
