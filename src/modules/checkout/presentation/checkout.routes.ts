import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../../../infrastructure/database/prisma';
import { env } from '../../../config/env';
import { asyncHandler } from '../../../shared/http/asyncHandler';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/errors/AppError';
import { createFinpetOrder, getFinpetOrder } from '../infrastructure/finpetGateway';

const checkoutSchema = z.object({
  courseId: z.string().uuid(),
  classId: z.string().uuid(),
  name: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(240),
  cpf: z.string().trim().min(11).max(14).optional(),
  paymentMethod: z.enum(['PIX', 'CREDIT_CARD']).default('PIX'),
});

export const buildCheckoutRoutes = (): Router => {
  const router = Router();

  router.post('/orders', asyncHandler(async (req, res) => {
    const parsed = checkoutSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('Dados do checkout inválidos', parsed.error.flatten());
    const input = parsed.data;
    const now = new Date();
    const reservationExpiresAt = new Date(now.getTime() + 15 * 60 * 1000);

    const result = await prisma.$transaction(async (transaction) => {
      const course = await transaction.course.findFirst({ where: { id: input.courseId, status: 'PUBLISHED' }, include: { classes: { where: { id: input.classId } } } });
      const courseClass = course?.classes[0];
      if (!course || !courseClass || courseClass.status === 'CANCELED' || courseClass.status === 'CLOSED') throw new NotFoundError('Curso ou turma não disponível');
      if (courseClass.enrollmentStartsAt && courseClass.enrollmentStartsAt > now) throw new ConflictError('As inscrições ainda não começaram');
      if (courseClass.enrollmentEndsAt && courseClass.enrollmentEndsAt < now) throw new ConflictError('As inscrições desta turma foram encerradas');

      const activeReservations = await transaction.seatReservation.count({ where: { classId: courseClass.id, status: 'ACTIVE', expiresAt: { gt: now } } });
      const confirmedEnrollments = await transaction.enrollment.count({ where: { classId: courseClass.id, status: { in: ['ACTIVE', 'COMPLETED'] } } });
      if (activeReservations + confirmedEnrollments >= courseClass.capacity) {
        const lastPosition = await transaction.waitlistEntry.findFirst({ where: { classId: courseClass.id }, orderBy: { position: 'desc' }, select: { position: true } });
        const entry = await transaction.waitlistEntry.create({ data: { classId: courseClass.id, email: input.email.toLowerCase(), name: input.name, position: (lastPosition?.position ?? 0) + 1 } });
        return { kind: 'WAITLIST' as const, position: entry.position, className: courseClass.name };
      }

      const publicId = `curord_${crypto.randomUUID().replaceAll('-', '')}`;
      const price = course.promoPrice ?? course.price;
      const order = await transaction.order.create({ data: { publicId, guestEmail: input.email.toLowerCase(), guestName: input.name, status: 'PENDING', subtotal: price, total: price, items: { create: { courseId: course.id, classId: courseClass.id, courseTitle: course.title, unitPrice: price } }, payments: { create: { externalId: `local_${crypto.randomUUID()}`, method: input.paymentMethod, amount: price, provider: env.payments.isConfigured ? 'FINPET' : 'LOCAL' } }, reservations: { create: { classId: courseClass.id, email: input.email.toLowerCase(), expiresAt: reservationExpiresAt } } }, select: { id: true, publicId: true, total: true, payments: { select: { id: true } } } });
      const payment = order.payments[0];
      if (!payment) throw new Error('Pagamento não criado para o pedido');
      return { kind: 'CHECKOUT' as const, orderId: order.id, paymentId: payment.id, publicId: order.publicId, total: order.total.toString(), reservationExpiresAt, className: courseClass.name, courseTitle: course.title };
    });

    if (result.kind === 'WAITLIST') {
      res.status(202).json({ success: true, status: 'WAITLISTED', position: result.position, className: result.className, message: 'Turma lotada. Você entrou na fila de espera.' });
      return;
    }
    let checkoutUrl = `${env.urls.web}/checkout/${result.publicId}`;
    let provider = 'LOCAL';
    if (env.payments.isConfigured) {
      const providerOrder = await createFinpetOrder({ reference: result.publicId, amount: result.total, customerName: input.name, customerDocument: input.cpf, description: result.courseTitle, redirectUrl: `${env.payments.providerReturnBaseUrl || env.urls.api}/api/rest/checkout/return/${result.publicId}` });
      await prisma.payment.update({ where: { id: result.paymentId }, data: { externalId: providerOrder.uuid, checkoutUrl: providerOrder.payUrl, status: providerOrder.status === 'APPROVED' ? 'APPROVED' : 'PENDING' } });
      checkoutUrl = providerOrder.payUrl;
      provider = 'FINPET';
    }
    res.status(201).json({ success: true, status: 'PAYMENT_PENDING', checkout: { publicId: result.publicId, total: result.total, className: result.className, reservationExpiresAt: result.reservationExpiresAt, checkoutUrl, provider } });
  }));

  router.get('/orders/:publicId', asyncHandler(async (req, res) => {
    const order = await prisma.order.findUnique({ where: { publicId: req.params.publicId }, include: { payments: { orderBy: { createdAt: 'desc' }, take: 1 }, reservations: { orderBy: { createdAt: 'desc' }, take: 1 } } });
    if (!order) throw new NotFoundError('Pedido não encontrado');
    res.json({ success: true, order: { publicId: order.publicId, status: order.status, paymentStatus: order.payments[0]?.status ?? null, provider: order.payments[0]?.provider ?? 'LOCAL', checkoutUrl: order.payments[0]?.checkoutUrl ?? null, reservationExpiresAt: order.reservations[0]?.expiresAt ?? null } });
  }));

  router.get('/return/:publicId', asyncHandler(async (req, res) => {
    const order = await prisma.order.findUnique({ where: { publicId: req.params.publicId }, include: { payments: { orderBy: { createdAt: 'desc' }, take: 1 } } });
    if (!order) throw new NotFoundError('Pedido não encontrado');
    if (env.payments.isConfigured && order.payments[0]?.status === 'PENDING' && order.payments[0]?.externalId) {
      const providerOrder = await getFinpetOrder(order.payments[0].externalId);
      await syncPaymentFromProvider(order.publicId, providerOrder.status);
    }
    const refreshed = await prisma.order.findUnique({ where: { publicId: order.publicId }, include: { payments: { orderBy: { createdAt: 'desc' }, take: 1 } } });
    res.json({ success: true, status: refreshed?.status, paymentStatus: refreshed?.payments[0]?.status });
  }));

  return router;
};

const syncPaymentFromProvider = async (publicId: string, status: string): Promise<void> => {
  const normalized = String(status).toUpperCase();
  const paymentStatus = normalized === 'APPROVED' ? 'APPROVED' : normalized === 'CANCELED' ? 'REJECTED' : 'PENDING';
  await prisma.$transaction(async (transaction) => {
    const order = await transaction.order.findUnique({ where: { publicId }, include: { payments: { orderBy: { createdAt: 'desc' }, take: 1 }, reservations: { orderBy: { createdAt: 'desc' }, take: 1 }, items: true } });
    if (!order || !order.payments[0]) return;
    await transaction.payment.update({ where: { id: order.payments[0].id }, data: { status: paymentStatus, paidAt: paymentStatus === 'APPROVED' ? new Date() : undefined } });
    if (paymentStatus === 'APPROVED') {
      await transaction.order.update({ where: { id: order.id }, data: { status: 'PAID', paidAt: new Date() } });
      let userId = order.userId;
      if (!userId && order.guestEmail) {
        const user = await transaction.user.upsert({ where: { email: order.guestEmail }, update: { name: order.guestName || undefined, isActive: true }, create: { email: order.guestEmail, name: order.guestName || 'Aluno', role: 'STUDENT', password: null, isActive: true } });
        userId = user.id;
        await transaction.order.update({ where: { id: order.id }, data: { userId } });
      }
      if (userId && order.items[0]?.classId) await transaction.enrollment.upsert({ where: { userId_classId: { userId, classId: order.items[0].classId } }, update: { status: 'ACTIVE', orderId: order.id }, create: { userId, courseId: order.items[0].courseId, classId: order.items[0].classId, orderId: order.id, status: 'ACTIVE', startedAt: new Date() } });
      if (order.reservations[0]) await transaction.seatReservation.update({ where: { id: order.reservations[0].id }, data: { status: 'CONVERTED' } });
    } else if (paymentStatus === 'REJECTED') {
      await transaction.order.update({ where: { id: order.id }, data: { status: 'FAILED', canceledAt: new Date() } });
      if (order.reservations[0]) await transaction.seatReservation.update({ where: { id: order.reservations[0].id }, data: { status: 'CANCELED' } });
    }
  });
};

export const buildCheckoutWebhookRoutes = (): Router => {
  const router = Router();
  router.post('/finpet', asyncHandler(async (req, res) => {
    const secret = env.payments.webhookSecret || env.payments.webhookAuthToken;
    if (secret && req.get('x-finpet-token') !== secret) return res.status(401).json({ success: false, message: 'Webhook não autorizado' });
    const providerOrderId = String(req.body?.uuid || req.body?.orderUuid || '').trim();
    const status = String(req.body?.status || req.body?.paymentStatus || '').trim();
    if (!providerOrderId || !status) throw new ValidationError('Webhook FINPET inválido');
    const payment = await prisma.payment.findFirst({ where: { externalId: providerOrderId }, include: { order: true } });
    if (!payment) return res.status(202).json({ success: true, ignored: true });
    await syncPaymentFromProvider(payment.order.publicId, status);
    res.json({ success: true });
  }));
  return router;
};
