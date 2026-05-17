import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Phone } from '../domain/phone.vo';
import { SmsCode } from '../domain/sms-code.vo';
import {
  ACCOUNT_REPOSITORY,
  type AccountRepository,
} from './ports/account.repository.port';
import {
  SMS_CODE_REPOSITORY,
  type SmsCodeRepository,
} from './ports/sms-code.repository.port';
import { JwtTokenService } from '../infrastructure/jwt-token.service';

export interface PhoneSmsAuthResult {
  accountId: bigint;
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class PhoneSmsAuthUseCase {
  constructor(
    @Inject(ACCOUNT_REPOSITORY)
    private readonly accountRepo: AccountRepository,
    @Inject(SMS_CODE_REPOSITORY)
    private readonly smsCodeRepo: SmsCodeRepository,
    private readonly jwtTokenService: JwtTokenService,
  ) {}

  async execute(phone: Phone, code: SmsCode): Promise<PhoneSmsAuthResult> {
    const account = await this.accountRepo.findByPhone(phone);

    // US2 unregistered auto-register path: defer T030 (transactional create + outbox).
    // US3 FROZEN/ANONYMIZED anti-enumeration: defer T036+T037 (timing defense).
    // For US1 ACTIVE-only: account must exist + be ACTIVE + code must match.
    if (!account || !account.isActive()) {
      throw new UnauthorizedException('INVALID_CREDENTIALS');
    }

    const verifyResult = await this.smsCodeRepo.verify(phone, code);
    if (verifyResult !== true) {
      // false (mismatch) or null (expired/never stored) — both 401 per FR-S06.
      throw new UnauthorizedException('INVALID_CREDENTIALS');
    }

    await this.smsCodeRepo.clear(phone);

    const loginAt = new Date();
    account.markLoggedIn();
    await this.accountRepo.updateLastLoginAt(account.id, loginAt);

    const accessToken = this.jwtTokenService.signAccessToken({
      accountId: account.id,
    });
    const refreshToken = this.jwtTokenService.generateRefreshToken();

    return { accountId: account.id, accessToken, refreshToken };
  }
}
