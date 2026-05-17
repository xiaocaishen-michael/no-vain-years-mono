import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Phone } from '../domain/phone.vo';
import { SmsCode } from '../domain/sms-code.vo';
import { PhoneSmsAuthUseCase } from '../application/phone-sms-auth.usecase';
import { PhoneSmsAuthRequest } from './dto/phone-sms-auth.request';

interface PhoneSmsAuthResponse {
  accountId: string;
  accessToken: string;
  refreshToken: string;
}

/**
 * POST /api/v1/accounts/phone-sms-auth
 *
 * US1 (ACTIVE) — phone + code → tokens.
 * US2 (auto-register) and US3 (anti-enumeration) plug into PhoneSmsAuthUseCase
 * in Phase 4/5; response shape is identical for byte-level anti-enumeration.
 *
 * accountId serialized as string (JSON-safe vs BigInt; matches FR-S09 + JWT sub claim).
 */
@Controller('v1/accounts')
export class AccountPhoneSmsAuthController {
  constructor(private readonly useCase: PhoneSmsAuthUseCase) {}

  @Post('phone-sms-auth')
  @HttpCode(200)
  async auth(@Body() body: PhoneSmsAuthRequest): Promise<PhoneSmsAuthResponse> {
    const result = await this.useCase.execute(
      Phone.create(body.phone),
      SmsCode.create(body.code),
    );
    return {
      accountId: result.accountId.toString(),
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    };
  }
}
