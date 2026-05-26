/**
 * Throttler 桶分组常量 —— @SkipThrottle 反污染共享真相源。
 *
 * `@nestjs/throttler` v6: module `throttlers[]` 里**每个** throttler 默认对**每条**
 * 受 ThrottlerGuard 的路由生效, 除非该路由 `@SkipThrottle` 显式跳过。故每新增一组
 * throttler, 既有路由都须跳过它, 否则被新桶 (更紧 limit + 共享 key) 误限流
 * (如 GET /me 被 del-code-account 1/60s 拖垮)。这里按 feature 分组, 路由 `@SkipThrottle`
 * 时 spread 非己分组, 避免每路由手列十余条 (003 起 5 桶 → 004 起 17 桶)。
 *
 * 放 security/ (平台层) 因 account + auth 两侧 controller 都需引用 (单向 import 合规)。
 */
export const DEFAULT_BUCKET: Record<string, boolean> = { default: true };

// 001 phone-sms 发码
export const SMS_CODE_BUCKETS: Record<string, boolean> = {
  'sms-phone-24h': true,
  'sms-ip-24h': true,
};

// 002 /me profile
export const ME_BUCKETS: Record<string, boolean> = { 'me-get': true, 'me-patch': true };

// 003 token refresh / logout-all
export const TOKEN_BUCKETS: Record<string, boolean> = {
  'refresh-ip': true,
  'refresh-token': true,
  'logout-all-ip': true,
  'logout-all-account': true,
};

// 004 注销发码 (EP1, authed)
export const DEL_CODE_BUCKETS: Record<string, boolean> = {
  'del-code-account': true,
  'del-code-ip': true,
};

// 004 注销提交 (EP2, authed)
export const DEL_SUBMIT_BUCKETS: Record<string, boolean> = {
  'del-submit-account': true,
  'del-submit-ip': true,
};

// 004 撤销发码 (EP3, public phone-hash)
export const CANCEL_CODE_BUCKETS: Record<string, boolean> = {
  'cancel-code': true,
  'cancel-code-ip': true,
};

// 004 撤销提交 (EP4, public phone-hash)
export const CANCEL_SUBMIT_BUCKETS: Record<string, boolean> = {
  'cancel-submit': true,
  'cancel-submit-ip': true,
};

/** 004 全部 4 组 deletion 桶 —— 既有 (001/002/003) 路由 spread 此跳过新桶。 */
export const ALL_DELETION_BUCKETS: Record<string, boolean> = {
  ...DEL_CODE_BUCKETS,
  ...DEL_SUBMIT_BUCKETS,
  ...CANCEL_CODE_BUCKETS,
  ...CANCEL_SUBMIT_BUCKETS,
};
