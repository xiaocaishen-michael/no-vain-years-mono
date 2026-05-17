import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  RedisContainer,
  type StartedRedisContainer,
} from '@testcontainers/redis';
import { Redis } from 'ioredis';
import { SmsCodeRedisRepository } from './sms-code.redis.repository';
import { Phone } from '../domain/phone.vo';
import { SmsCode } from '../domain/sms-code.vo';

describe('SmsCodeRedisRepository (Testcontainers Redis)', () => {
  let container: StartedRedisContainer;
  let redis: Redis;
  let repo: SmsCodeRedisRepository;

  beforeAll(async () => {
    container = await new RedisContainer('redis:7-alpine').start();
    redis = new Redis(container.getConnectionUrl());
    repo = new SmsCodeRedisRepository(redis);
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
});
