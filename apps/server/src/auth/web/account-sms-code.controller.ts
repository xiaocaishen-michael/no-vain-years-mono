import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Phone } from '../domain/phone.vo';
import { RequestSmsCodeUseCase } from '../application/request-sms-code.usecase';
import { RequestSmsCodeRequest } from './dto/request-sms-code.request';
import { SmsPhoneThrottlerGuard } from './sms-phone-throttler.guard';

/**
 * POST /api/v1/accounts/sms-codes
 *
 * Trigger code generation + dispatch via configured SmsGateway (W2 = MockSms).
 * Returns ttlSec for client UX (countdown / resend gating).
 *
 * Rate limit (FR-S07 第 1 条): sms:<phone> 60s 1 次,via SmsPhoneThrottlerGuard
 * 自定义 getTracker 用 phone 而非 IP 做 key。
 */
@Controller('v1/accounts')
@UseGuards(SmsPhoneThrottlerGuard)
export class AccountSmsCodeController {
  constructor(private readonly useCase: RequestSmsCodeUseCase) {}

  @Post('sms-codes')
  @HttpCode(200)
  @Throttle({ default: { limit: 1, ttl: 60_000 } })
  async request(
    @Body() body: RequestSmsCodeRequest,
  ): Promise<{ ttlSec: number }> {
    return this.useCase.execute(Phone.create(body.phone));
  }
}
