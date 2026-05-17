/**
 * AccountInFreezePeriodException (per spec FR-S05 + CL-006 disclosure path).
 *
 * 注销冻结期账号尝试登录 → HTTP 403 + RFC 9457 ProblemDetail body:
 *   { code: 'ACCOUNT_IN_FREEZE_PERIOD', freezeUntil: ISO-8601 }
 *
 * 与 ANONYMIZED 反枚举吞 401 不同 — FROZEN 是用户主动注销知情态, 信息泄露面小,
 * 选 disclosure 让 client 能在 freeze 期内引导申诉 (spec D `expose-frozen-account-status`).
 *
 * Filter mapping: ProblemDetailFilter 把本异常映射到 403.
 */
export const ACCOUNT_IN_FREEZE_PERIOD_CODE = 'ACCOUNT_IN_FREEZE_PERIOD';

export class AccountInFreezePeriodException extends Error {
  static readonly code = ACCOUNT_IN_FREEZE_PERIOD_CODE;

  constructor(public readonly freezeUntil: Date) {
    super(ACCOUNT_IN_FREEZE_PERIOD_CODE);
    this.name = 'AccountInFreezePeriodException';
  }
}
