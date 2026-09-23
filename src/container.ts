import { prisma } from './infrastructure/database/prisma';
import { GetHealthStatusUseCase } from './modules/health/application/GetHealthStatusUseCase';
import { PrismaHealthProbe } from './modules/health/infrastructure/PrismaHealthProbe';
import { env } from './config/env';
import { APP_VERSION } from './shared/version';

/**
 * Composition root: o único lugar que conhece implementações concretas.
 * Casos de uso recebem apenas interfaces, mantendo a inversão de dependência.
 */
export const buildContainer = () => {
  const healthProbes = [new PrismaHealthProbe(prisma)];

  return {
    prisma,
    useCases: {
      getHealthStatus: new GetHealthStatusUseCase(
        healthProbes,
        'purple-cursos-api',
        APP_VERSION,
        env.nodeEnv,
      ),
    },
  };
};

export type Container = ReturnType<typeof buildContainer>;
