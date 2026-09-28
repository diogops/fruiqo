import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import type { Env } from './config/env.js';

/** Monta o app HTTP (usado pelo main.ts e pelos testes de integração). */
export async function createApp(env: Env): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forEnv(env), {
    bufferLogs: true,
    bodyParser: false,
  });
  app.useLogger(app.get(Logger));
  app.use(helmet());
  // Limite de body: text 5000 + url 2048 + até 10 prints × 8000 caracteres (até 3 bytes cada em UTF-8)
  app.useBodyParser('json', { limit: '256kb' });
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.enableShutdownHooks();
  return app;
}
