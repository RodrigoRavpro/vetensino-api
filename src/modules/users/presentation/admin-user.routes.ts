import { Router, type Request } from 'express';
import bcrypt from 'bcryptjs';
import { Prisma, UserRole } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../../infrastructure/database/prisma';
import { asyncHandler } from '../../../shared/http/asyncHandler';
import { authenticate, requireRole } from '../../../shared/http/auth';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/errors/AppError';

const passwordSchema = z.string().min(8).refine((value) => Buffer.byteLength(value, 'utf8') <= 72, 'A senha deve ter no máximo 72 bytes');

const createUserSchema = z.object({
  name: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(240),
  password: passwordSchema,
  role: z.nativeEnum(UserRole).default(UserRole.STUDENT),
  cpf: z.string().trim().min(11).max(14).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  bio: z.string().trim().max(2_000).optional().nullable(),
  isActive: z.boolean().default(true),
});

const updateUserSchema = createUserSchema.partial().extend({
  password: passwordSchema.optional(),
});

const publicUser = (user: {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  cpf: string | null;
  phone: string | null;
  bio: string | null;
  isActive: boolean;
  emailVerifiedAt: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  cpf: user.cpf,
  phone: user.phone,
  bio: user.bio,
  isActive: user.isActive,
  emailVerifiedAt: user.emailVerifiedAt,
  lastLoginAt: user.lastLoginAt,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

const userSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  cpf: true,
  phone: true,
  bio: true,
  isActive: true,
  emailVerifiedAt: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

type PublicUser = Prisma.UserGetPayload<{ select: typeof userSelect }>;

const auditJson = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value, (_key, item: unknown) => (typeof item === 'bigint' ? item.toString() : item))) as Prisma.InputJsonValue;

const audit = async (req: Request, action: string, entityId: string, after: unknown, before?: unknown): Promise<void> => {
  if (!req.auth) return;
  await prisma.auditLog.create({
    data: {
      actorId: req.auth.id,
      actorEmail: req.auth.email,
      actorRole: req.auth.role,
      action,
      entityType: 'User',
      entityId,
      before: before === undefined ? undefined : auditJson(before),
      after: auditJson(after),
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    },
  });
};

export const buildAdminUserRoutes = (): Router => {
  const router = Router();
  router.use(authenticate, requireRole(UserRole.ADMIN));

  router.get('/', asyncHandler(async (req, res) => {
    const query = z.object({
      search: z.string().trim().max(120).optional(),
      role: z.nativeEnum(UserRole).optional(),
      isActive: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
      page: z.coerce.number().int().positive().default(1),
      limit: z.coerce.number().int().positive().max(100).default(20),
    }).parse(req.query);

    const where: Prisma.UserWhereInput = {
      ...(query.role ? { role: query.role } : {}),
      ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
      ...(query.search ? { OR: [{ name: { contains: query.search, mode: 'insensitive' } }, { email: { contains: query.search, mode: 'insensitive' } }] } : {}),
    };
    const [total, users] = await prisma.$transaction([
      prisma.user.count({ where }),
      prisma.user.findMany({ where, select: userSelect, orderBy: { createdAt: 'desc' }, skip: (query.page - 1) * query.limit, take: query.limit }),
    ]);

    res.json({ success: true, users: users.map(publicUser), pagination: { page: query.page, limit: query.limit, total, pages: Math.ceil(total / query.limit) } });
  }));

  router.get('/:userId', asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.params.userId }, select: userSelect });
    if (!user) throw new NotFoundError('Usuário não encontrado');
    res.json({ success: true, user: publicUser(user) });
  }));

  router.post('/', asyncHandler(async (req, res) => {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('Dados do usuário inválidos', parsed.error.flatten());
    const input = parsed.data;
    const email = input.email.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) throw new ConflictError('E-mail já cadastrado');

    const user = await prisma.user.create({
      data: { ...input, email, password: await bcrypt.hash(input.password, 12) },
      select: userSelect,
    });
    await audit(req, 'USER_CREATED', user.id, publicUser(user));
    res.status(201).json({ success: true, user: publicUser(user) });
  }));

  router.patch('/:userId', asyncHandler(async (req, res) => {
    const parsed = updateUserSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('Dados do usuário inválidos', parsed.error.flatten());
    const before = await prisma.user.findUnique({ where: { id: req.params.userId }, select: userSelect });
    if (!before) throw new NotFoundError('Usuário não encontrado');

    const input = parsed.data;
    const email = input.email?.toLowerCase();
    if (email && email !== before.email) {
      const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
      if (existing) throw new ConflictError('E-mail já cadastrado');
    }
    const { password, ...profile } = input;
    const user = await prisma.user.update({
      where: { id: before.id },
      data: { ...profile, ...(email ? { email } : {}), ...(password ? { password: await bcrypt.hash(password, 12) } : {}) },
      select: userSelect,
    });
    await audit(req, 'USER_UPDATED', user.id, publicUser(user), publicUser(before));
    res.json({ success: true, user: publicUser(user) });
  }));

  router.delete('/:userId', asyncHandler(async (req, res) => {
    if (req.auth?.id === req.params.userId) throw new ValidationError('O administrador atual não pode desativar a própria conta');
    const before = await prisma.user.findUnique({ where: { id: req.params.userId }, select: userSelect });
    if (!before) throw new NotFoundError('Usuário não encontrado');
    const user = await prisma.user.update({ where: { id: before.id }, data: { isActive: false }, select: userSelect });
    await prisma.userSession.updateMany({ where: { userId: user.id, isActive: true }, data: { isActive: false, revokedAt: new Date() } });
    await audit(req, 'USER_DEACTIVATED', user.id, publicUser(user), publicUser(before));
    res.json({ success: true, user: publicUser(user) });
  }));

  return router;
};
