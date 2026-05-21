import { Inject, Injectable } from '@nestjs/common';
import { Phone } from '../../account/domain/phone.vo';
import { SmsCode } from '../domain/sms-code.vo';
import {
  SMS_CODE_REPOSITORY,
  type SmsCodeRepository,
} from './ports/sms-code.repository.port';
import { SMS_GATEWAY, type SmsGateway } from './ports/sms-gateway.port';

const TTL_SEC = 300;

@Injectable()
export class RequestSmsCodeUseCase {
  constructor(
    @Inject(SMS_CODE_REPOSITORY)
    private readonly smsCodeRepo: SmsCodeRepository,
    @Inject(SMS_GATEWAY) private readonly smsGateway: SmsGateway,
  ) {}

  async execute(phone: Phone): Promise<{ ttlSec: number }> {
    const code = SmsCode.generate();
    await this.smsCodeRepo.store(phone, code, TTL_SEC);
    await this.smsGateway.sendCode(phone, code);
    return { ttlSec: TTL_SEC };
  }
}
