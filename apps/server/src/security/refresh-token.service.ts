import { Injectable } from '@nestjs/common';
import type { RefreshToken } from '../generated/prisma/client';

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
  /** T005: hash token + create active 行 (expiresAt=now+30d / scrubPrivateIp / normalizeDeviceType / deviceId 缺失回退 uuid)。 */
  persist(_accountId: bigint, _rawToken: string, _meta: PersistRefreshTokenInput): Promise<void> {
    throw new Error('not implemented (T005)');
  }

  /** T008: 按 tokenHash 查 + isActive(record, now) 过滤 → record | null。 */
  findActiveByHash(_tokenHash: string, _now: Date): Promise<RefreshToken | null> {
    throw new Error('not implemented (T008)');
  }

  /** T010: Serializable tx 原子轮换 (条件 revoke 旧 + 签新 access/refresh + insert 新,继承 device 血缘 + 更 IP); 失败折 401 + 外层 P2034 retry。 */
  rotate(_record: RefreshToken, _clientIp: string | null): Promise<RotatedTokens> {
    throw new Error('not implemented (T010)');
  }

  /** T016: updateMany 撤账号全部 active 行 (幂等, count 忽略)。 */
  revokeAllForAccount(_accountId: bigint, _now: Date): Promise<void> {
    throw new Error('not implemented (T016)');
  }
}
