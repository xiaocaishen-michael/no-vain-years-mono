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
import {
  OUTBOX_PUBLISHER,
  type OutboxPublisher,
} from './ports/outbox-publisher.port';
import { JwtTokenService } from '../infrastructure/jwt-token.service';
import { PrismaService } from '../infrastructure/prisma.service';
import {
  ACCOUNT_CREATED_EVENT_TYPE,
  AccountCreatedEvent,
} from '../domain/events/account-created.event';

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
  ) {}

  async execute(phone: Phone, code: SmsCode): Promise<PhoneSmsAuthResult> {
    const account = await this.accountRepo.findByPhone(phone);

    if (!account) {
      return this.handleUnregistered(phone, code);
    }

    // US3 territory — FROZEN/ANONYMIZED. 反枚举完整实装在 T036/T037.
    if (!account.isActive()) {
      throw new UnauthorizedException('INVALID_CREDENTIALS');
    }

    const verifyResult = await this.smsCodeRepo.verify(phone, code);
    if (verifyResult !== true) {
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

  private async handleUnregistered(
    phone: Phone,
    code: SmsCode,
  ): Promise<PhoneSmsAuthResult> {
    // FR-S05 sub-clause: code 必须先匹配, 再自动注册 (拒绝任意 code 触发注册).
    const verifyResult = await this.smsCodeRepo.verify(phone, code);
    if (verifyResult !== true) {
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
              last_login_at: new Date(),
            },
          });

          const event = AccountCreatedEvent.create(
            created.id,
            phone.value,
            created.created_at,
          );
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
    typeof e === 'object' &&
    e !== null &&
    'code' in e &&
    (e as { code?: unknown }).code === 'P2002'
  );
}
