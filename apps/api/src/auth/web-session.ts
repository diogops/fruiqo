import { ForbiddenException } from '@nestjs/common';
import { WEB_CLIENT_VALUE, WEB_REFRESH_COOKIE } from '@fruiqo/contracts';
import type { Request, Response } from 'express';
import type { Env } from '../config/env.js';

// RF-30: o sistema web guarda o refresh token só num cookie httpOnly (Path=/auth, SameSite=Strict).
// O cabeçalho X-Fruiqo-Client: web força preflight de CORS (só WEB_ORIGIN passa) e, junto com a
// checagem de Origin, impede que outro site use o cookie (CSRF). O app mobile não muda: bearer + corpo.

const REFRESH_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function isWebClient(req: Request): boolean {
  return req.headers['x-fruiqo-client'] === WEB_CLIENT_VALUE;
}

/** Origem do navegador precisa estar na allowlist; sem ela o fluxo web é recusado. */
export function assertWebOrigin(req: Request, env: Env): string {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin.replace(/\/+$/, '') : '';
  if (!origin || !env.WEB_ORIGIN.includes(origin)) throw new ForbiddenException('Origem não permitida');
  return origin;
}

export function readRefreshCookie(req: Request): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== WEB_REFRESH_COOKIE) continue;
    const value = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function setRefreshCookie(res: Response, token: string, origin: string): void {
  res.cookie(WEB_REFRESH_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    path: '/auth',
    secure: origin.startsWith('https:'),
    maxAge: REFRESH_COOKIE_MAX_AGE_MS,
  });
}

export function clearRefreshCookie(res: Response, origin?: string): void {
  res.clearCookie(WEB_REFRESH_COOKIE, {
    httpOnly: true,
    sameSite: 'strict',
    path: '/auth',
    secure: Boolean(origin?.startsWith('https:')),
  });
}
