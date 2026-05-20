import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { PhoneSmsAuthUseCase } from './phone-sms-auth.usecase';
import { Phone } from '../domain/phone.vo';
import { SmsCode } from '../domain/sms-code.vo';
import { Account } from '../domain/account.aggregate';
import { AccountInFreezePeriodException } from '../domain/account-in-freeze-period.exception';
import type { AccountRepository } from './ports/account.repository.port';
import type { SmsCodeRepository } from './ports/sms-code.repository.port';
import type { OutboxPublisher } from './ports/outbox-publisher.port';
import type { TimingDefenseExecutor } from './ports/timing-defense.port';
import type { JwtTokenService } from '../infrastructure/jwt-token.service';
import type { PrismaService } from '../infrastructure/prisma.service';
import type { AuthFailureLockService } from '../infrastructure/auth-failure-lock.service';
import { ACCOUNT_CREATED_EVENT_TYPE } from '../domain/events/account-created.event';

// PhoneSmsAuthUseCase ctor 历史 amend 轨迹:
// - T036/T037 (US3): +TimingDefenseExecutor → 6 args
// - T047 (W3 A2): +AuthFailureLockService → 7 args
type UseCaseCtor = new (
  accountRepo: AccountRepository,
  smsCodeRepo: SmsCodeRepository,
  jwtTokenService: JwtTokenService,
  outboxPublisher: OutboxPublisher,
  prismaService: PrismaService,
  timingDefense: TimingDefenseExecutor,
  authFailureLock: AuthFailureLockService,
) => PhoneSmsAuthUseCase;

/**
 * Default mock: assertNotLocked passes (not locked), recordFailure no-op.
 * Per spec override to test lock 路径。
 */
function buildAuthFailureLockMock(): AuthFailureLockService {
  return {
    assertNotLocked: vi.fn().mockResolvedValue(undefined),
    recordFailure: vi.fn().mockResolvedValue(undefined),
  } as unknown as AuthFailureLockService;
}

describe('PhoneSmsAuthUseCase ACTIVE path (US1)', () => {
  let accountRepo: AccountRepository;
  let smsCodeRepo: SmsCodeRepository;
  let jwtTokenService: JwtTokenService;
  let outboxPublisher: OutboxPublisher;
  let prismaService: PrismaService;
  let timingDefense: TimingDefenseExecutor;
  let useCase: PhoneSmsAuthUseCase;

  const phone = Phone.create('+8613800138401');
  const code = SmsCode.create('123456');

  const activeAccountRow = {
    id: 42n,
    phone: '+8613800138401',
    status: 'ACTIVE' as const,
    created_at: new Date('2026-01-01T00:00:00Z'),
    last_login_at: null,
    freeze_until: null,
    display_name: null,
  };

  beforeEach(() => {
    accountRepo = {
      findById: vi.fn(),
      findByPhone: vi.fn(),
      save: vi.fn().mockResolvedValue(undefined),
      updateLastLoginAt: vi.fn().mockResolvedValue(undefined),
      updateDisplayName: vi.fn().mockResolvedValue(undefined),
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
    // US1 ACTIVE path 不进 handleUnregistered, outbox/prisma 不被消费; 占位 mock 即可.
    outboxPublisher = { publish: vi.fn().mockResolvedValue(undefined) };
    prismaService = {
      $transaction: vi.fn(),
    } as unknown as PrismaService;
    timingDefense = { pad: vi.fn().mockResolvedValue(undefined) };
    useCase = new (PhoneSmsAuthUseCase as unknown as UseCaseCtor)(
      accountRepo,
      smsCodeRepo,
      jwtTokenService,
      outboxPublisher,
      prismaService,
      timingDefense,
      buildAuthFailureLockMock(),
    );
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
  let prismaService: PrismaService;
  let timingDefense: TimingDefenseExecutor;
  let fakeTx: { account: { create: ReturnType<typeof vi.fn> } };
  let useCase: PhoneSmsAuthUseCase;

  const phone = Phone.create('+8613900139001');
  const code = SmsCode.create('123456');

  beforeEach(() => {
    accountRepo = {
      findById: vi.fn(),
      findByPhone: vi.fn().mockResolvedValue(null),
      save: vi.fn().mockResolvedValue(undefined),
      updateLastLoginAt: vi.fn().mockResolvedValue(undefined),
      updateDisplayName: vi.fn().mockResolvedValue(undefined),
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

    fakeTx = {
      account: {
        create: vi.fn().mockResolvedValue({
          id: 99n,
          phone: '+8613900139001',
          status: 'ACTIVE',
          created_at: new Date('2026-05-17T12:00:00Z'),
          last_login_at: new Date('2026-05-17T12:00:00Z'),
        }),
      },
    };
    prismaService = {
      $transaction: vi
        .fn()
        .mockImplementation(
          async (cb: (tx: typeof fakeTx) => unknown) => cb(fakeTx),
        ),
    } as unknown as PrismaService;
    timingDefense = { pad: vi.fn().mockResolvedValue(undefined) };

    useCase = new (PhoneSmsAuthUseCase as unknown as UseCaseCtor)(
      accountRepo,
      smsCodeRepo,
      jwtTokenService,
      outboxPublisher,
      prismaService,
      timingDefense,
      buildAuthFailureLockMock(),
    );
  });

  it('unregistered phone → create Account ACTIVE in tx + publish AccountCreatedEvent + return tokens', async () => {
    const result = await useCase.execute(phone, code);

    // tx-internal account create
    expect(fakeTx.account.create).toHaveBeenCalledTimes(1);
    const createArgs = fakeTx.account.create.mock.calls[0]![0] as {
      data: { phone: string; status: string };
    };
    expect(createArgs.data.phone).toBe('+8613900139001');
    expect(createArgs.data.status).toBe('ACTIVE');

    // outbox publish in same tx (first arg is the tx, not undefined)
    expect(outboxPublisher.publish).toHaveBeenCalledTimes(1);
    const [client, eventType, payload] = vi.mocked(outboxPublisher.publish).mock
      .calls[0]!;
    expect(client).toBe(fakeTx);
    expect(eventType).toBe(ACCOUNT_CREATED_EVENT_TYPE);
    expect(payload).toMatchObject({
      accountId: '99',
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
    expect(fakeTx.account.create).not.toHaveBeenCalled();
    expect(outboxPublisher.publish).not.toHaveBeenCalled();
  });

  it('unregistered phone → byte-equal response shape vs ACTIVE path (accountId/access/refresh keys present)', async () => {
    const result = await useCase.execute(phone, code);
    expect(Object.keys(result).sort()).toEqual(
      ['accessToken', 'accountId', 'refreshToken'].sort(),
    );
  });
});

// ===== US3 anti-enumeration (per CL-006) =====

const baseAccountRow = {
  id: 7n,
  phone: '+8613800138701',
  status: 'ACTIVE' as const,
  created_at: new Date('2026-01-01T00:00:00Z'),
  last_login_at: null,
  freeze_until: null as Date | null,
  display_name: null,
};

function buildUseCaseHarness(): {
  accountRepo: AccountRepository;
  smsCodeRepo: SmsCodeRepository;
  jwtTokenService: JwtTokenService;
  outboxPublisher: OutboxPublisher;
  prismaService: PrismaService;
  timingDefense: TimingDefenseExecutor;
  useCase: PhoneSmsAuthUseCase;
} {
  const accountRepo: AccountRepository = {
    findById: vi.fn(),
    findByPhone: vi.fn(),
    save: vi.fn().mockResolvedValue(undefined),
    updateLastLoginAt: vi.fn().mockResolvedValue(undefined),
    updateDisplayName: vi.fn().mockResolvedValue(undefined),
  };
  const smsCodeRepo: SmsCodeRepository = {
    store: vi.fn().mockResolvedValue(undefined),
    verify: vi.fn().mockResolvedValue(true),
    clear: vi.fn().mockResolvedValue(undefined),
  };
  const jwtTokenService = {
    signAccessToken: vi.fn().mockReturnValue('access-token-us3'),
    generateRefreshToken: vi.fn().mockReturnValue('refresh-token-us3'),
  } as unknown as JwtTokenService;
  const outboxPublisher: OutboxPublisher = {
    publish: vi.fn().mockResolvedValue(undefined),
  };
  const prismaService = {
    $transaction: vi.fn(),
  } as unknown as PrismaService;
  const timingDefense: TimingDefenseExecutor = {
    pad: vi.fn().mockResolvedValue(undefined),
  };
  const useCase = new (PhoneSmsAuthUseCase as unknown as UseCaseCtor)(
    accountRepo,
    smsCodeRepo,
    jwtTokenService,
    outboxPublisher,
    prismaService,
    timingDefense,
    buildAuthFailureLockMock(),
  );
  return {
    accountRepo,
    smsCodeRepo,
    jwtTokenService,
    outboxPublisher,
    prismaService,
    timingDefense,
    useCase,
  };
}

describe('PhoneSmsAuthUseCase US3 FROZEN disclosure path (CL-006)', () => {
  const phone = Phone.create('+8613800138701');
  const code = SmsCode.create('123456');
  const freezeUntil = new Date('2026-06-17T00:00:00Z');

  it('FROZEN + correct code → throws AccountInFreezePeriodException with freezeUntil (HTTP 403)', async () => {
    const h = buildUseCaseHarness();
    vi.mocked(h.accountRepo.findByPhone).mockResolvedValue(
      Account.fromPrisma({
        ...baseAccountRow,
        status: 'FROZEN',
        freeze_until: freezeUntil,
      }),
    );

    let caught: unknown;
    try {
      await h.useCase.execute(phone, code);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AccountInFreezePeriodException);
    expect((caught as AccountInFreezePeriodException).freezeUntil).toEqual(
      freezeUntil,
    );
  });

  it('FROZEN does NOT call timingDefense.pad (disclosure path, FR-S06 + CL-006)', async () => {
    const h = buildUseCaseHarness();
    vi.mocked(h.accountRepo.findByPhone).mockResolvedValue(
      Account.fromPrisma({
        ...baseAccountRow,
        status: 'FROZEN',
        freeze_until: freezeUntil,
      }),
    );

    await expect(h.useCase.execute(phone, code)).rejects.toBeInstanceOf(
      AccountInFreezePeriodException,
    );
    expect(h.timingDefense.pad).not.toHaveBeenCalled();
  });

  it('FROZEN does not sign token / not updateLastLoginAt / not verify code', async () => {
    const h = buildUseCaseHarness();
    vi.mocked(h.accountRepo.findByPhone).mockResolvedValue(
      Account.fromPrisma({
        ...baseAccountRow,
        status: 'FROZEN',
        freeze_until: freezeUntil,
      }),
    );

    await expect(h.useCase.execute(phone, code)).rejects.toBeInstanceOf(
      AccountInFreezePeriodException,
    );
    expect(h.smsCodeRepo.verify).not.toHaveBeenCalled();
    expect(h.accountRepo.updateLastLoginAt).not.toHaveBeenCalled();
    expect(h.jwtTokenService.signAccessToken).not.toHaveBeenCalled();
  });
});

describe('PhoneSmsAuthUseCase US3 ANONYMIZED anti-enumeration (CL-006)', () => {
  const phone = Phone.create('+8613800138702');
  const code = SmsCode.create('123456');

  it('ANONYMIZED + correct code → timingDefense.pad called → throws UnauthorizedException', async () => {
    const h = buildUseCaseHarness();
    vi.mocked(h.accountRepo.findByPhone).mockResolvedValue(
      Account.fromPrisma({ ...baseAccountRow, status: 'ANONYMIZED' }),
    );

    await expect(h.useCase.execute(phone, code)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(h.timingDefense.pad).toHaveBeenCalledTimes(1);
    expect(h.jwtTokenService.signAccessToken).not.toHaveBeenCalled();
    expect(h.accountRepo.updateLastLoginAt).not.toHaveBeenCalled();
  });
});

describe('PhoneSmsAuthUseCase US3 timing defense across 3 anti-enum 401 paths', () => {
  const phone = Phone.create('+8613800138703');
  const code = SmsCode.create('123456');

  it('path 1 ACTIVE + verify false → timingDefense.pad invoked before 401', async () => {
    const h = buildUseCaseHarness();
    vi.mocked(h.accountRepo.findByPhone).mockResolvedValue(
      Account.fromPrisma(baseAccountRow),
    );
    vi.mocked(h.smsCodeRepo.verify).mockResolvedValue(false);

    await expect(h.useCase.execute(phone, code)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(h.timingDefense.pad).toHaveBeenCalledTimes(1);
  });

  it('path 2 ACTIVE + verify null (code expired) → timingDefense.pad invoked before 401', async () => {
    const h = buildUseCaseHarness();
    vi.mocked(h.accountRepo.findByPhone).mockResolvedValue(
      Account.fromPrisma(baseAccountRow),
    );
    vi.mocked(h.smsCodeRepo.verify).mockResolvedValue(null);

    await expect(h.useCase.execute(phone, code)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(h.timingDefense.pad).toHaveBeenCalledTimes(1);
  });

  it('path 3 ANONYMIZED + correct code → timingDefense.pad invoked before 401', async () => {
    const h = buildUseCaseHarness();
    vi.mocked(h.accountRepo.findByPhone).mockResolvedValue(
      Account.fromPrisma({ ...baseAccountRow, status: 'ANONYMIZED' }),
    );

    await expect(h.useCase.execute(phone, code)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(h.timingDefense.pad).toHaveBeenCalledTimes(1);
  });
});
