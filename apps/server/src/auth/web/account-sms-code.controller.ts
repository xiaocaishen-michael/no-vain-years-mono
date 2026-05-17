import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Phone } from '../domain/phone.vo';
import { RequestSmsCodeUseCase } from '../application/request-sms-code.usecase';
import { RequestSmsCodeRequest } from './dto/request-sms-code.request';

/**
 * POST /api/v1/accounts/sms-codes
 *
 * Trigger code generation + dispatch via configured SmsGateway (W2 = MockSms).
 * Returns ttlSec for client UX (countdown / resend gating).
 */
@Controller('api/v1/accounts')
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
