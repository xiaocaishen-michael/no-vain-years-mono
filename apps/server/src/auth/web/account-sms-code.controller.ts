import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
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
 * Rate limit (FR-S07 #1-3): module-level ThrottlerModule config 启用全部 3 个
 * throttler (sms:<phone> 60s 1 次 / sms:<phone> 24h 10 次 / sms:<ip> 24h 50 次)；
 * 无 @Throttle decorator 时 throttler 6+ 默认 enforce 所有 module throttler with
 * module config limits。SmsPhoneThrottlerGuard fallback getTracker 走 phone key,
 * sms-ip-24h throttler per-throttler getTracker 走 ip key。
 */
@Controller('v1/accounts')
@UseGuards(SmsPhoneThrottlerGuard)
export class AccountSmsCodeController {
  constructor(private readonly useCase: RequestSmsCodeUseCase) {}

  @Post('sms-codes')
  @HttpCode(200)
  async request(
    @Body() body: RequestSmsCodeRequest,
  ): Promise<{ ttlSec: number }> {
    return this.useCase.execute(Phone.create(body.phone));
  }
}
