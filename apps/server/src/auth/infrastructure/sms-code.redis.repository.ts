import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Redis } from 'ioredis';
import { Phone } from '../../account/domain/phone.vo';
import { SmsCode } from '../domain/sms-code.vo';
import type { SmsCodeRepository } from '../application/ports/sms-code.repository.port';

const KEY_PREFIX = 'sms_code:';

/**
 * SmsCodeRedisRepository — HMAC-SHA256 + crypto.timingSafeEqual.
 *
 * Per ADR-0023 (2026-05-18 切换): bcrypt cost=12 → HMAC,根因 = FR-S06 P95 ≤ 50ms
 * 实测违反 (mono PR #23 200-rep diff ≈ 193ms,单边 bcrypt.compare verify ~150ms).
 *
 * HMAC verify <1ms 让 3 个反枚举 401 路径(ACTIVE+码错 / ACTIVE+码过期 /
 * ANONYMIZED+任意码) 时延自然均一;BcryptTimingDefenseExecutor.pad 保留作纵深防御.
 */
@Injectable()
export class SmsCodeRedisRepository implements SmsCodeRepository {
  constructor(
    private readonly redis: Redis,
    private readonly hmacSecret: string,
  ) {}

  async store(phone: Phone, code: SmsCode, ttlSec: number): Promise<void> {
    const digest = this.hmac(code);
    await this.redis.setex(this.key(phone), ttlSec, digest);
  }

  async verify(phone: Phone, code: SmsCode): Promise<boolean | null> {
    const stored = await this.redis.get(this.key(phone));
    if (stored === null) return null;
    const candidate = this.hmac(code);
    const storedBuf = Buffer.from(stored, 'base64url');
    const candidateBuf = Buffer.from(candidate, 'base64url');
    if (storedBuf.length !== candidateBuf.length) return false;
    return timingSafeEqual(storedBuf, candidateBuf);
  }

  async clear(phone: Phone): Promise<void> {
    await this.redis.del(this.key(phone));
  }

  private hmac(code: SmsCode): string {
    return createHmac('sha256', this.hmacSecret).update(code.value).digest('base64url');
  }

  private key(phone: Phone): string {
    return `${KEY_PREFIX}${phone.value}`;
  }
}
