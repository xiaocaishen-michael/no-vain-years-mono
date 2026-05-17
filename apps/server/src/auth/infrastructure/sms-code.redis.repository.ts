import { Inject, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import type { Redis } from 'ioredis';
import { Phone } from '../domain/phone.vo';
import { SmsCode } from '../domain/sms-code.vo';
import type { SmsCodeRepository } from '../application/ports/sms-code.repository.port';
import { REDIS_CLIENT } from './redis.token';

const BCRYPT_COST = 12;
const KEY_PREFIX = 'sms_code:';

@Injectable()
export class SmsCodeRedisRepository implements SmsCodeRepository {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async store(phone: Phone, code: SmsCode, ttlSec: number): Promise<void> {
    const hash = await bcrypt.hash(code.value, BCRYPT_COST);
    await this.redis.setex(this.key(phone), ttlSec, hash);
  }

  async verify(phone: Phone, code: SmsCode): Promise<boolean | null> {
    const hash = await this.redis.get(this.key(phone));
    if (hash === null) return null;
    return bcrypt.compare(code.value, hash);
  }

  async clear(phone: Phone): Promise<void> {
    await this.redis.del(this.key(phone));
  }

  private key(phone: Phone): string {
    return `${KEY_PREFIX}${phone.value}`;
  }
}
