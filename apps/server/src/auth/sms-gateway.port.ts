import { Phone } from '../account/phone.vo';
import { SmsCode } from './sms-code.vo';

/**
 * SmsGateway port (FR-S03 Template A unified).
 *
 * mono W2 implement 用 MockSmsGateway (in-memory log);
 * W3 replace 为 AliyunSmsGateway (cockatiel retry wrapper, per plan R0.5).
 *
 * 操作:
 * - sendCode(phone, code): 发送 Template A 真实验证码; 反枚举要求 unified template
 *   (不区分注册 / 登录, per FR-S03).
 */
export const SMS_GATEWAY = Symbol('SMS_GATEWAY');

export interface SmsGateway {
  sendCode(phone: Phone, code: SmsCode): Promise<void>;
}
