import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { PhoneSmsAuthUseCase } from './phone-sms-auth.usecase';
import { Phone } from '../domain/phone.vo';
import { SmsCode } from '../domain/sms-code.vo';
import { Account } from '../domain/account.aggregate';
import type { AccountRepository } from './ports/account.repository.port';
import type { SmsCodeRepository } from './ports/sms-code.repository.port';
import type { JwtTokenService } from '../infrastructure/jwt-token.service';

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
