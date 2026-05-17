import { Phone } from '../../domain/phone.vo';
import { SmsCode } from '../../domain/sms-code.vo';

/**
 * SmsCodeRepository port (Redis-backed; FR-S02).
 *
 * Key: `sms_code:<phone>`. Value: bcrypt hash of code.
 * TTL: 300s default.
 *
 * 操作:
 * - store(phone, code, ttlSec): hash + setex
 * - lookup(phone): get + bcrypt compare; returns true/false on verify; null if expired/absent
 * - clear(phone): del (用于成功 verify 后单次性失效)
 */
export const SMS_CODE_REPOSITORY = Symbol('SMS_CODE_REPOSITORY');

export interface SmsCodeRepository {
  store(phone: Phone, code: SmsCode, ttlSec: number): Promise<void>;
  /**
   * verify code against stored hash. returns:
   * - true: match (caller 应立即 clear)
   * - false: stored exists but code differ
   * - null: expired or never stored
   */
  verify(phone: Phone, code: SmsCode): Promise<boolean | null>;
  clear(phone: Phone): Promise<void>;
}
