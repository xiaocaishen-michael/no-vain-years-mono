import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { execFileSync } from 'node:child_process';
import { PrismaService } from '../infrastructure/prisma.service';
import { AccountPrismaRepository } from '../infrastructure/account.prisma.repository';
import { OutboxEventPrismaPublisher } from '../infrastructure/outbox-event.prisma.publisher';
import { PhoneSmsAuthUseCase } from './phone-sms-auth.usecase';
import { Phone } from '../domain/phone.vo';
import { SmsCode } from '../domain/sms-code.vo';
import type { SmsCodeRepository } from './ports/sms-code.repository.port';
import type { OutboxPublisher } from './ports/outbox-publisher.port';
import type { JwtTokenService } from '../infrastructure/jwt-token.service';

// Same cast bridge as phone-sms-auth.usecase.spec.ts — T030 GREEN amends ctor.
type UseCaseCtor = new (
  accountRepo: AccountPrismaRepository,
  smsCodeRepo: SmsCodeRepository,
  jwtTokenService: JwtTokenService,
  outboxPublisher: OutboxPublisher,
) => PhoneSmsAuthUseCase;

const SERVER_DIR = process.cwd();

describe('PhoneSmsAuthUseCase concurrent auto-register race (Testcontainers PG)', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaService;
  let useCase: PhoneSmsAuthUseCase;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('test_mbw')
      .withUsername('test')
      .withPassword('test')
      .start();

    const url = container.getConnectionUri();

    execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
      cwd: SERVER_DIR,
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'inherit',
    });

    prisma = new PrismaService(url);

    const accountRepo = new AccountPrismaRepository(prisma);
    const outboxPublisher = new OutboxEventPrismaPublisher(prisma);

    const smsCodeRepo: SmsCodeRepository = {
      store: vi.fn().mockResolvedValue(undefined),
      verify: vi.fn().mockResolvedValue(true),
      clear: vi.fn().mockResolvedValue(undefined),
    };
    const jwtTokenService = {
      signAccessToken: vi.fn().mockReturnValue('access-token-race'),
      generateRefreshToken: vi.fn().mockReturnValue('refresh-token-race'),
    } as unknown as JwtTokenService;

    useCase = new (PhoneSmsAuthUseCase as unknown as UseCaseCtor)(
      accountRepo,
      smsCodeRepo,
      jwtTokenService,
      outboxPublisher,
    );
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  it('two parallel auto-registers for same NEW phone → 1 account row + same accountId returned', async () => {
    const phone = Phone.create('+8613900139777');
    const code = SmsCode.create('123456');

    const results = await Promise.all([
      useCase.execute(phone, code),
      useCase.execute(phone, code),
    ]);

    expect(results).toHaveLength(2);
    expect(results[0]!.accountId).toBe(results[1]!.accountId);

    const rows = await prisma.account.findMany({
      where: { phone: phone.value },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(results[0]!.accountId);
  });
});
