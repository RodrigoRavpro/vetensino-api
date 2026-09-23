import type { RequestHandler } from 'express';
import { prisma } from '../../infrastructure/database/prisma';
import { NotFoundError } from '../errors/AppError';

/**
 * Gateway de autorização por recurso: roda depois de `authenticate` + `requireRole(TEACHER)`.
 * 404 uniforme (não 403) para "não existe" e "existe mas é de outro docente" — evita
 * confirmar a existência de cursos/turmas/inscrições de terceiros via enumeração de IDs.
 */
export const requireCourseOwnership: RequestHandler = async (req, _res, next) => {
  try {
    const course = await prisma.course.findFirst({
      where: { id: req.params.courseId, instructorId: req.auth!.id },
      select: { id: true },
    });
    if (!course) throw new NotFoundError('Curso não encontrado');
    next();
  } catch (error) {
    next(error);
  }
};

export const requireClassOwnership: RequestHandler = async (req, _res, next) => {
  try {
    const courseClass = await prisma.courseClass.findFirst({
      where: { id: req.params.classId, courseId: req.params.courseId, course: { instructorId: req.auth!.id } },
      select: { id: true },
    });
    if (!courseClass) throw new NotFoundError('Turma não encontrada');
    next();
  } catch (error) {
    next(error);
  }
};

export const requireEnrollmentOwnership: RequestHandler = async (req, _res, next) => {
  try {
    const enrollment = await prisma.enrollment.findFirst({
      where: { id: req.params.enrollmentId, courseId: req.params.courseId, course: { instructorId: req.auth!.id } },
      select: { id: true },
    });
    if (!enrollment) throw new NotFoundError('Inscrição não encontrada');
    next();
  } catch (error) {
    next(error);
  }
};
