import { registerAs } from '@nestjs/config';
import { z } from 'zod';

/**
 * SMS gateway config — discriminated union so Aliyun credentials are only
 * required when `SMS_GATEWAY=aliyun`. `mock` is the default for dev/test.
 *
 * Boot-time `.parse()` rejects partial Aliyun config (e.g. accessKeyId set
 * but signName missing), surfacing misconfiguration before the first SMS send.
 */
const SmsConfigSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('mock') }),
  z.object({
    kind: z.literal('aliyun'),
    accessKeyId: z.string().min(1, 'ALIYUN_ACCESS_KEY_ID required when SMS_GATEWAY=aliyun'),
    accessKeySecret: z.string().min(1, 'ALIYUN_ACCESS_KEY_SECRET required when SMS_GATEWAY=aliyun'),
    signName: z.string().min(1, 'ALIYUN_SMS_SIGN_NAME required when SMS_GATEWAY=aliyun'),
    templateCode: z.string().min(1, 'ALIYUN_SMS_TEMPLATE_CODE required when SMS_GATEWAY=aliyun'),
    // 注销/撤销码独立模板 (FR-S05/S08, 004)。可选 — 缺省则 auth.module 不下发覆盖,
    // AliyunSmsGateway 回退默认 templateCode (登录码模板)。
    deleteAccountTemplateCode: z.string().min(1).optional(),
    cancelDeletionTemplateCode: z.string().min(1).optional(),
  }),
]);

export type SmsConfig = z.infer<typeof SmsConfigSchema>;

export const smsConfig = registerAs('sms', (): SmsConfig => {
  const kind = process.env.SMS_GATEWAY ?? 'mock';
  if (kind === 'aliyun') {
    return SmsConfigSchema.parse({
      kind,
      accessKeyId: process.env.ALIYUN_ACCESS_KEY_ID,
      accessKeySecret: process.env.ALIYUN_ACCESS_KEY_SECRET,
      signName: process.env.ALIYUN_SMS_SIGN_NAME,
      templateCode: process.env.ALIYUN_SMS_TEMPLATE_CODE,
      deleteAccountTemplateCode: process.env.ALIYUN_SMS_TEMPLATE_CODE_DELETE_ACCOUNT,
      cancelDeletionTemplateCode: process.env.ALIYUN_SMS_TEMPLATE_CODE_CANCEL_DELETION,
    });
  }
  return SmsConfigSchema.parse({ kind: 'mock' });
});
