import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { GetAccountProfileUseCase } from './get-account-profile.usecase';
import { Account, AccountStatus } from '../domain/account.aggregate';
import type { AccountRepository } from './ports/account.repository.port';

function buildAccountRepoMock(): AccountRepository {
  return {
    findById: vi.fn(),
    findByPhone: vi.fn(),
    save: vi.fn().mockResolvedValue(undefined),
    updateLastLoginAt: vi.fn().mockResolvedValue(undefined),
    updateDisplayName: vi.fn().mockResolvedValue(undefined),
  } as unknown as AccountRepository;
}

// US1: new user — displayName null (profile missing signal, FR-007)
describe('GetAccountProfileUseCase US1 — new user, displayName null', () => {
  let accountRepo: AccountRepository;
  let useCase: GetAccountProfileUseCase;

  const accountId = 42n;
  const row = {
    id: accountId,
    phone: '+8613800138001',
    status: 'ACTIVE' as const,
    created_at: new Date('2026-01-01T00:00:00Z'),
    last_login_at: null,
    freeze_until: null,
    display_name: null,
  };

  beforeEach(() => {
    accountRepo = buildAccountRepoMock();
    useCase = new GetAccountProfileUseCase(accountRepo);
    vi.mocked(accountRepo.findById).mockResolvedValue(Account.fromPrisma(row));
  });

  it('displayName is null when not yet set (FR-007 auto-create default)', async () => {
    const result = await useCase.execute(accountId);
    expect(result.displayName).toBeNull();
  });

  it('returns correct accountId, phone, status, createdAt', async () => {
    const result = await useCase.execute(accountId);
    expect(result.accountId).toBe(accountId);
    expect(result.phone).toBe('+8613800138001');
    expect(result.status).toBe(AccountStatus.ACTIVE);
    expect(result.createdAt).toEqual(row.created_at);
  });

  it('phone is raw E.164 string — mask deferred to frontend (FR-001)', async () => {
    const result = await useCase.execute(accountId);
    expect(result.phone).toBe('+8613800138001');
    expect(result.phone.startsWith('+')).toBe(true);
  });

  it('response has exactly the expected keys (AccountProfileResult shape)', async () => {
    const result = await useCase.execute(accountId);
    expect(Object.keys(result).sort()).toEqual(
      ['accountId', 'createdAt', 'displayName', 'phone', 'status'].sort(),
    );
  });

  it('calls findById with the provided accountId', async () => {
    await useCase.execute(accountId);
    expect(accountRepo.findById).toHaveBeenCalledWith(accountId);
    expect(accountRepo.findById).toHaveBeenCalledTimes(1);
  });
});

// US3: returning user — profile already complete
describe('GetAccountProfileUseCase US3 — returning user, displayName set', () => {
  let accountRepo: AccountRepository;
  let useCase: GetAccountProfileUseCase;

  const accountId = 99n;
  const row = {
    id: accountId,
    phone: '+8613900139001',
    status: 'ACTIVE' as const,
    created_at: new Date('2025-06-01T00:00:00Z'),
    last_login_at: new Date('2026-05-20T12:00:00Z'),
    freeze_until: null,
    display_name: '张三',
  };

  beforeEach(() => {
    accountRepo = buildAccountRepoMock();
    useCase = new GetAccountProfileUseCase(accountRepo);
    vi.mocked(accountRepo.findById).mockResolvedValue(Account.fromPrisma(row));
  });

  it('returns displayName string when set', async () => {
    const result = await useCase.execute(accountId);
    expect(result.displayName).toBe('张三');
  });

  it('displayName is the trimmed string value (not a VO object)', async () => {
    const result = await useCase.execute(accountId);
    expect(typeof result.displayName).toBe('string');
  });

  it('returns correct full profile shape', async () => {
    const result = await useCase.execute(accountId);
    expect(result.accountId).toBe(accountId);
    expect(result.phone).toBe('+8613900139001');
    expect(result.status).toBe(AccountStatus.ACTIVE);
    expect(result.createdAt).toEqual(row.created_at);
  });
});

// Not found path
describe('GetAccountProfileUseCase — account not found', () => {
  let accountRepo: AccountRepository;
  let useCase: GetAccountProfileUseCase;

  beforeEach(() => {
    accountRepo = buildAccountRepoMock();
    useCase = new GetAccountProfileUseCase(accountRepo);
    vi.mocked(accountRepo.findById).mockResolvedValue(null);
  });

  it('throws NotFoundException when account does not exist', async () => {
    await expect(useCase.execute(1n)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('NotFoundException message is ACCOUNT_NOT_FOUND', async () => {
    await expect(useCase.execute(1n)).rejects.toMatchObject({
      message: 'ACCOUNT_NOT_FOUND',
    });
  });
});
