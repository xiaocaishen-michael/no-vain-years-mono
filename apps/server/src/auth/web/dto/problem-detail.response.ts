import { ApiProperty } from '@nestjs/swagger';

/**
 * RFC 9457 ProblemDetail response shape (FR-S10).
 *
 * 通用错误响应 schema,镜像 ProblemDetailFilter 输出.
 * 不映射 domain-specific 扩展字段 (freezeUntil / retryAfterSeconds / code) 到顶层,
 * 客户端按需读 — OpenAPI additionalProperties: true 让 generator 接受扩展.
 */
export class ProblemDetailResponse {
  @ApiProperty({
    description: 'RFC 9457 problem type URI; "about:blank" if generic',
    example: 'about:blank',
  })
  type!: string;

  @ApiProperty({
    description: 'Short human-readable summary of the problem type',
    example: 'Forbidden',
  })
  title!: string;

  @ApiProperty({
    description: 'HTTP status code',
    example: 403,
  })
  status!: number;

  @ApiProperty({
    description: 'Human-readable explanation specific to this occurrence',
    required: false,
    example: 'Account is in 30-day freeze period',
  })
  detail?: string;

  @ApiProperty({
    description: 'URI reference identifying the specific occurrence',
    required: false,
    example: '/api/v1/accounts/phone-sms-auth',
  })
  instance?: string;
}
