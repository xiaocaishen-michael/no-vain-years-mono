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

/**
 * 输入校验纯函数 (per ADR-0043 §2 + R-VO 拍平 VO 为纯函数)。Phone / DisplayName
 * 原 Value Object 降维:校验 + trim 归一,返回规范化 string (零 class / 零装箱)。
 * 失败抛 Error,由 ProblemDetailFilter 映射 HTTP 400。
 */

// Phone — E.164 +86 CN mobile only (FR-S01)。trim 后校验,返回 trimmed。
const CN_MOBILE_REGEX = /^\+861[3-9]\d{9}$/;

export function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  if (!CN_MOBILE_REGEX.test(trimmed)) {
    throw new Error(`Invalid phone: ${raw}`);
  }
  return trimmed;
}

// DisplayName — FR-005。禁字符查 raw (trim 会吞 BOM),再 trim + code-point 长度 [1,32]。
const DISPLAY_NAME_MIN_CP = 1;
const DISPLAY_NAME_MAX_CP = 32;
/* eslint-disable no-control-regex */
// 控制字符 (U+0000-U+001F + U+007F) + 零宽字符 (U+200B-U+200F, U+FEFF) +
// 行/段分隔符 (U+2028, U+2029) —— FR-005 deny-list。
const DISPLAY_NAME_FORBIDDEN = new RegExp('[\\x00-\\x1F\\x7F\\u200B-\\u200F\\uFEFF\\u2028\\u2029]');
/* eslint-enable no-control-regex */

export function normalizeDisplayName(raw: string): string {
  if (DISPLAY_NAME_FORBIDDEN.test(raw)) {
    throw new Error(
      'INVALID_DISPLAY_NAME: contains forbidden characters (control chars, zero-width chars, or line separators)',
    );
  }
  const trimmed = raw.trim();
  const cpCount = [...trimmed].length;
  if (cpCount < DISPLAY_NAME_MIN_CP || cpCount > DISPLAY_NAME_MAX_CP) {
    throw new Error(
      `INVALID_DISPLAY_NAME: length must be ${DISPLAY_NAME_MIN_CP}-${DISPLAY_NAME_MAX_CP} Unicode code points after trim, got ${cpCount}`,
    );
  }
  return trimmed;
}
