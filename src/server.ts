process.env.TZ = 'America/Sao_Paulo';

import { createApp } from './app';
import { env } from './config/env';
import { logger } from './config/logger';
import { buildContainer } from './container';
import { connectDatabase, disconnectDatabase } from './infrastructure/database/prisma';

const bootstrap = async (): Promise<void> => {
  await connectDatabase();

  const container = buildContainer();
  const app = createApp(container);

  const server = app.listen(env.port, () => {
    logger.info(`vetensino-api ouvindo na porta ${env.port} (${env.nodeEnv})`);
  });

  const shutdown = (signal: string) => async (): Promise<void> => {
    logger.info(`Recebido ${signal}, encerrando...`);
    server.close(async () => {
      await disconnectDatabase();
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown('SIGTERM'));
  process.on('SIGINT', shutdown('SIGINT'));
};

bootstrap().catch((error) => {
  logger.error('Falha ao inicializar a API', { error });
  process.exit(1);
});
