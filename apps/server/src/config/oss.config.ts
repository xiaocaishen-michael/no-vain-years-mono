import { registerAs } from '@nestjs/config';
import { z } from 'zod';

/**
 * Aliyun OSS config — 009 profile image upload (per ADR-0045 + ADR-0037).
 *
 * All-or-nothing presence gate (mirrors sms.config's discriminated union):
 * dev/test boot with *no* OSS_* set → kind='unconfigured' (no creds required,
 * same spirit as SMS mock default). Once *any* OSS_* is set, all four become
 * required — boot-time `.parse()` rejects partial config, surfacing
 * misconfiguration before the first credential issuance.
 *
 * Credentials = Aliyun *account B* (`mbw-server-xt`), scoped to minimal
 * `oss:PutObject` on the `avatar/` + `background/` prefixes (per the OSS
 * provisioning runbook / ADR-0037). Secret is never logged; injected via
 * deploy env only. Note these are a *different* Aliyun account than the SMS
 * `ALIYUN_*` creds (account A) — the two coexist.
 */
const OssAliyunSchema = z.object({
  kind: z.literal('aliyun'),
  // Endpoint-form region incl. the `oss-` prefix, e.g. `oss-cn-shanghai`
  // (the host segment uses it verbatim; oss-policy strips the prefix for the
  // V4 signing scope's bare region — per the OSS PostObject V4 spec).
  region: z.string().min(1, 'OSS_REGION required when OSS is configured'),
  bucket: z.string().min(1, 'OSS_BUCKET required when OSS is configured'),
  accessKeyId: z.string().min(1, 'OSS_ACCESS_KEY_ID required when OSS is configured'),
  accessKeySecret: z.string().min(1, 'OSS_ACCESS_KEY_SECRET required when OSS is configured'),
});

const OssConfigSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('unconfigured') }),
  OssAliyunSchema,
]);

export type OssConfig = z.infer<typeof OssConfigSchema>;
export type OssAliyunConfig = z.infer<typeof OssAliyunSchema>;

export const ossConfig = registerAs('oss', (): OssConfig => {
  const region = process.env.OSS_REGION;
  const bucket = process.env.OSS_BUCKET;
  const accessKeyId = process.env.OSS_ACCESS_KEY_ID;
  const accessKeySecret = process.env.OSS_ACCESS_KEY_SECRET;

  // All-or-nothing: every OSS_* empty/unset → unconfigured (dev/test default,
  // keeps boot green without OSS creds). Otherwise strict-parse the aliyun
  // variant so a *partial* config (e.g. bucket set, secret missing) throws.
  if (!region && !bucket && !accessKeyId && !accessKeySecret) {
    return OssConfigSchema.parse({ kind: 'unconfigured' });
  }
  return OssConfigSchema.parse({ kind: 'aliyun', region, bucket, accessKeyId, accessKeySecret });
});

/**
 * OSS public-read base URL (no trailing slash). `region` is endpoint-form
 * (`oss-cn-shanghai`) → `https://<bucket>.oss-cn-shanghai.aliyuncs.com`.
 * Used to compose the stored avatarUrl/backgroundImageUrl and the confirm-step
 * HEAD probe (public-read → anonymous HEAD, no signing needed).
 */
export function ossPublicBaseUrl(region: string, bucket: string): string {
  return `https://${bucket}.${region}.aliyuncs.com`;
}
