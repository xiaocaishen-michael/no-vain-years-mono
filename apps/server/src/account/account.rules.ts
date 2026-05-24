import type { Account } from '../generated/prisma/client';

/**
 * Account 不变量 —— 无状态纯函数 helper (per ADR-0043 §2 贫血 + 纯函数 Helper)。
 *
 * 数据 = Prisma 原始 `Account` row (绝对贫血)。这里只放对 row 的只读判定;
 * 禁带状态 Domain Class、禁 Entity Mapper。状态机转移 use case 由其它 module
 * 处理 (ACTIVE ↔ FROZEN ↔ ANONYMIZED)。
 */
export enum AccountStatus {
  ACTIVE = 'ACTIVE',
  FROZEN = 'FROZEN',
  ANONYMIZED = 'ANONYMIZED',
}

export const isActive = (a: Account): boolean => a.status === AccountStatus.ACTIVE;
export const isFrozen = (a: Account): boolean => a.status === AccountStatus.FROZEN;
export const isAnonymized = (a: Account): boolean => a.status === AccountStatus.ANONYMIZED;
