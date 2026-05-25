import { randomUUID } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { RefreshToken } from '../generated/prisma/client';
import { JwtTokenService } from './jwt-token.service';
import { PrismaService } from './prisma.service';
import { hashRefreshToken } from './refresh-token-hasher';
import {
  REFRESH_TTL_DAYS,
  isActive,
  normalizeDeviceType,
  scrubPrivateIp,
} from './refresh-token.rules';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_SERIALIZATION_RETRIES = 3;

/** persist 入参 —— device 元数据来自登录控制器透传 (X-Device-Id 头 + clientIp)。 */
export interface PersistRefreshTokenInput {
  deviceId?: string;
  deviceName?: string;
  deviceType?: string;
  clientIp?: string | null;
  loginMethod: string;
}

/** rotate 产出 —— 与 auth LoginResponse 同 shape (security 不 import auth 类型,由 auth usecase 映射)。 */
export interface RotatedTokens {
  accountId: bigint;
  accessToken: string;
  refreshToken: string;
}

/**
 * RefreshTokenService —— refresh-token 全生命周期, security 平台层持有
 * (PrismaService 直注无 repository + 贫血 Prisma row, per ADR-0043 §1)。
 * persist (签发即落库) / findActiveByHash (查活) / rotate (原子轮换) /
 * revokeAllForAccount (全端登出); auth 编排层经 DI 调用 (R2 跨 ctx 写,
 * rotate 失败抛 → auth 回滚整请求)。
 *
 * T004 骨架: 方法签名占位 + 注册进 SecurityModule providers/exports。
 * 构造器 DI 与各方法体由实现 task 增量补入 (TS noUnusedLocals 不允许提前声明
 * 未使用的注入): T005 (persist, 补 PrismaService + hashRefreshToken) /
 * T008 (findActiveByHash) / T010 (rotate, 补 JwtTokenService) / T016 (revokeAllForAccount)。
 */
@Injectable()
export class RefreshTokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtTokenService,
  ) {}

  /**
   * 签发即持久化: hash token + create 1 条 active 行。
   * expiresAt = now + 30d; deviceId 缺失 → 回退 uuid v4; clientIp 经 scrubPrivateIp
   * (私网/回环/非法 → null); deviceType 经 normalizeDeviceType 归一; revokedAt 默认 null。
   */
  async persist(
    accountId: bigint,
    rawToken: string,
    meta: PersistRefreshTokenInput,
  ): Promise<void> {
    const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * DAY_MS);
    await this.prisma.refreshToken.create({
      data: {
        tokenHash: hashRefreshToken(rawToken),
        accountId,
        expiresAt,
        deviceId: meta.deviceId ?? randomUUID(),
        deviceName: meta.deviceName ?? null,
        deviceType: normalizeDeviceType(meta.deviceType),
        ipAddress: scrubPrivateIp(meta.clientIp),
        loginMethod: meta.loginMethod,
      },
    });
  }

  /**
   * 按 tokenHash 命中唯一索引查 + isActive(record, now) 过滤 → record | null。
   * miss (not-found / expired / revoked) 一律返回 null,由 auth 编排折叠成反枚举 401。
   */
  async findActiveByHash(tokenHash: string, now: Date): Promise<RefreshToken | null> {
    const record = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    return record && isActive(record, now) ? record : null;
  }

  /**
   * 原子轮换: revoke 旧 + 签新 access/refresh + insert 新行 (继承 device 血缘 + 更 IP)。
   * 调用方先经 findActiveByHash 拿到 active `record`。
   *
   * 单次使用 + 并发安全靠**条件 revoke 的 affected-count 乐观锁** (per FR-S08 类比):
   * `updateMany({ where:{ id, revokedAt:null } })` → count===0 表示已被并发轮换/撤销
   * → throw 401 (整 tx 回滚)。Serializable 双失败形态 (memory prisma_serializable_p2002_and_p2034):
   *   - **P2002**(新 hash 撞唯一索引,256-bit 近不可能,防御性)→ 折 401。
   *   - **P2034**(写冲突/序列化失败,整 tx abort)→ 外层 ≤3 次重试整 tx
   *     (镜像 commit-phone-login.usecase.ts);重试时已被 winner 撤旧 → count===0 → 401。
   * 10 并发同 token → 恰 1 成功 + 9×401;100 并发不同 token → 0 错误 (独立行无争用)。
   */
  async rotate(record: RefreshToken, clientIp: string | null): Promise<RotatedTokens> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.rotateOnce(record, clientIp);
      } catch (e) {
        if (isWriteConflict(e) && attempt < MAX_SERIALIZATION_RETRIES) {
          continue;
        }
        throw e;
      }
    }
  }

  private async rotateOnce(record: RefreshToken, clientIp: string | null): Promise<RotatedTokens> {
    const accountId = record.accountId;
    return this.prisma.$transaction(
      async (tx) => {
        // 条件 revoke 旧 (乐观锁): 仅当仍 active 才撤; count===0 → 已被并发轮换/撤销。
        const { count } = await tx.refreshToken.updateMany({
          where: { id: record.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        if (count === 0) {
          throw new UnauthorizedException('INVALID_CREDENTIALS');
        }

        const accessToken = this.jwt.signAccessToken({ accountId });
        const newRefreshToken = this.jwt.generateRefreshToken();
        const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * DAY_MS);
        try {
          // 继承 device 血缘 (deviceId/Name/Type + loginMethod), 更新本次 IP, 新 30d 有效期。
          await tx.refreshToken.create({
            data: {
              tokenHash: hashRefreshToken(newRefreshToken),
              accountId,
              expiresAt,
              deviceId: record.deviceId,
              deviceName: record.deviceName,
              deviceType: record.deviceType,
              loginMethod: record.loginMethod,
              ipAddress: scrubPrivateIp(clientIp),
            },
          });
        } catch (e) {
          if (isPrismaUniqueViolation(e)) {
            throw new UnauthorizedException('INVALID_CREDENTIALS');
          }
          throw e;
        }

        return { accountId, accessToken, refreshToken: newRefreshToken };
      },
      { isolationLevel: 'Serializable' },
    );
  }

  /** T016: updateMany 撤账号全部 active 行 (幂等, count 忽略)。 */
  revokeAllForAccount(_accountId: bigint, _now: Date): Promise<void> {
    throw new Error('not implemented (T016)');
  }
}

function isPrismaUniqueViolation(e: unknown): boolean {
  return (
    typeof e === 'object' && e !== null && 'code' in e && (e as { code?: unknown }).code === 'P2002'
  );
}

// Prisma P2034: Postgres Serializable 序列化失败 (40001),整 tx 已 abort,retryable。
function isWriteConflict(e: unknown): boolean {
  return (
    typeof e === 'object' && e !== null && 'code' in e && (e as { code?: unknown }).code === 'P2034'
  );
}
