import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { PhoneSmsAuthUseCase } from './phone-sms-auth.usecase';
import { Phone } from '../domain/phone.vo';
import { SmsCode } from '../domain/sms-code.vo';
import { Account } from '../domain/account.aggregate';
import type { AccountRepository } from './ports/account.repository.port';
import type { SmsCodeRepository } from './ports/sms-code.repository.port';
import type { OutboxPublisher } from './ports/outbox-publisher.port';
import type { JwtTokenService } from '../infrastructure/jwt-token.service';
import { ACCOUNT_CREATED_EVENT_TYPE } from '../domain/events/account-created.event';

// T030 GREEN 会把 PhoneSmsAuthUseCase constructor 扩为 4 参（加 OutboxPublisher）。
// 当前 RED 期通过 `as any` cast 保留 type-check 不破，spec 测期望行为。
type UseCaseCtor = new (
  accountRepo: AccountRepository,
  smsCodeRepo: SmsCodeRepository,
  jwtTokenService: JwtTokenService,
  outboxPublisher?: OutboxPublisher,
) => PhoneSmsAuthUseCase;

describe('PhoneSmsAuthUseCase ACTIVE path (US1)', () => {
  let accountRepo: AccountRepository;
  let smsCodeRepo: SmsCodeRepository;
  let jwtTokenService: JwtTokenService;
  let useCase: PhoneSmsAuthUseCase;

  const phone = Phone.create('+8613800138401');
  const code = SmsCode.create('123456');

  const activeAccountRow = {
    id: 42n,
    phone: '+8613800138401',
    status: 'ACTIVE' as const,
    created_at: new Date('2026-01-01T00:00:00Z'),
    last_login_at: null,
  };

  beforeEach(() => {
    accountRepo = {
      findByPhone: vi.fn(),
      save: vi.fn().mockResolvedValue(undefined),
      updateLastLoginAt: vi.fn().mockResolvedValue(undefined),
    };
    smsCodeRepo = {
      store: vi.fn().mockResolvedValue(undefined),
      verify: vi.fn(),
      clear: vi.fn().mockResolvedValue(undefined),
    };
    jwtTokenService = {
      signAccessToken: vi.fn().mockReturnValue('access-token-xyz'),
      generateRefreshToken: vi.fn().mockReturnValue('refresh-token-xyz'),
    } as unknown as JwtTokenService;
    useCase = new PhoneSmsAuthUseCase(accountRepo, smsCodeRepo, jwtTokenService);
  });

  it('ACTIVE + matching code → tokens + DB updates', async () => {
    vi.mocked(accountRepo.findByPhone).mockResolvedValue(
      Account.fromPrisma(activeAccountRow),
    );
    vi.mocked(smsCodeRepo.verify).mockResolvedValue(true);

    const result = await useCase.execute(phone, code);

    expect(result.accountId).toBe(42n);
    expect(result.accessToken).toBe('access-token-xyz');
    expect(result.refreshToken).toBe('refresh-token-xyz');

    expect(smsCodeRepo.clear).toHaveBeenCalledWith(phone);
    expect(accountRepo.updateLastLoginAt).toHaveBeenCalledTimes(1);
    const [updatedId, updatedAt] = vi.mocked(accountRepo.updateLastLoginAt).mock
      .calls[0];
    expect(updatedId).toBe(42n);
    expect(updatedAt).toBeInstanceOf(Date);
  });

  it('ACTIVE + code mismatch (verify false) → 401 INVALID_CREDENTIALS', async () => {
    vi.mocked(accountRepo.findByPhone).mockResolvedValue(
      Account.fromPrisma(activeAccountRow),
    );
    vi.mocked(smsCodeRepo.verify).mockResolvedValue(false);

    await expect(useCase.execute(phone, code)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(smsCodeRepo.clear).not.toHaveBeenCalled();
    expect(accountRepo.updateLastLoginAt).not.toHaveBeenCalled();
  });

  it('ACTIVE + code expired (verify null) → 401 INVALID_CREDENTIALS', async () => {
    vi.mocked(accountRepo.findByPhone).mockResolvedValue(
      Account.fromPrisma(activeAccountRow),
    );
    vi.mocked(smsCodeRepo.verify).mockResolvedValue(null);

    await expect(useCase.execute(phone, code)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(accountRepo.updateLastLoginAt).not.toHaveBeenCalled();
  });

  it('account not found (US2 territory) → 401 (US1 scope: no auto-register yet)', async () => {
    vi.mocked(accountRepo.findByPhone).mockResolvedValue(null);

    await expect(useCase.execute(phone, code)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(smsCodeRepo.verify).not.toHaveBeenCalled();
  });

  it('FROZEN account (US3 territory) → 401 (US1 scope: defer real anti-enum)', async () => {
    vi.mocked(accountRepo.findByPhone).mockResolvedValue(
      Account.fromPrisma({ ...activeAccountRow, status: 'FROZEN' }),
    );

    await expect(useCase.execute(phone, code)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(smsCodeRepo.verify).not.toHaveBeenCalled();
  });

  it('signs access token with bigint accountId payload', async () => {
    vi.mocked(accountRepo.findByPhone).mockResolvedValue(
      Account.fromPrisma(activeAccountRow),
    );
    vi.mocked(smsCodeRepo.verify).mockResolvedValue(true);

    await useCase.execute(phone, code);

    expect(jwtTokenService.signAccessToken).toHaveBeenCalledWith({
      accountId: 42n,
    });
    expect(jwtTokenService.generateRefreshToken).toHaveBeenCalledTimes(1);
  });
});

describe('PhoneSmsAuthUseCase US2 unregistered auto-register path', () => {
  let accountRepo: AccountRepository;
  let smsCodeRepo: SmsCodeRepository;
  let jwtTokenService: JwtTokenService;
  let outboxPublisher: OutboxPublisher;
  let useCase: PhoneSmsAuthUseCase;

  const phone = Phone.create('+8613900139001');
  const code = SmsCode.create('123456');

  beforeEach(() => {
    accountRepo = {
      findByPhone: vi.fn().mockResolvedValue(null),
      save: vi.fn().mockResolvedValue(99n as never),
      updateLastLoginAt: vi.fn().mockResolvedValue(undefined),
    };
    smsCodeRepo = {
      store: vi.fn().mockResolvedValue(undefined),
      verify: vi.fn().mockResolvedValue(true),
      clear: vi.fn().mockResolvedValue(undefined),
    };
    jwtTokenService = {
      signAccessToken: vi.fn().mockReturnValue('access-token-us2'),
      generateRefreshToken: vi.fn().mockReturnValue('refresh-token-us2'),
    } as unknown as JwtTokenService;
    outboxPublisher = { publish: vi.fn().mockResolvedValue(undefined) };

    useCase = new (PhoneSmsAuthUseCase as unknown as UseCaseCtor)(
      accountRepo,
      smsCodeRepo,
      jwtTokenService,
      outboxPublisher,
    );
  });

  it('unregistered phone → save Account ACTIVE + publish AccountCreatedEvent + return tokens', async () => {
    vi.mocked(smsCodeRepo.verify).mockResolvedValue(true);

    const result = await useCase.execute(phone, code);

    expect(accountRepo.save).toHaveBeenCalledTimes(1);
    const savedAccount = vi.mocked(accountRepo.save).mock.calls[0]![0];
    expect(savedAccount.phone.value).toBe('+8613900139001');
    expect(savedAccount.isActive()).toBe(true);

    expect(outboxPublisher.publish).toHaveBeenCalledTimes(1);
    const [eventType, payload] = vi.mocked(outboxPublisher.publish).mock
      .calls[0]!;
    expect(eventType).toBe(ACCOUNT_CREATED_EVENT_TYPE);
    expect(payload).toMatchObject({
      accountId: expect.any(String),
      phone: '+8613900139001',
      createdAt: expect.any(String),
    });

    expect(result.accountId).toBe(99n);
    expect(result.accessToken).toBe('access-token-us2');
    expect(result.refreshToken).toBe('refresh-token-us2');
  });

  it('unregistered phone + verify false → 401 (code must still match before auto-register)', async () => {
    vi.mocked(smsCodeRepo.verify).mockResolvedValue(false);

    await expect(useCase.execute(phone, code)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(accountRepo.save).not.toHaveBeenCalled();
    expect(outboxPublisher.publish).not.toHaveBeenCalled();
  });

  it('unregistered phone → byte-equal response shape vs ACTIVE path (accountId/access/refresh keys present)', async () => {
    const result = await useCase.execute(phone, code);
    expect(Object.keys(result).sort()).toEqual(
      ['accessToken', 'accountId', 'refreshToken'].sort(),
    );
  });
});
