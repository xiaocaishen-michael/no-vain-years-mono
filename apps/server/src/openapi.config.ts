import { DocumentBuilder } from '@nestjs/swagger';

/**
 * OpenAPI 3.1 document config — extracted from bootstrap so SwaggerModule.createDocument
 * can be called in tests (without booting Fastify listener) to assert the generated spec
 * is well-formed per W4 V8 验收.
 */
export function buildOpenApiConfig() {
  return new DocumentBuilder()
    .setTitle('no-vain-years API')
    .setDescription(
      'no-vain-years backend HTTP API. Generated from NestJS controllers; ' +
        'consumed by packages/api-client for cross-app TS types.',
    )
    .setVersion('1.0')
    .setOpenAPIVersion('3.1.0')
    .addTag('accounts', 'Account lifecycle: SMS code request, phone-SMS auth')
    .build();
}
