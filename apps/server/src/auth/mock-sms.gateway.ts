import { Injectable, Logger } from '@nestjs/common';
import { Phone } from '../account/phone.vo';
import { SmsCode } from './sms-code.vo';
import type { SmsGateway } from './sms-gateway.port';

/**
 * MockSmsGateway — W2 placeholder for AliyunSmsGateway (W3 replacement).
 *
 * Stores the last code emitted per phone in an in-memory Map.
 * `getLastCode(phone)` lets E2E tests retrieve what was "sent".
 *
 * Not for production — Aliyun cockatiel-wrapped impl lands in W3.
 */
@Injectable()
export class MockSmsGateway implements SmsGateway {
  private readonly logger = new Logger(MockSmsGateway.name);
  private readonly lastCode = new Map<string, string>();

  async sendCode(phone: Phone, code: SmsCode): Promise<void> {
    this.lastCode.set(phone.value, code.value);
    this.logger.log(`[MOCK SMS] sent ${code.value} to ${phone.value}`);
  }

  getLastCode(phone: Phone): string | undefined {
    return this.lastCode.get(phone.value);
  }

  clearAll(): void {
    this.lastCode.clear();
  }
}
