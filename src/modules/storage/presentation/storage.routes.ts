import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../shared/http/asyncHandler';
import { ForbiddenError, ValidationError } from '../../../shared/errors/AppError';
import { uploadFileToStorage } from '../application/uploadFileToStorage';
import { authenticate, requireRole } from '../../../shared/http/auth';
import { UserRole } from '@prisma/client';

const uploadSchema = z.object({
  file: z.object({
    base64: z.string().min(1),
    fileName: z.string().min(1),
    mimeType: z.string().min(1),
    size: z.number().positive().optional(),
  }),
  folder: z.string().min(1).optional(),
  key: z.string().min(1).optional(),
});

export const buildStorageRoutes = (): Router => {
  const router = Router();
  router.use(authenticate, requireRole(UserRole.ADMIN, UserRole.TEACHER));

  router.post(
    '/upload',
    asyncHandler(async (req, res) => {
      const parsed = uploadSchema.safeParse(req.body);

      if (!parsed.success) {
        throw new ValidationError('Payload inválido para upload de arquivo', parsed.error.flatten());
      }

      const { file, folder, key } = parsed.data;
      const base64 = file.base64.replace(/^data:.*;base64,/, '');
      const buffer = Buffer.from(base64, 'base64');
      const allowedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
      if (!allowedMimeTypes.has(file.mimeType)) {
        throw new ValidationError('Tipo de arquivo não permitido');
      }
      if (buffer.length > 10 * 1024 * 1024 || (file.size && file.size !== buffer.length)) {
        throw new ValidationError('Arquivo excede o limite permitido');
      }
      if (key || folder) {
        throw new ForbiddenError('A chave de storage é definida pelo servidor');
      }
      const safeName = file.fileName.replace(/[^a-zA-Z0-9._-]/g, '-');
      const targetKey = `admin/${req.auth?.id}/${Date.now()}-${safeName}`;

      const result = await uploadFileToStorage({
        key: targetKey,
        buffer,
        contentType: file.mimeType,
        acl: 'private',
      });

      res.status(201).json({
        success: true,
        url: result.url,
        key: result.key,
        originalName: file.fileName,
        mimeType: file.mimeType,
        size: file.size ?? buffer.length,
      });
    }),
  );

  return router;
};
