import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  RedisContainer,
  type StartedRedisContainer,
} from '@testcontainers/redis';
import { Redis } from 'ioredis';
import { SmsCodeRedisRepository } from './sms-code.redis.repository';
import { Phone } from '../../account/domain/phone.vo';
import { SmsCode } from '../domain/sms-code.vo';

const HMAC_SECRET = 'spec-hmac-secret-min-32-bytes-padding-zzzz';

describe('SmsCodeRedisRepository (Testcontainers Redis, HMAC-SHA256)', () => {
  let container: StartedRedisContainer;
  let redis: Redis;
  let repo: SmsCodeRedisRepository;

  beforeAll(async () => {
    container = await new RedisContainer('redis:7-alpine').start();
    redis = new Redis(container.getConnectionUrl());
    repo = new SmsCodeRedisRepository(redis, HMAC_SECRET);
  }, 60_000);

  afterAll(async () => {
    redis?.disconnect();
    await container?.stop();
  });

  it('store + verify returns true for matching code', async () => {
    const phone = Phone.create('+8613800138201');
    await repo.store(phone, SmsCode.create('123456'), 300);

    const result = await repo.verify(phone, SmsCode.create('123456'));
    expect(result).toBe(true);
  });

  it('store + verify returns false for non-matching code', async () => {
    const phone = Phone.create('+8613800138202');
    await repo.store(phone, SmsCode.create('123456'), 300);

    const result = await repo.verify(phone, SmsCode.create('654321'));
    expect(result).toBe(false);
  });

  it('verify returns null when never stored', async () => {
    const phone = Phone.create('+8613800138203');
    const result = await repo.verify(phone, SmsCode.create('123456'));
    expect(result).toBeNull();
  });

  it('store + clear + verify returns null', async () => {
    const phone = Phone.create('+8613800138204');
    await repo.store(phone, SmsCode.create('123456'), 300);
    await repo.clear(phone);

    const result = await repo.verify(phone, SmsCode.create('123456'));
    expect(result).toBeNull();
  });

  it('TTL expires; verify returns null after ttlSec elapsed', async () => {
    const phone = Phone.create('+8613800138205');
    await repo.store(phone, SmsCode.create('123456'), 1);
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const result = await repo.verify(phone, SmsCode.create('123456'));
    expect(result).toBeNull();
  });

  it('HMAC deterministic — same code + same secret = same digest in redis', async () => {
    const phone1 = Phone.create('+8613800138206');
    const phone2 = Phone.create('+8613800138207');
    await repo.store(phone1, SmsCode.create('123456'), 300);
    await repo.store(phone2, SmsCode.create('123456'), 300);

    const d1 = await redis.get(`sms_code:${phone1.value}`);
    const d2 = await redis.get(`sms_code:${phone2.value}`);
    expect(d1).toBeTruthy();
    expect(d1).toBe(d2);
  });

  it('HMAC negative — different code → different digest', async () => {
    const phone1 = Phone.create('+8613800138208');
    const phone2 = Phone.create('+8613800138209');
    await repo.store(phone1, SmsCode.create('123456'), 300);
    await repo.store(phone2, SmsCode.create('654321'), 300);

    const d1 = await redis.get(`sms_code:${phone1.value}`);
    const d2 = await redis.get(`sms_code:${phone2.value}`);
    expect(d1).not.toBe(d2);
  });

  it('secret rotation — different secret reads same redis hash → verify false', async () => {
    const phone = Phone.create('+8613800138210');
    await repo.store(phone, SmsCode.create('123456'), 300);

    const newSecretRepo = new SmsCodeRedisRepository(
      redis,
      'rotated-secret-min-32-bytes-padding-yyyy',
    );
    const result = await newSecretRepo.verify(phone, SmsCode.create('123456'));
    expect(result).toBe(false);
  });
});
