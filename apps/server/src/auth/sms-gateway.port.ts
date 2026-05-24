/**
 * SmsGateway port (FR-S03 Template A unified).
 *
 * mono W2 implement 用 MockSmsGateway (in-memory log);
 * W3 replace 为 AliyunSmsGateway (cockatiel retry wrapper, per plan R0.5).
 *
 * 操作:
 * - sendCode(phone, code): 发送 Template A 真实验证码; 反枚举要求 unified template
 *   (不区分注册 / 登录, per FR-S03). phone / code 均为已校验 string (per ADR-0043
 *   R-VO — 校验在边界 normalizePhone / assertValidSmsCode 完成)。
 */
export const SMS_GATEWAY = Symbol('SMS_GATEWAY');

export interface SmsGateway {
  sendCode(phone: string, code: string): Promise<void>;
}
