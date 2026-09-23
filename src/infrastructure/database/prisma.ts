import { PrismaClient } from '@prisma/client';
import { env } from '../../config/env';
import { logger } from '../../config/logger';

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

const createClient = (): PrismaClient =>
  new PrismaClient({
    log: env.isProduction ? ['error'] : ['error', 'warn'],
  });

// Reaproveita a instância entre hot reloads do tsx para não esgotar o pool.
export const prisma = globalThis.__prisma ?? createClient();

if (!env.isProduction) {
  globalThis.__prisma = prisma;
}

export const connectDatabase = async (): Promise<void> => {
  await prisma.$connect();
  logger.info('Conectado ao PostgreSQL');
};

export const disconnectDatabase = async (): Promise<void> => {
  await prisma.$disconnect();
};
