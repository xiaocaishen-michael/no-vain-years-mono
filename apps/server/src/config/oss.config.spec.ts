import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ossConfig, ossPublicBaseUrl } from './oss.config.js';

const ENV_KEYS = [
  'OSS_REGION',
  'OSS_BUCKET',
  'OSS_ACCESS_KEY_ID',
  'OSS_ACCESS_KEY_SECRET',
] as const;

describe('ossConfig presence gate', () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    for (const k of ENV_KEYS) delete process.env[k];
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('defaults to kind=unconfigured when no OSS_* set (dev/test boot stays green)', () => {
    expect(ossConfig()).toEqual({ kind: 'unconfigured' });
  });

  it('treats all-empty OSS_* as unconfigured', () => {
    for (const k of ENV_KEYS) process.env[k] = '';
    expect(ossConfig()).toEqual({ kind: 'unconfigured' });
  });

  it('throws when OSS partially configured (bucket set, secret missing)', () => {
    process.env.OSS_REGION = 'oss-cn-shanghai';
    process.env.OSS_BUCKET = 'mbw-profile-images';
    process.env.OSS_ACCESS_KEY_ID = 'AK';
    // OSS_ACCESS_KEY_SECRET left unset
    expect(() => ossConfig()).toThrow();
  });

  it('parses full aliyun config when all four set', () => {
    process.env.OSS_REGION = 'oss-cn-shanghai';
    process.env.OSS_BUCKET = 'mbw-profile-images';
    process.env.OSS_ACCESS_KEY_ID = 'AK';
    process.env.OSS_ACCESS_KEY_SECRET = 'SK';
    expect(ossConfig()).toEqual({
      kind: 'aliyun',
      region: 'oss-cn-shanghai',
      bucket: 'mbw-profile-images',
      accessKeyId: 'AK',
      accessKeySecret: 'SK',
    });
  });
});

describe('ossPublicBaseUrl', () => {
  it('composes the public-read endpoint URL with no trailing slash', () => {
    expect(ossPublicBaseUrl('oss-cn-shanghai', 'mbw-profile-images')).toBe(
      'https://mbw-profile-images.oss-cn-shanghai.aliyuncs.com',
    );
  });
});
