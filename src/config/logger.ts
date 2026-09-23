import winston from 'winston';
import { env } from './env';

const REDACTED = '[redacted]';

/// Campos que jamais podem aparecer em log, mesmo por acidente de spread.
const SENSITIVE_KEYS = new Set([
  'password',
  'passwordhash',
  'token',
  'tokenhash',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'cookie',
  'apikey',
  'secret',
  'cpf',
  'qrcode',
  'qrcodebase64',
]);

const redact = (value: unknown, depth = 0): unknown => {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      SENSITIVE_KEYS.has(key.toLowerCase()) ? REDACTED : redact(item, depth + 1),
    ]),
  );
};

const redactFormat = winston.format((info) => {
  // Muta o mesmo objeto (em vez de reconstruir com Object.fromEntries) para
  // preservar os Symbols internos do winston (level/message), sem os quais
  // o pipeline de formatação para de escrever qualquer log silenciosamente.
  for (const key of Object.keys(info)) {
    (info as Record<string, unknown>)[key] = SENSITIVE_KEYS.has(key.toLowerCase())
      ? REDACTED
      : redact((info as Record<string, unknown>)[key], 1);
  }
  return info as winston.Logform.TransformableInfo;
});

export const logger = winston.createLogger({
  level: env.logLevel,
  format: winston.format.combine(
    redactFormat(),
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    env.isProduction ? winston.format.json() : winston.format.prettyPrint({ colorize: true }),
  ),
  transports: [new winston.transports.Console()],
  silent: env.isTest,
});
