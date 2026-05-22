import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { execFileSync } from 'node:child_process';
import { PrismaService } from '../../security/prisma.service';
import { AccountPrismaRepository } from './account.prisma.repository';
import { Phone } from '../domain/phone.vo';
import { AccountStatus } from '../domain/account.aggregate';

// vitest runs with cwd = apps/server (per project.json test target).
const SERVER_DIR = process.cwd();

describe('AccountPrismaRepository (Testcontainers PG)', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaService;
  let repo: AccountPrismaRepository;

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
    repo = new AccountPrismaRepository(prisma);
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  it('returns Account aggregate for existing ACTIVE row', async () => {
    await prisma.account.create({
      data: { phone: '+8613800138001', status: 'ACTIVE' },
    });

    const found = await repo.findByPhone(Phone.create('+8613800138001'));

    expect(found).not.toBeNull();
    expect(found!.phone.value).toBe('+8613800138001');
    expect(found!.status).toBe(AccountStatus.ACTIVE);
    expect(found!.isActive()).toBe(true);
    expect(found!.lastLoginAt).toBeNull();
  });

  it('returns Account aggregate preserving FROZEN status', async () => {
    await prisma.account.create({
      data: { phone: '+8613800138002', status: 'FROZEN' },
    });

    const found = await repo.findByPhone(Phone.create('+8613800138002'));

    expect(found).not.toBeNull();
    expect(found!.status).toBe(AccountStatus.FROZEN);
    expect(found!.isFrozen()).toBe(true);
  });

  it('returns null for non-existent phone', async () => {
    const found = await repo.findByPhone(Phone.create('+8613900000000'));
    expect(found).toBeNull();
  });
});
