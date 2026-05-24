import { Inject, Injectable } from '@nestjs/common';
import { Phone } from '../account/phone.vo';
import { SmsCode } from './sms-code.vo';
import { SmsCodeStore } from './sms-code.store';
import { SMS_GATEWAY, type SmsGateway } from './sms-gateway.port';

const TTL_SEC = 300;

@Injectable()
export class RequestSmsCodeUseCase {
  constructor(
    private readonly smsCodeStore: SmsCodeStore,
    @Inject(SMS_GATEWAY) private readonly smsGateway: SmsGateway,
  ) {}

  async execute(phone: Phone): Promise<{ ttlSec: number }> {
    const code = SmsCode.generate();
    await this.smsCodeStore.store(phone, code, TTL_SEC);
    await this.smsGateway.sendCode(phone, code);
    return { ttlSec: TTL_SEC };
  }
}
