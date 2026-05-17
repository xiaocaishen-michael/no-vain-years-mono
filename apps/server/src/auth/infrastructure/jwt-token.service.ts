import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

/**
 * JwtTokenService — 封装 @nestjs/jwt 提供 (FR-S09):
 * - signAccessToken(payload): JWT, TTL 15min (configured at JwtModule level)
 * - generateRefreshToken(): 256-bit base64url random (本 use case 不持久化)
 *
 * Refresh token 持久化 (`RefreshTokenRecord`) 在后续 use case 引入,
 * 本 use case 仅签发 + 返回.
 */
export interface AccessTokenPayload {
  accountId: bigint;
}

@Injectable()
export class JwtTokenService {
  constructor(private readonly jwtService: JwtService) {}

  /**
   * 签发 access token. JWT `sub` claim 用 string 形式承载 accountId (BigInt 安全).
   */
  signAccessToken(payload: AccessTokenPayload): string {
    return this.jwtService.sign({ sub: payload.accountId.toString() });
  }

  /**
   * 生成 refresh token: 256-bit CSPRNG, base64url 编码 (43 字符无 padding).
   */
  generateRefreshToken(): string {
    return randomBytes(32).toString('base64url');
  }
}
