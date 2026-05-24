import { randomInt } from 'node:crypto';

/**
 * SMS code 校验 + 生成纯函数 (per ADR-0043 §2 + R-VO 拍平 VO)。原 SmsCode Value
 * Object 降维:6 位数字契约,零 class / 零装箱。SMS code 不 trim(纯数字)。
 */
const SMS_CODE_REGEX = /^\d{6}$/;

export function assertValidSmsCode(raw: string): asserts raw is string {
  if (!SMS_CODE_REGEX.test(raw)) {
    throw new Error(`Invalid SMS code: ${raw}`);
  }
}

/** CSPRNG 6 位数字 (crypto.randomInt 范围 [0, 1_000_000),左 pad 到 6 位)。 */
export function generateSmsCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}
