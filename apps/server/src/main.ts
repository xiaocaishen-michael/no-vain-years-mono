import { ValidationError, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app/app.module';
import { buildOpenApiConfig } from './openapi.config';
import {
  FormValidationException,
  type InvalidAttribute,
} from './security/form-validation.exception';

// Flatten class-validator ValidationError[] into ProblemDetail
// invalidAttributes shape (per ADR-0038). Nested object errors use
// dot-notation: e.g. `address.city` for { address: { city: ... } }.
function flattenValidationErrors(
  errors: ValidationError[],
  parentPath = '',
): InvalidAttribute[] {
  return errors.flatMap((err) => {
    const field = parentPath ? `${parentPath}.${err.property}` : err.property;
    const own: InvalidAttribute[] = err.constraints
      ? [{ field, messages: Object.values(err.constraints) }]
      : [];
    const nested = err.children?.length
      ? flattenValidationErrors(err.children, field)
      : [];
    return [...own, ...nested];
  });
}

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    { bufferLogs: true },
  );
  app.useLogger(app.get(Logger));
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      // Map class-validator errors into FormValidationException so
      // ProblemDetailFilter passes `code: "FORM_VALIDATION"` +
      // `invalidAttributes[]` through to the client (per ADR-0038).
      exceptionFactory: (errors: ValidationError[]) =>
        new FormValidationException(flattenValidationErrors(errors)),
    }),
  );
  const globalPrefix = 'api';
  app.setGlobalPrefix(globalPrefix);

  const document = SwaggerModule.createDocument(app, buildOpenApiConfig());
  SwaggerModule.setup('docs', app, document, {
    jsonDocumentUrl: 'docs-json',
  });

  const port = Number(process.env.PORT) || 3000;
  await app.listen(port, '0.0.0.0');
  app
    .get(Logger)
    .log(`🚀 Application is running on: http://localhost:${port}/${globalPrefix}`);
  app.get(Logger).log(`📘 OpenAPI docs: http://localhost:${port}/docs`);
}

bootstrap();
