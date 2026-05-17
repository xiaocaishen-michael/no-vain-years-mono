import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';

/**
 * RFC 9457 ProblemDetail global exception filter (FR-S10).
 *
 * 把所有 HttpException + 未知 Error 映射到 `application/problem+json` 响应体。
 * 未知 Error 不暴露内部细节 (per OWASP API Security 最佳实践).
 */
@Catch()
export class ProblemDetailFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const exResponse = exception.getResponse();
      const detail =
        typeof exResponse === 'string'
          ? exResponse
          : ((exResponse as { message?: string | string[] }).message ?? exception.message);
      const title = HttpStatus[status] ? this.titleCase(HttpStatus[status]) : 'Error';
      response.status(status).header('content-type', 'application/problem+json').send({
        type: 'about:blank',
        title,
        status,
        detail: Array.isArray(detail) ? detail.join('; ') : detail,
        instance: request.url,
      });
      return;
    }

    // 未知 error: 500 + 不暴露内部细节
    this.logger.error('unhandled exception', exception);
    response.status(500).header('content-type', 'application/problem+json').send({
      type: 'about:blank',
      title: 'Internal Server Error',
      status: 500,
      detail: 'An unexpected error occurred',
      instance: request.url,
    });
  }

  private titleCase(s: string): string {
    return s.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
}
