import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { ClsModule, ClsService } from 'nestjs-cls';
import { AuthModule } from '../auth/auth.module.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

/**
 * Root NestJS module.
 *
 * Module composition:
 *   AppModule → AuthModule → AccountModule → SecurityModule (ClsModule global)
 *
 * LoggerModule config (per ADR-0036 observability + logging governance):
 *
 *  - redact: drop PII / secrets from req/res log dumps. paths cover both
 *    transport-layer (Authorization / Cookie headers) and body-layer
 *    (password / token / smsCode / phone). Censored value is the literal
 *    string `[REDACTED]` so log greps can surface accidental misses.
 *
 *  - customProps: pull trace_id from CLS (registered globally in
 *    SecurityModule via nestjs-cls). Every pino log line on the request
 *    path inherits trace_id, enabling per-request grep across all log
 *    statements + correlation with the x-trace-id response header.
 *
 *  - level: defaults to LOG_LEVEL env (else info). Per ADR-0036 level
 *    governance: error (5xx + edge crashes) · warn (4xx business reject)
 *    · info (req/res + business milestones) · debug (dev-only).
 */
@Module({
  imports: [
    AuthModule,
    LoggerModule.forRootAsync({
      // ClsModule is registered global by SecurityModule; ClsService is
      // injectable anywhere without explicit ClsModule import. Still listed
      // here to make the dependency explicit + survive future refactors.
      imports: [ClsModule],
      inject: [ClsService],
      useFactory: (cls: ClsService) => ({
        pinoHttp: {
          level: process.env['LOG_LEVEL'] ?? 'info',
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'res.headers["set-cookie"]',
              '*.password',
              '*.token',
              '*.refreshToken',
              '*.accessToken',
              '*.jwt',
              '*.smsCode',
              '*.code',
              '*.phone',
              '*.mobile',
              '*.AUTH_JWT_SECRET',
              '*.SMS_CODE_HMAC_SECRET',
            ],
            censor: '[REDACTED]',
          },
          customProps: () => ({
            // CLS is request-scoped; outside an active request (boot logs
            // / shutdown hooks / background workers) getId() returns
            // undefined → fall back to a stable placeholder so log grep
            // never trips on missing field.
            trace_id: cls.getId() ?? 'no-trace',
          }),
        },
      }),
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
