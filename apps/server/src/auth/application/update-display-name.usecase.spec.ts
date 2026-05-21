import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { UpdateDisplayNameUseCase } from './update-display-name.usecase';
import { Account, AccountStatus } from '../domain/account.aggregate';
import { AccountStateMachine } from '../domain/account-state-machine';
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

const activeRow = {
  id: 42n,
  phone: '+8613800138001',
  status: 'ACTIVE' as const,
  created_at: new Date('2026-01-01T00:00:00Z'),
  last_login_at: null,
  freeze_until: null,
  display_name: null,
};

// US2: ACTIVE account updates displayName — happy path
describe('UpdateDisplayNameUseCase — happy path (ACTIVE, valid displayName)', () => {
  let accountRepo: AccountRepository;
  let useCase: UpdateDisplayNameUseCase;

  beforeEach(() => {
    accountRepo = buildAccountRepoMock();
    useCase = new UpdateDisplayNameUseCase(accountRepo, new AccountStateMachine());
    vi.mocked(accountRepo.findById).mockResolvedValue(Account.fromPrisma(activeRow));
  });

  it('result has exactly the expected keys (FR-003 response shape)', async () => {
    const result = await useCase.execute(42n, '张三'); // 张三
    expect(Object.keys(result).sort()).toEqual(
      ['accountId', 'createdAt', 'displayName', 'phone', 'status'].sort(),
    );
  });

  it('returns accountId, phone, status, createdAt from account', async () => {
    const result = await useCase.execute(42n, '张三'); // 张三
    expect(result.accountId).toBe(42n);
    expect(result.phone).toBe('+8613800138001');
    expect(result.status).toBe(AccountStatus.ACTIVE);
    expect(result.createdAt).toEqual(activeRow.created_at);
  });

  it('returns trimmed displayName as primitive string (not VO object)', async () => {
    const result = await useCase.execute(42n, '张三'); // 张三
    expect(result.displayName).toBe('张三');
    expect(typeof result.displayName).toBe('string');
  });

  it('calls findById with the provided accountId', async () => {
    await useCase.execute(42n, 'Alice');
    expect(accountRepo.findById).toHaveBeenCalledWith(42n);
    expect(accountRepo.findById).toHaveBeenCalledTimes(1);
  });

  it('calls updateDisplayName with accountId and the new DisplayName VO', async () => {
    await useCase.execute(42n, 'Alice');
    expect(accountRepo.updateDisplayName).toHaveBeenCalledTimes(1);
    const [id, dn] = vi.mocked(accountRepo.updateDisplayName).mock.calls[0];
    expect(id).toBe(42n);
    expect(dn?.value).toBe('Alice');
  });
});

// FR-005 trim behaviour — whitespace stripped before store
describe('UpdateDisplayNameUseCase — FR-005 trim behaviour', () => {
  let accountRepo: AccountRepository;
  let useCase: UpdateDisplayNameUseCase;

  beforeEach(() => {
    accountRepo = buildAccountRepoMock();
    useCase = new UpdateDisplayNameUseCase(accountRepo, new AccountStateMachine());
    vi.mocked(accountRepo.findById).mockResolvedValue(Account.fromPrisma(activeRow));
  });

  it('leading/trailing whitespace is trimmed, stored trimmed value', async () => {
    const result = await useCase.execute(42n, '  Alice  ');
    expect(result.displayName).toBe('Alice');
  });

  it('trimmed value is persisted to repo (not the raw input)', async () => {
    await useCase.execute(42n, '  Bob  ');
    const [, dn] = vi.mocked(accountRepo.updateDisplayName).mock.calls[0];
    expect(dn?.value).toBe('Bob');
  });
});

// FR-005 valid display names — CJK / emoji / boundary
describe('UpdateDisplayNameUseCase — FR-005 valid displayName inputs', () => {
  let accountRepo: AccountRepository;
  let useCase: UpdateDisplayNameUseCase;

  beforeEach(() => {
    accountRepo = buildAccountRepoMock();
    useCase = new UpdateDisplayNameUseCase(accountRepo, new AccountStateMachine());
    vi.mocked(accountRepo.findById).mockResolvedValue(Account.fromPrisma(activeRow));
  });

  it('CJK characters are valid', async () => {
    const result = await useCase.execute(42n, '你好世界'); // 你好世界
    expect(result.displayName).toBe('你好世界');
  });

  it('single emoji is valid (1 Unicode code point, FR-005)', async () => {
    const emoji = String.fromCodePoint(0x1f60a); // 😊
    const result = await useCase.execute(42n, emoji);
    expect(result.displayName).toBe(emoji);
  });

  it('exactly 32 ASCII code points is valid (upper boundary)', async () => {
    const maxName = 'a'.repeat(32);
    const result = await useCase.execute(42n, maxName);
    expect(result.displayName).toBe(maxName);
  });

  it('emoji counted by Unicode code points not UTF-16 units', async () => {
    // 4 emoji = 4 code points (each is a surrogate pair but counts as 1)
    const emojiName = String.fromCodePoint(0x1f60a, 0x1f60a, 0x1f60a, 0x1f60a);
    const result = await useCase.execute(42n, emojiName);
    expect(result.displayName).toBe(emojiName);
  });
});

// FR-005 invalid displayName — throws INVALID_DISPLAY_NAME, repo NOT called
describe('UpdateDisplayNameUseCase — FR-005 invalid displayName throws', () => {
  let accountRepo: AccountRepository;
  let useCase: UpdateDisplayNameUseCase;

  beforeEach(() => {
    accountRepo = buildAccountRepoMock();
    useCase = new UpdateDisplayNameUseCase(accountRepo, new AccountStateMachine());
    vi.mocked(accountRepo.findById).mockResolvedValue(Account.fromPrisma(activeRow));
  });

  it('empty string throws INVALID_DISPLAY_NAME', async () => {
    await expect(useCase.execute(42n, '')).rejects.toMatchObject({
      message: expect.stringContaining('INVALID_DISPLAY_NAME'),
    });
  });

  it('whitespace-only string (trims to empty) throws INVALID_DISPLAY_NAME', async () => {
    await expect(useCase.execute(42n, '   ')).rejects.toMatchObject({
      message: expect.stringContaining('INVALID_DISPLAY_NAME'),
    });
  });

  it('33 code points (exceeds max) throws INVALID_DISPLAY_NAME', async () => {
    await expect(useCase.execute(42n, 'a'.repeat(33))).rejects.toMatchObject({
      message: expect.stringContaining('INVALID_DISPLAY_NAME'),
    });
  });

  it('control character (U+0001) throws INVALID_DISPLAY_NAME', async () => {
    await expect(useCase.execute(42n, 'abc\x01def')).rejects.toMatchObject({
      message: expect.stringContaining('INVALID_DISPLAY_NAME'),
    });
  });

  it('zero-width space (U+200B) throws INVALID_DISPLAY_NAME', async () => {
    const withZws = 'abc' + String.fromCodePoint(0x200b) + 'def';
    await expect(useCase.execute(42n, withZws)).rejects.toMatchObject({
      message: expect.stringContaining('INVALID_DISPLAY_NAME'),
    });
  });

  it('BOM (U+FEFF) throws INVALID_DISPLAY_NAME', async () => {
    const withBom = String.fromCodePoint(0xfeff) + 'name';
    await expect(useCase.execute(42n, withBom)).rejects.toMatchObject({
      message: expect.stringContaining('INVALID_DISPLAY_NAME'),
    });
  });

  it('line separator (U+2028) throws INVALID_DISPLAY_NAME', async () => {
    const withLineSep = 'abc' + String.fromCodePoint(0x2028) + 'def';
    await expect(useCase.execute(42n, withLineSep)).rejects.toMatchObject({
      message: expect.stringContaining('INVALID_DISPLAY_NAME'),
    });
  });

  it('updateDisplayName is NOT called when displayName is invalid', async () => {
    await expect(useCase.execute(42n, '')).rejects.toThrow();
    expect(accountRepo.updateDisplayName).not.toHaveBeenCalled();
  });
});

// Account not found
describe('UpdateDisplayNameUseCase — account not found', () => {
  let accountRepo: AccountRepository;
  let useCase: UpdateDisplayNameUseCase;

  beforeEach(() => {
    accountRepo = buildAccountRepoMock();
    useCase = new UpdateDisplayNameUseCase(accountRepo, new AccountStateMachine());
    vi.mocked(accountRepo.findById).mockResolvedValue(null);
  });

  it('throws NotFoundException', async () => {
    await expect(useCase.execute(1n, 'Alice')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('NotFoundException message is ACCOUNT_NOT_FOUND', async () => {
    await expect(useCase.execute(1n, 'Alice')).rejects.toMatchObject({
      message: 'ACCOUNT_NOT_FOUND',
    });
  });

  it('updateDisplayName is NOT called when account not found', async () => {
    await expect(useCase.execute(1n, 'Alice')).rejects.toThrow();
    expect(accountRepo.updateDisplayName).not.toHaveBeenCalled();
  });
});

// Non-ACTIVE account — state machine guards transition
describe('UpdateDisplayNameUseCase — non-ACTIVE account blocked by state machine', () => {
  let accountRepo: AccountRepository;
  let useCase: UpdateDisplayNameUseCase;

  beforeEach(() => {
    accountRepo = buildAccountRepoMock();
    useCase = new UpdateDisplayNameUseCase(accountRepo, new AccountStateMachine());
  });

  it('FROZEN account throws ACCOUNT_NOT_ACTIVE', async () => {
    vi.mocked(accountRepo.findById).mockResolvedValue(
      Account.fromPrisma({ ...activeRow, status: 'FROZEN' }),
    );
    await expect(useCase.execute(42n, 'Alice')).rejects.toMatchObject({
      message: expect.stringContaining('ACCOUNT_NOT_ACTIVE'),
    });
  });

  it('ANONYMIZED account throws ACCOUNT_NOT_ACTIVE', async () => {
    vi.mocked(accountRepo.findById).mockResolvedValue(
      Account.fromPrisma({ ...activeRow, status: 'ANONYMIZED' }),
    );
    await expect(useCase.execute(42n, 'Alice')).rejects.toMatchObject({
      message: expect.stringContaining('ACCOUNT_NOT_ACTIVE'),
    });
  });

  it('updateDisplayName is NOT called when account is not ACTIVE', async () => {
    vi.mocked(accountRepo.findById).mockResolvedValue(
      Account.fromPrisma({ ...activeRow, status: 'FROZEN' }),
    );
    await expect(useCase.execute(42n, 'Alice')).rejects.toThrow();
    expect(accountRepo.updateDisplayName).not.toHaveBeenCalled();
  });
});
