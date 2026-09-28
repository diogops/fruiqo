import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthService } from './auth.service.js';
import { type AccessClaims, TokenService } from './tokens.js';

export const IS_PUBLIC = 'isPublic';
/** Rotas sem autenticação (só auth e health). Todo o resto exige Bearer (SEC-REQ-17). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

type AuthedRequest = Request & { auth?: AccessClaims };

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Não autenticado');

    let claims: AccessClaims;
    try {
      claims = await this.tokens.verifyAccess(header.slice('Bearer '.length));
    } catch {
      throw new UnauthorizedException('Não autenticado');
    }
    // Sessão revogada invalida o access token na hora, não só no próximo refresh.
    if (!(await this.auth.isSessionActive(claims.userId, claims.sessionId))) {
      throw new UnauthorizedException('Não autenticado');
    }
    req.auth = claims;
    return true;
  }
}

export const CurrentAuth = createParamDecorator((_: unknown, ctx: ExecutionContext): AccessClaims => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  if (!req.auth) throw new UnauthorizedException('Não autenticado');
  return req.auth;
});
