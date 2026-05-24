import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { PhoneSmsAuthUseCase } from './phone-sms-auth.usecase';
import { Phone } from '../../account/domain/phone.vo';
import { SmsCode } from '../domain/sms-code.vo';
import { AccountInFreezePeriodException } from '../../account/domain/account-in-freeze-period.exception';
import type { SmsCodeStore } from '../infrastructure/sms-code.store';
import type { OutboxPublisher } from '../../security/outbox/outbox-publisher.port';
import type { TimingDefenseExecutor } from './ports/timing-defense.port';
import type { JwtTokenService } from '../../security/jwt-token.service';
import type { PrismaService } from '../../security/prisma.service';
import type { AuthFailureLockService } from '../infrastructure/auth-failure-lock.service';
import { ACCOUNT_CREATED_EVENT_TYPE } from '../../account/domain/events/account-created.event';

// PhoneSmsAuthUseCase ctor (post-ADR-0043 R-2+3): repository ports 删除,
// 直注 PrismaService + 具体 SmsCodeStore。6 args。
type UseCaseCtor = new (
  smsCodeStore: SmsCodeStore,
  jwtTokenService: JwtTokenService,
  outboxPublisher: OutboxPublisher,
  prismaService: PrismaService,
  timingDefense: TimingDefenseExecutor,
  authFailureLock: AuthFailureLockService,
) => PhoneSmsAuthUseCase;

type Fn = ReturnType<typeof vi.fn>;

function buildAuthFailureLockMock(): AuthFailureLockService {
  return {
    assertNotLocked: vi.fn().mockResolvedValue(undefined),
    recordFailure: vi.fn().mockResolvedValue(undefined),
  } as unknown as AuthFailureLockService;
}

// raw Prisma `Account` row (camelCase via @map, per ADR-0043 + C-1)。
const activeAccountRow = {
  id: 42n,
  phone: '+8613800138401',
  status: 'ACTIVE',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  lastLoginAt: null,
  displayName: null,
  freezeUntil: null,
  previousPhoneHash: null,
};

describe('PhoneSmsAuthUseCase ACTIVE path (US1)', () => {
  let findUnique: Fn;
  let update: Fn;
  let storeVerify: Fn;
  let storeClear: Fn;
  let smsCodeStore: SmsCodeStore;
  let jwtTokenService: JwtTokenService;
  let useCase: PhoneSmsAuthUseCase;

  const phone = Phone.create('+8613800138401');
  const code = SmsCode.create('123456');

  beforeEach(() => {
    findUnique = vi.fn();
    update = vi.fn().mockResolvedValue(undefined);
    storeVerify = vi.fn();
    storeClear = vi.fn().mockResolvedValue(undefined);
    smsCodeStore = {
      store: vi.fn().mockResolvedValue(undefined),
      verify: storeVerify,
      clear: storeClear,
    } as unknown as SmsCodeStore;
    jwtTokenService = {
      signAccessToken: vi.fn().mockReturnValue('access-token-xyz'),
      generateRefreshToken: vi.fn().mockReturnValue('refresh-token-xyz'),
    } as unknown as JwtTokenService;
    const outboxPublisher: OutboxPublisher = { publish: vi.fn().mockResolvedValue(undefined) };
    const prismaService = {
      account: { findUnique, update },
      $transaction: vi.fn(),
    } as unknown as PrismaService;
    const timingDefense: TimingDefenseExecutor = { pad: vi.fn().mockResolvedValue(undefined) };
    useCase = new (PhoneSmsAuthUseCase as unknown as UseCaseCtor)(
      smsCodeStore,
      jwtTokenService,
      outboxPublisher,
      prismaService,
      timingDefense,
      buildAuthFailureLockMock(),
    );
  });

  it('ACTIVE + matching code → tokens + DB updates', async () => {
    findUnique.mockResolvedValue(activeAccountRow);
    storeVerify.mockResolvedValue(true);

    const result = await useCase.execute(phone, code);

    expect(result.accountId).toBe(42n);
    expect(result.accessToken).toBe('access-token-xyz');
    expect(result.refreshToken).toBe('refresh-token-xyz');

    expect(storeClear).toHaveBeenCalledWith(phone);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      where: { id: 42n },
      data: { lastLoginAt: expect.any(Date) },
    });
  });

  it('ACTIVE + code mismatch (verify false) → 401 INVALID_CREDENTIALS', async () => {
    findUnique.mockResolvedValue(activeAccountRow);
    storeVerify.mockResolvedValue(false);

    await expect(useCase.execute(phone, code)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(storeClear).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('ACTIVE + code expired (verify null) → 401 INVALID_CREDENTIALS', async () => {
    findUnique.mockResolvedValue(activeAccountRow);
    storeVerify.mockResolvedValue(null);

    await expect(useCase.execute(phone, code)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(update).not.toHaveBeenCalled();
  });

  it('signs access token with bigint accountId payload', async () => {
    findUnique.mockResolvedValue(activeAccountRow);
    storeVerify.mockResolvedValue(true);

    await useCase.execute(phone, code);

    expect(jwtTokenService.signAccessToken).toHaveBeenCalledWith({ accountId: 42n });
    expect(jwtTokenService.generateRefreshToken).toHaveBeenCalledTimes(1);
  });
});

describe('PhoneSmsAuthUseCase US2 unregistered auto-register path', () => {
  let findUnique: Fn;
  let storeVerify: Fn;
  let outboxPublisher: OutboxPublisher;
  let fakeTx: { account: { create: Fn } };
  let useCase: PhoneSmsAuthUseCase;

  const phone = Phone.create('+8613900139001');
  const code = SmsCode.create('123456');

  beforeEach(() => {
    findUnique = vi.fn().mockResolvedValue(null);
    storeVerify = vi.fn().mockResolvedValue(true);
    const smsCodeStore = {
      store: vi.fn().mockResolvedValue(undefined),
      verify: storeVerify,
      clear: vi.fn().mockResolvedValue(undefined),
    } as unknown as SmsCodeStore;
    const jwtTokenService = {
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
          createdAt: new Date('2026-05-17T12:00:00Z'),
          lastLoginAt: new Date('2026-05-17T12:00:00Z'),
        }),
      },
    };
    const prismaService = {
      account: { findUnique, update: vi.fn() },
      $transaction: vi
        .fn()
        .mockImplementation(async (cb: (tx: typeof fakeTx) => unknown) => cb(fakeTx)),
    } as unknown as PrismaService;
    const timingDefense: TimingDefenseExecutor = { pad: vi.fn().mockResolvedValue(undefined) };

    useCase = new (PhoneSmsAuthUseCase as unknown as UseCaseCtor)(
      smsCodeStore,
      jwtTokenService,
      outboxPublisher,
      prismaService,
      timingDefense,
      buildAuthFailureLockMock(),
    );
  });

  it('unregistered phone → create Account ACTIVE in tx + publish AccountCreatedEvent + return tokens', async () => {
    const result = await useCase.execute(phone, code);

    expect(fakeTx.account.create).toHaveBeenCalledTimes(1);
    const createArgs = fakeTx.account.create.mock.calls[0]![0] as {
      data: { phone: string; status: string };
    };
    expect(createArgs.data.phone).toBe('+8613900139001');
    expect(createArgs.data.status).toBe('ACTIVE');

    // outbox publish in same tx (first arg is the tx, not undefined)
    expect(outboxPublisher.publish).toHaveBeenCalledTimes(1);
    const [client, eventType, payload] = vi.mocked(outboxPublisher.publish).mock.calls[0]!;
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
    storeVerify.mockResolvedValue(false);

    await expect(useCase.execute(phone, code)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(fakeTx.account.create).not.toHaveBeenCalled();
    expect(outboxPublisher.publish).not.toHaveBeenCalled();
  });

  it('unregistered phone → byte-equal response shape vs ACTIVE path (accountId/access/refresh keys present)', async () => {
    const result = await useCase.execute(phone, code);
    expect(Object.keys(result).sort()).toEqual(['accessToken', 'accountId', 'refreshToken'].sort());
  });
});

// ===== US3 anti-enumeration (per CL-006) =====

const baseAccountRow = {
  id: 7n,
  phone: '+8613800138701',
  status: 'ACTIVE',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  lastLoginAt: null,
  displayName: null,
  freezeUntil: null as Date | null,
  previousPhoneHash: null,
};

interface Harness {
  findUnique: Fn;
  update: Fn;
  storeVerify: Fn;
  jwtTokenService: JwtTokenService;
  timingDefense: TimingDefenseExecutor;
  useCase: PhoneSmsAuthUseCase;
}

function buildUseCaseHarness(): Harness {
  const findUnique = vi.fn();
  const update = vi.fn().mockResolvedValue(undefined);
  const storeVerify = vi.fn().mockResolvedValue(true);
  const smsCodeStore = {
    store: vi.fn().mockResolvedValue(undefined),
    verify: storeVerify,
    clear: vi.fn().mockResolvedValue(undefined),
  } as unknown as SmsCodeStore;
  const jwtTokenService = {
    signAccessToken: vi.fn().mockReturnValue('access-token-us3'),
    generateRefreshToken: vi.fn().mockReturnValue('refresh-token-us3'),
  } as unknown as JwtTokenService;
  const outboxPublisher: OutboxPublisher = { publish: vi.fn().mockResolvedValue(undefined) };
  const prismaService = {
    account: { findUnique, update },
    $transaction: vi.fn(),
  } as unknown as PrismaService;
  const timingDefense: TimingDefenseExecutor = { pad: vi.fn().mockResolvedValue(undefined) };
  const useCase = new (PhoneSmsAuthUseCase as unknown as UseCaseCtor)(
    smsCodeStore,
    jwtTokenService,
    outboxPublisher,
    prismaService,
    timingDefense,
    buildAuthFailureLockMock(),
  );
  return { findUnique, update, storeVerify, jwtTokenService, timingDefense, useCase };
}

describe('PhoneSmsAuthUseCase US3 FROZEN disclosure path (CL-006)', () => {
  const phone = Phone.create('+8613800138701');
  const code = SmsCode.create('123456');
  const freezeUntil = new Date('2026-06-17T00:00:00Z');

  it('FROZEN + correct code → throws AccountInFreezePeriodException with freezeUntil (HTTP 403)', async () => {
    const h = buildUseCaseHarness();
    h.findUnique.mockResolvedValue({ ...baseAccountRow, status: 'FROZEN', freezeUntil });

    let caught: unknown;
    try {
      await h.useCase.execute(phone, code);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AccountInFreezePeriodException);
    expect((caught as AccountInFreezePeriodException).freezeUntil).toEqual(freezeUntil);
  });

  it('FROZEN does NOT call timingDefense.pad (disclosure path, FR-S06 + CL-006)', async () => {
    const h = buildUseCaseHarness();
    h.findUnique.mockResolvedValue({ ...baseAccountRow, status: 'FROZEN', freezeUntil });

    await expect(h.useCase.execute(phone, code)).rejects.toBeInstanceOf(
      AccountInFreezePeriodException,
    );
    expect(h.timingDefense.pad).not.toHaveBeenCalled();
  });

  it('FROZEN does not sign token / not update lastLogin / not verify code', async () => {
    const h = buildUseCaseHarness();
    h.findUnique.mockResolvedValue({ ...baseAccountRow, status: 'FROZEN', freezeUntil });

    await expect(h.useCase.execute(phone, code)).rejects.toBeInstanceOf(
      AccountInFreezePeriodException,
    );
    expect(h.storeVerify).not.toHaveBeenCalled();
    expect(h.update).not.toHaveBeenCalled();
    expect(h.jwtTokenService.signAccessToken).not.toHaveBeenCalled();
  });
});

describe('PhoneSmsAuthUseCase US3 ANONYMIZED anti-enumeration (CL-006)', () => {
  const phone = Phone.create('+8613800138702');
  const code = SmsCode.create('123456');

  it('ANONYMIZED + correct code → timingDefense.pad called → throws UnauthorizedException', async () => {
    const h = buildUseCaseHarness();
    h.findUnique.mockResolvedValue({ ...baseAccountRow, status: 'ANONYMIZED' });

    await expect(h.useCase.execute(phone, code)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(h.timingDefense.pad).toHaveBeenCalledTimes(1);
    expect(h.jwtTokenService.signAccessToken).not.toHaveBeenCalled();
    expect(h.update).not.toHaveBeenCalled();
  });
});

describe('PhoneSmsAuthUseCase US3 timing defense across 3 anti-enum 401 paths', () => {
  const phone = Phone.create('+8613800138703');
  const code = SmsCode.create('123456');

  it('path 1 ACTIVE + verify false → timingDefense.pad invoked before 401', async () => {
    const h = buildUseCaseHarness();
    h.findUnique.mockResolvedValue(baseAccountRow);
    h.storeVerify.mockResolvedValue(false);

    await expect(h.useCase.execute(phone, code)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(h.timingDefense.pad).toHaveBeenCalledTimes(1);
  });

  it('path 2 ACTIVE + verify null (code expired) → timingDefense.pad invoked before 401', async () => {
    const h = buildUseCaseHarness();
    h.findUnique.mockResolvedValue(baseAccountRow);
    h.storeVerify.mockResolvedValue(null);

    await expect(h.useCase.execute(phone, code)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(h.timingDefense.pad).toHaveBeenCalledTimes(1);
  });

  it('path 3 ANONYMIZED + correct code → timingDefense.pad invoked before 401', async () => {
    const h = buildUseCaseHarness();
    h.findUnique.mockResolvedValue({ ...baseAccountRow, status: 'ANONYMIZED' });

    await expect(h.useCase.execute(phone, code)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(h.timingDefense.pad).toHaveBeenCalledTimes(1);
  });
});
