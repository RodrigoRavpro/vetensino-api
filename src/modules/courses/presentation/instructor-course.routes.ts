import { randomUUID } from 'node:crypto';
import express, { Router } from 'express';
import { z } from 'zod';
import { EnrollmentStatus, ManualPaymentMethod, OrderStatus, Prisma, UserRole } from '@prisma/client';
import { prisma } from '../../../infrastructure/database/prisma';
import { deleteFileFromStorage, uploadFileToStorage } from '../../storage/application/uploadFileToStorage';
import { sendAccessInvite, sendEnrollmentConfirmation } from '../../auth/application/passwordTokens';
import { buildPublicS3Url } from '../../storage/application/storagePaths';
import { env } from '../../../config/env';
import { asyncHandler } from '../../../shared/http/asyncHandler';
import { authenticate, requireRole } from '../../../shared/http/auth';
import { requireClassOwnership, requireCourseOwnership, requireEnrollmentOwnership } from '../../../shared/http/ownership';
import { sensitiveRateLimiter } from '../../../shared/http/security';
import { AppError, ConflictError, NotFoundError, ValidationError } from '../../../shared/errors/AppError';
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

const agreementFields = {
  negotiatedPrice: z.number().nonnegative().finite().max(1_000_000),
  paymentMethod: z.nativeEnum(ManualPaymentMethod),
  installments: z.number().int().min(1).max(48),
  amountPaid: z.number().nonnegative().finite().max(1_000_000),
  notes: z.string().trim().max(2_000).optional().nullable(),
};

const convertPreRegistrationSchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    classId: z.string().uuid().optional().nullable(),
    ...agreementFields,
    installments: agreementFields.installments.default(1),
  })
  .strict()
  .refine((input) => input.amountPaid <= input.negotiatedPrice, { message: 'Valor pago não pode exceder o preço negociado', path: ['amountPaid'] });

const updateAgreementSchema = z.object(agreementFields).partial().strict();

const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const MAX_DOCUMENTS_PER_ENROLLMENT = 20;
// Assinatura binária confere o conteúdo real; o Content-Type do cliente não é confiável sozinho.
const documentSignatures: Record<string, (buffer: Buffer) => boolean> = {
  'application/pdf': (buffer) => buffer.subarray(0, 4).toString('latin1') === '%PDF',
  'image/png': (buffer) => buffer.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
  'image/jpeg': (buffer) => buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])),
  'image/webp': (buffer) => buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP',
};
const documentExtensions: Record<string, string> = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const rawDocumentParser = express.raw({ type: Object.keys(documentSignatures), limit: MAX_DOCUMENT_BYTES });

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
          include: { user: { select: { id: true, name: true, email: true } }, class: { select: { id: true, name: true } }, agreement: { select: { id: true, _count: { select: { documents: true } } } } },
        }),
      ]);
      res.json({ success: true, page, pageSize, total, enrollments });
    }),
  );

  router.get(
    '/:courseId/pre-registrations',
    requireCourseOwnership,
    asyncHandler(async (req, res) => {
      const parsed = paginationSchema.safeParse(req.query);
      if (!parsed.success) throw new ValidationError('Parâmetros de paginação inválidos', parsed.error.flatten());
      const { page, pageSize } = parsed.data;
      const where = { courseId: req.params.courseId };
      const [total, preRegistrations] = await Promise.all([
        prisma.coursePreRegistration.count({ where }),
        prisma.coursePreRegistration.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: { order: { select: { status: true, items: { select: { classId: true }, take: 1 } } } },
        }),
      ]);
      res.json({
        success: true,
        page,
        pageSize,
        total,
        preRegistrations: preRegistrations.map(({ order, ...registration }) => ({
          ...registration,
          orderStatus: order?.status ?? null,
          classId: order?.items[0]?.classId ?? null,
        })),
      });
    }),
  );

  router.post(
    '/:courseId/pre-registrations/:preRegistrationId/convert',
    requireCourseOwnership,
    asyncHandler(async (req, res) => {
      const parsed = convertPreRegistrationSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('Dados da matrícula inválidos', parsed.error.flatten());
      const input = parsed.data;
      const courseId = req.params.courseId as string;

      const result = await prisma.$transaction(async (tx) => {
        const registration = await tx.coursePreRegistration.findFirst({ where: { id: req.params.preRegistrationId, courseId } });
        if (!registration) throw new NotFoundError('Pré-inscrição não encontrada');
        // updateMany condicional evita dupla conversão em requisições concorrentes.
        const claimed = await tx.coursePreRegistration.updateMany({ where: { id: registration.id, convertedAt: null }, data: { convertedAt: new Date() } });
        if (claimed.count === 0) throw new ConflictError('Esta pré-inscrição já foi convertida em matrícula');
        // Pedido de checkout em aberto é cancelado para que um pagamento tardio não gere matrícula duplicada.
        if (registration.orderId) {
          const cancelled = await tx.order.updateMany({ where: { id: registration.orderId, status: OrderStatus.PENDING }, data: { status: OrderStatus.CANCELED, canceledAt: new Date() } });
          if (cancelled.count > 0) await tx.seatReservation.updateMany({ where: { orderId: registration.orderId, status: 'ACTIVE' }, data: { status: 'CANCELED' } });
        }

        if (input.classId) {
          const courseClass = await tx.courseClass.findFirst({ where: { id: input.classId, courseId }, include: { _count: { select: { enrollments: true } } } });
          if (!courseClass) throw new ValidationError('Turma inválida para este curso');
          if (courseClass._count.enrollments >= courseClass.capacity) throw new ConflictError('A turma selecionada não possui vagas');
        }

        const email = registration.email.trim().toLowerCase();
        const user = (await tx.user.findUnique({ where: { email } }))
          ?? (await tx.user.create({ data: { email, name: input.name, phone: registration.phone, role: UserRole.STUDENT, password: null, isActive: true } }));

        const existing = await tx.enrollment.findUnique({ where: { userId_courseId: { userId: user.id, courseId } } });
        if (existing) throw new ConflictError('Este aluno já possui matrícula neste curso');

        const enrollment = await tx.enrollment.create({
          data: { userId: user.id, courseId, classId: input.classId ?? null, status: EnrollmentStatus.ACTIVE, startedAt: new Date() },
        });
        const agreement = await tx.enrollmentAgreement.create({
          data: {
            enrollmentId: enrollment.id,
            preRegistrationId: registration.id,
            negotiatedPrice: new Prisma.Decimal(input.negotiatedPrice),
            paymentMethod: input.paymentMethod,
            installments: input.installments,
            amountPaid: new Prisma.Decimal(input.amountPaid),
            notes: input.notes || null,
            createdById: req.auth!.id,
          },
        });
        return { enrollment, agreement, user };
      });

      const course = await prisma.course.findUniqueOrThrow({ where: { id: courseId }, select: { title: true } });
      const emailSent = result.user.password
        ? await sendEnrollmentConfirmation(result.user, course.title)
        : await sendAccessInvite(result.user, course.title);

      await audit(req, 'PRE_REGISTRATION_CONVERTED', 'Enrollment', result.enrollment.id, { enrollment: result.enrollment, agreement: result.agreement, emailSent });
      res.status(201).json({
        success: true,
        emailSent,
        enrollment: result.enrollment,
        agreement: { ...result.agreement, negotiatedPrice: result.agreement.negotiatedPrice.toString(), amountPaid: result.agreement.amountPaid.toString() },
      });
    }),
  );

  router.post(
    '/:courseId/enrollments/:enrollmentId/invite',
    requireCourseOwnership,
    requireEnrollmentOwnership,
    sensitiveRateLimiter,
    asyncHandler(async (req, res) => {
      const enrollment = await prisma.enrollment.findUniqueOrThrow({
        where: { id: req.params.enrollmentId },
        include: { user: { select: { id: true, name: true, email: true, password: true, isActive: true } }, course: { select: { title: true } } },
      });
      if (enrollment.user.password) throw new ConflictError('Este aluno já definiu uma senha de acesso');
      if (!enrollment.user.isActive) throw new ConflictError('A conta deste aluno está inativa');
      const emailSent = await sendAccessInvite(enrollment.user, enrollment.course.title);
      await audit(req, 'ENROLLMENT_INVITE_SENT', 'Enrollment', enrollment.id, { userId: enrollment.user.id, emailSent });
      if (!emailSent) throw new AppError('Não foi possível enviar o convite por e-mail', 502, 'EMAIL_FAILED');
      res.json({ success: true });
    }),
  );

  router.patch(
    '/:courseId/enrollments/:enrollmentId/agreement',
    requireCourseOwnership,
    requireEnrollmentOwnership,
    asyncHandler(async (req, res) => {
      const parsed = updateAgreementSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError('Dados da negociação inválidos', parsed.error.flatten());
      const before = await prisma.enrollmentAgreement.findUnique({ where: { enrollmentId: req.params.enrollmentId } });
      if (!before) throw new NotFoundError('Esta matrícula não possui dados de negociação');
      const input = parsed.data;
      const negotiatedPrice = input.negotiatedPrice ?? Number(before.negotiatedPrice);
      const amountPaid = input.amountPaid ?? Number(before.amountPaid);
      if (amountPaid > negotiatedPrice) throw new ValidationError('Valor pago não pode exceder o preço negociado');
      const updated = await prisma.enrollmentAgreement.update({
        where: { id: before.id },
        data: {
          negotiatedPrice: input.negotiatedPrice === undefined ? undefined : new Prisma.Decimal(input.negotiatedPrice),
          amountPaid: input.amountPaid === undefined ? undefined : new Prisma.Decimal(input.amountPaid),
          paymentMethod: input.paymentMethod,
          installments: input.installments,
          notes: input.notes === undefined ? undefined : input.notes || null,
        },
      });
      await audit(req, 'ENROLLMENT_AGREEMENT_UPDATED', 'EnrollmentAgreement', updated.id, updated, before);
      res.json({ success: true });
    }),
  );

  router.delete(
    '/:courseId/enrollments/:enrollmentId/documents/:documentId',
    requireCourseOwnership,
    requireEnrollmentOwnership,
    asyncHandler(async (req, res) => {
      const document = await prisma.enrollmentDocument.findFirst({ where: { id: req.params.documentId, agreement: { enrollmentId: req.params.enrollmentId } } });
      if (!document) throw new NotFoundError('Documento não encontrado');
      await deleteFileFromStorage(document.storageKey);
      await prisma.enrollmentDocument.delete({ where: { id: document.id } });
      await audit(req, 'ENROLLMENT_DOCUMENT_DELETED', 'EnrollmentDocument', document.id, { deleted: true }, document);
      res.json({ success: true });
    }),
  );

  router.get(
    '/:courseId/enrollments/:enrollmentId/agreement',
    requireCourseOwnership,
    requireEnrollmentOwnership,
    asyncHandler(async (req, res) => {
      const agreement = await prisma.enrollmentAgreement.findUnique({
        where: { enrollmentId: req.params.enrollmentId },
        include: {
          createdBy: { select: { name: true } },
          enrollment: { select: { user: { select: { password: true } } } },
          documents: { orderBy: { createdAt: 'asc' }, select: { id: true, originalName: true, storageKey: true, mimeType: true, sizeBytes: true, createdAt: true } },
        },
      });
      if (!agreement) throw new NotFoundError('Esta matrícula não possui dados de negociação');
      res.json({
        success: true,
        agreement: {
          id: agreement.id,
          negotiatedPrice: agreement.negotiatedPrice.toString(),
          amountPaid: agreement.amountPaid.toString(),
          paymentMethod: agreement.paymentMethod,
          installments: agreement.installments,
          notes: agreement.notes,
          createdAt: agreement.createdAt,
          createdBy: agreement.createdBy.name,
          studentHasAccess: Boolean(agreement.enrollment.user.password),
          documents: agreement.documents.map(({ storageKey, ...document }) => ({
            ...document,
            url: buildPublicS3Url(storageKey, env.storage.region, env.storage.bucket),
          })),
        },
      });
    }),
  );

  router.post(
    '/:courseId/enrollments/:enrollmentId/documents',
    requireCourseOwnership,
    requireEnrollmentOwnership,
    rawDocumentParser,
    asyncHandler(async (req, res) => {
      const mimeType = (req.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
      const buffer = req.body as unknown;
      if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new ValidationError('Envie um arquivo PDF, JPG, PNG ou WEBP');
      const matchesSignature = documentSignatures[mimeType];
      if (!matchesSignature || !matchesSignature(buffer)) throw new ValidationError('Conteúdo do arquivo não corresponde a um tipo permitido');

      const rawName = typeof req.query.fileName === 'string' ? req.query.fileName : '';
      const originalName = rawName.trim().slice(0, 200) || `documento.${documentExtensions[mimeType]}`;

      const agreement = await prisma.enrollmentAgreement.findUnique({
        where: { enrollmentId: req.params.enrollmentId },
        include: { _count: { select: { documents: true } } },
      });
      if (!agreement) throw new ConflictError('Documentos só podem ser anexados a matrículas manuais');
      if (agreement._count.documents >= MAX_DOCUMENTS_PER_ENROLLMENT) throw new ConflictError('Limite de documentos atingido para esta matrícula');

      // Nome original nunca compõe a chave: evita path traversal e colisões.
      const storageKey = `enrollment-documents/${req.params.courseId}/${agreement.enrollmentId}/${randomUUID()}.${documentExtensions[mimeType]}`;
      await uploadFileToStorage({ key: storageKey, buffer, contentType: mimeType });
      const document = await prisma.enrollmentDocument.create({
        data: { agreementId: agreement.id, uploadedById: req.auth!.id, originalName, storageKey, mimeType, sizeBytes: buffer.length },
        select: { id: true, originalName: true, mimeType: true, sizeBytes: true, createdAt: true },
      });
      await audit(req, 'ENROLLMENT_DOCUMENT_UPLOADED', 'EnrollmentDocument', document.id, document);
      res.status(201).json({ success: true, document });
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
      const [enrollments, preRegistrations] = await Promise.all([
        prisma.enrollment.findMany({
          where: { courseId: req.params.courseId },
          orderBy: { createdAt: 'desc' },
          include: { user: { select: { name: true, email: true } }, class: { select: { name: true } } },
        }),
        prisma.coursePreRegistration.findMany({ where: { courseId: req.params.courseId }, orderBy: { createdAt: 'desc' } }),
      ]);
      const csv = toCsv(
        ['Tipo', 'Nome', 'Email', 'Telefone', 'Empresa', 'Turma', 'Status', 'Progresso (%)', 'Data'],
        [
          ...enrollments.map((enrollment) => [
            'Matrícula', enrollment.user.name, enrollment.user.email, '', '', enrollment.class?.name ?? '', enrollment.status,
            enrollment.progressPercent, enrollment.createdAt.toISOString(),
          ]),
          ...preRegistrations.map((registration) => [
            registration.source === 'CHECKOUT' ? 'Checkout não pago' : 'Pré-inscrição', registration.name ?? '', registration.email, registration.phone ?? '', registration.company ?? '', '',
            'Pendente', '', registration.createdAt.toISOString(),
          ]),
        ],
      );
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="inscricoes-${req.params.courseId}.csv"`);
      res.send(`\uFEFF${csv}`);
    }),
  );

  return router;
};
