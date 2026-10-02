import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { ApiError } from '@fruiqo/contracts';
import type { Response } from 'express';

/** Todas as respostas de erro seguem ApiError; erros inesperados nunca vazam detalhes. */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const message =
        typeof response === 'string'
          ? response
          : typeof (response as { message?: unknown }).message === 'string'
            ? (response as { message: string }).message
            : exception.message;
      // 409 de PATCH /library/:id (TitleConflictError): único campo extra repassado
      const conflictWith = typeof response === 'object' ? (response as { conflictWith?: unknown }).conflictWith : undefined;
      if (status === HttpStatus.CONFLICT && typeof conflictWith === 'string') {
        // RF-27: correção que colide sugere mesclar
        const suggestion = (response as { suggestion?: unknown }).suggestion === 'merge' ? { suggestion: 'merge' as const } : {};
        res.status(status).json({ error: 'conflict', message, conflictWith, ...suggestion });
        return;
      }
      // RF-44: rascunho de prioridade desatualizado (quantos títulos entraram/saíram da fila)
      const stale = typeof response === 'object' ? (response as { staleDetails?: { added?: unknown; removed?: unknown } }).staleDetails : undefined;
      const staleDetails =
        status === HttpStatus.CONFLICT && typeof stale?.added === 'number' && typeof stale.removed === 'number'
          ? { staleDetails: { added: stale.added, removed: stale.removed } }
          : {};
      // código para a tela reagir (acesso pendente, MFA): só valores conhecidos
      const rawCode = typeof response === 'object' ? (response as { code?: unknown }).code : undefined;
      const code: Pick<ApiError, 'code'> =
        rawCode === 'access_pending' || rawCode === 'mfa_required' || rawCode === 'mfa_setup_required' ? { code: rawCode } : {};
      const body: ApiError = { error: HttpStatus[status] ?? 'ERROR', message, ...staleDetails, ...code };
      res.status(status).json(body);
      return;
    }

    this.logger.error({ err: exception }, 'erro não tratado');
    const body: ApiError = { error: 'INTERNAL_SERVER_ERROR', message: 'Erro interno' };
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json(body);
  }
}
