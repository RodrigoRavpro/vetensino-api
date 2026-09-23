import type { HealthProbe } from './ports/HealthProbe';

export interface HealthStatus {
  status: 'ok' | 'degraded';
  service: string;
  version: string;
  environment: string;
  uptimeSeconds: number;
  timestamp: string;
  dependencies: Record<string, 'up' | 'down'>;
}

export class GetHealthStatusUseCase {
  constructor(
    private readonly probes: HealthProbe[],
    private readonly service: string,
    private readonly version: string,
    private readonly environment: string,
  ) {}

  async execute(): Promise<HealthStatus> {
    const results = await Promise.all(
      this.probes.map(async (probe) => {
        const healthy = await probe.check().catch(() => false);
        return [probe.name, healthy ? ('up' as const) : ('down' as const)] as const;
      }),
    );

    const dependencies = Object.fromEntries(results);
    const allUp = results.every(([, state]) => state === 'up');

    return {
      status: allUp ? 'ok' : 'degraded',
      service: this.service,
      version: this.version,
      environment: this.environment,
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      dependencies,
    };
  }
}
