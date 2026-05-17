import { IsString, Matches } from 'class-validator';

/**
 * POST /api/v1/accounts/sms-codes request body (FR-S01, FR-S04).
 * 与 Phone VO 同正则保持业务一致；FR-S04 ValidationPipe + transform 兜底.
 */
export class RequestSmsCodeRequest {
  @IsString()
  @Matches(/^\+861[3-9]\d{9}$/, {
    message: 'phone must be E.164 +86 CN mobile (1[3-9]xxxxxxxxx)',
  })
  phone!: string;
}
