import type { Params } from 'nestjs-pino';
import type { Env } from '../config/env.js';

/** Campos que nunca podem ir para o log (SEC-REQ-14). */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.body',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.accessToken',
  '*.refreshToken',
  '*.token',
  '*.text',
  '*.inputText',
  '*.pages',
  '*.inputPages',
  '*.apiKey',
];

export function pinoParams(env: Env): Params {
  return {
    pinoHttp: {
      level: env.LOG_LEVEL,
      redact: { paths: REDACT_PATHS, censor: '[redacted]' },
      // URL sem query string: tokens/params de rastreamento não vão para o log
      serializers: {
        req: (req: { method: string; url: string; id: unknown }) => ({
          id: req.id,
          method: req.method,
          url: req.url.split('?')[0],
        }),
      },
      autoLogging: env.NODE_ENV !== 'test',
    },
  };
}
