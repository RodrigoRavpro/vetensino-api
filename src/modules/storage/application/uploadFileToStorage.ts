import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { env } from '../../../config/env';
import { logger } from '../../../config/logger';
import { s3Client } from '../../../infrastructure/storage/s3';
import { buildPublicS3Url, normalizeStorageKey } from './storagePaths';

export type StorageUploadOptions = {
  key: string;
  buffer: Buffer;
  contentType: string;
  acl?: 'public-read' | 'private';
};

export const uploadFileToStorage = async ({
  key,
  buffer,
  contentType,
  acl = 'public-read',
}: StorageUploadOptions): Promise<{ url: string; key: string }> => {
  if (!s3Client) {
    throw new Error('S3 não configurado. Defina AWS_ACCESS_KEY_ID e AWS_SECRET_ACCESS_KEY.');
  }

  const normalizedKey = normalizeStorageKey(key);

  await s3Client.send(
    new PutObjectCommand({
      Bucket: env.storage.bucket,
      Key: normalizedKey,
      Body: buffer,
      ContentType: contentType,
      ACL: acl,
    }),
  );

  const url = buildPublicS3Url(normalizedKey, env.storage.region, env.storage.bucket);

  logger.info('Arquivo enviado para o bucket do portal de cursos', {
    key: normalizedKey,
    bucket: env.storage.bucket,
    url,
    contentType,
  });

  return { url, key: normalizedKey };
};

export const deleteFileFromStorage = async (key: string): Promise<void> => {
  if (!s3Client) {
    throw new Error('S3 não configurado. Defina AWS_ACCESS_KEY_ID e AWS_SECRET_ACCESS_KEY.');
  }

  const normalizedKey = normalizeStorageKey(key);

  await s3Client.send(
    new DeleteObjectCommand({
      Bucket: env.storage.bucket,
      Key: normalizedKey,
    }),
  );

  logger.info('Arquivo removido do bucket do portal de cursos', {
    key: normalizedKey,
    bucket: env.storage.bucket,
  });
};
