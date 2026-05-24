import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Phone } from '../../account/domain/phone.vo';
import { SmsCode } from '../domain/sms-code.vo';
import {
  ACCOUNT_REPOSITORY,
  type AccountRepository,
} from '../../account/application/ports/account.repository.port';
import { SMS_CODE_REPOSITORY, type SmsCodeRepository } from './ports/sms-code.repository.port';
import {
  OUTBOX_PUBLISHER,
  type OutboxPublisher,
} from '../../security/outbox/outbox-publisher.port';
import { TIMING_DEFENSE_EXECUTOR, type TimingDefenseExecutor } from './ports/timing-defense.port';
import { AuthFailureLockService } from '../infrastructure/auth-failure-lock.service';
import { JwtTokenService } from '../../security/jwt-token.service';
import { PrismaService } from '../../security/prisma.service';
import {
  ACCOUNT_CREATED_EVENT_TYPE,
  AccountCreatedEvent,
} from '../../account/domain/events/account-created.event';
import { AccountInFreezePeriodException } from '../../account/domain/account-in-freeze-period.exception';

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
    @Inject(OUTBOX_PUBLISHER)
    private readonly outboxPublisher: OutboxPublisher,
    private readonly prisma: PrismaService,
    @Inject(TIMING_DEFENSE_EXECUTOR)
    private readonly timingDefense: TimingDefenseExecutor,
    private readonly authFailureLock: AuthFailureLockService,
  ) {}

  async execute(phone: Phone, code: SmsCode): Promise<PhoneSmsAuthResult> {
    // FR-S07 #4: lock check — locked phone 直接 throw 429 + Retry-After。
    await this.authFailureLock.assertNotLocked(phone);
    try {
      return await this.executeInternal(phone, code);
    } catch (err) {
      // 仅 UnauthorizedException 算认证失败 (码错 / 码过期 / ANONYMIZED 反枚举)。
      // FROZEN 抛 AccountInFreezePeriodException 不算失败 (合法 403)。
      if (err instanceof UnauthorizedException) {
        await this.authFailureLock.recordFailure(phone);
      }
      throw err;
    }
  }

  private async executeInternal(phone: Phone, code: SmsCode): Promise<PhoneSmsAuthResult> {
    const account = await this.accountRepo.findByPhone(phone);

    if (!account) {
      return this.handleUnregistered(phone, code);
    }

    // CL-006 FROZEN disclosure — 403 + freezeUntil, NOT in timing pad scope.
    if (account.isFrozen()) {
      throw new AccountInFreezePeriodException(account.freezeUntil ?? new Date());
    }

    // CL-006 ANONYMIZED anti-enumeration — 401 + dummy bcrypt timing pad.
    if (account.isAnonymized()) {
      await this.timingDefense.pad();
      throw new UnauthorizedException('INVALID_CREDENTIALS');
    }

    // ACTIVE path
    const verifyResult = await this.smsCodeRepo.verify(phone, code);
    if (verifyResult !== true) {
      // FR-S06 timing defense: 码错 / 码过期 → pad before throw.
      await this.timingDefense.pad();
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

  private async handleUnregistered(phone: Phone, code: SmsCode): Promise<PhoneSmsAuthResult> {
    const verifyResult = await this.smsCodeRepo.verify(phone, code);
    if (verifyResult !== true) {
      // FR-S06 timing defense: 未注册 + 码错 → pad before throw.
      await this.timingDefense.pad();
      throw new UnauthorizedException('INVALID_CREDENTIALS');
    }

    let newAccountId: bigint;
    try {
      const row = await this.prisma.$transaction(
        async (tx) => {
          const created = await tx.account.create({
            data: {
              phone: phone.value,
              status: 'ACTIVE',
              lastLoginAt: new Date(),
            },
          });

          const event = AccountCreatedEvent.create(created.id, phone.value, created.createdAt);
          await this.outboxPublisher.publish(
            tx,
            ACCOUNT_CREATED_EVENT_TYPE,
            event.payload as unknown as Record<string, unknown>,
          );

          return created;
        },
        { isolationLevel: 'Serializable' },
      );
      newAccountId = row.id;
    } catch (e) {
      // FR-S08 race fallback: 并发同号注册 → unique violation 落到 login 路径.
      if (isPrismaUniqueViolation(e)) {
        const existing = await this.accountRepo.findByPhone(phone);
        if (!existing) {
          throw e;
        }
        existing.markLoggedIn();
        await this.accountRepo.updateLastLoginAt(existing.id, new Date());
        newAccountId = existing.id;
      } else {
        throw e;
      }
    }

    await this.smsCodeRepo.clear(phone);

    const accessToken = this.jwtTokenService.signAccessToken({
      accountId: newAccountId,
    });
    const refreshToken = this.jwtTokenService.generateRefreshToken();

    return { accountId: newAccountId, accessToken, refreshToken };
  }
}

function isPrismaUniqueViolation(e: unknown): boolean {
  return (
    typeof e === 'object' && e !== null && 'code' in e && (e as { code?: unknown }).code === 'P2002'
  );
}
