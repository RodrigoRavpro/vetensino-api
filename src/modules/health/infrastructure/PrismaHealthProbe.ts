import type { PrismaClient } from '@prisma/client';
import type { HealthProbe } from '../application/ports/HealthProbe';

export class PrismaHealthProbe implements HealthProbe {
  readonly name = 'database';

  constructor(private readonly prisma: PrismaClient) {}

  async check(): Promise<boolean> {
    await this.prisma.$queryRaw`SELECT 1`;
    return true;
  }
}
