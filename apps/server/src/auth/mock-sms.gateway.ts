import { Injectable, Logger } from '@nestjs/common';
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

  async sendCode(phone: string, code: string): Promise<void> {
    this.lastCode.set(phone, code);
    this.logger.log(`[MOCK SMS] sent ${code} to ${phone}`);
  }

  getLastCode(phone: string): string | undefined {
    return this.lastCode.get(phone);
  }

  clearAll(): void {
    this.lastCode.clear();
  }
}
