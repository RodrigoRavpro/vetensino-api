/** Port de verificação de dependências externas, implementado na infrastructure. */
export interface HealthProbe {
  readonly name: string;
  check(): Promise<boolean>;
}
