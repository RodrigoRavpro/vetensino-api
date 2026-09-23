import { PutObjectCommand, S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { env } from '../../config/env';
import { logger } from '../../config/logger';

export const s3Client = env.storage.accessKeyId && env.storage.secretAccessKey
  ? new S3Client({
      region: env.storage.region,
      credentials: {
        accessKeyId: env.storage.accessKeyId,
        secretAccessKey: env.storage.secretAccessKey,
      },
    })
  : null;

export const buildS3Key = (path: string): string => {
  const cleanPath = path.replace(/^\/+|\/+$/g, '').replace(/\\/g, '/');
  return cleanPath.replace(/\/+/g, '/');
};

export const getS3PublicUrl = (key: string): string =>
  `https://${env.storage.bucket}.s3.${env.storage.region}.amazonaws.com/${key}`;

export const uploadToS3 = async ({
  buffer,
  key,
  contentType,
}: {
  buffer: Buffer;
  key: string;
  contentType: string;
}): Promise<string> => {
  if (!s3Client) {
    throw new Error('S3 não configurado. Defina AWS_ACCESS_KEY_ID e AWS_SECRET_ACCESS_KEY.');
  }

  const s3Key = buildS3Key(key);

  // O bucket usa "Bucket owner enforced"; acesso público é via bucket policy, não ACL de objeto.
  await s3Client.send(
    new PutObjectCommand({
      Bucket: env.storage.bucket,
      Key: s3Key,
      Body: buffer,
      ContentType: contentType,
    }),
  );

  const url = getS3PublicUrl(s3Key);
  logger.info('Arquivo enviado para S3', { key: s3Key, url, contentType });
  return url;
};

export const deleteFromS3 = async (key: string): Promise<void> => {
  if (!s3Client) {
    throw new Error('S3 não configurado. Defina AWS_ACCESS_KEY_ID e AWS_SECRET_ACCESS_KEY.');
  }

  const s3Key = buildS3Key(key);

  await s3Client.send(
    new DeleteObjectCommand({
      Bucket: env.storage.bucket,
      Key: s3Key,
    }),
  );

  logger.info('Arquivo removido do S3', { key: s3Key });
};
