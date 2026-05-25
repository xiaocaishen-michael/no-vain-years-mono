import { Body, Controller, HttpCode, Ip, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle, ThrottlerGuard } from '@nestjs/throttler';
import { RefreshTokenUseCase } from './refresh-token.usecase';
import { RefreshTokenRequest } from './refresh-token.request';
import { PhoneSmsAuthResponse } from './phone-sms-auth.response';
import { ProblemDetailResponse } from '../security/problem-detail.response';

/**
 * POST /api/v1/accounts/refresh-token (EP1)
 *
 * 持 refresh token 原子轮换 → 新 access + refresh。响应复用 PhoneSmsAuthResponse
 * (= 001 LoginResponse shape, 避免反枚举字段漂移)。无 bearer (凭 body token)。
 *
 * 限流 (FR-S14, per-throttler getTracker in auth.module): refresh-ip 100/60s +
 * refresh-token (per-token-hash refresh:<hash>) 5/60s。@SkipThrottle 显式跳过其余
 * 共享 throttler (default / sms-* / me-*) —— 沿用 /me 范式,避免跨路由桶污染。
 */
@ApiTags('accounts')
@Controller('v1/accounts')
@UseGuards(ThrottlerGuard)
export class AccountTokenController {
  constructor(private readonly refreshTokenUseCase: RefreshTokenUseCase) {}

  @Post('refresh-token')
  @HttpCode(200)
  @SkipThrottle({
    default: true,
    'sms-phone-24h': true,
    'sms-ip-24h': true,
    'me-get': true,
    'me-patch': true,
  })
  @ApiOperation({
    summary: 'Rotate a refresh token',
    description:
      'Atomically revokes the presented refresh token and issues a fresh access + refresh pair (single-use). Anti-enumeration: all failures fold to 401.',
  })
  @ApiResponse({
    status: 200,
    description: 'Rotated — new tokens issued',
    type: PhoneSmsAuthResponse,
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failure (empty / missing refreshToken)',
    type: ProblemDetailResponse,
  })
  @ApiResponse({
    status: 401,
    description: 'Anti-enumeration failure (invalid / expired / revoked / account not eligible)',
    type: ProblemDetailResponse,
  })
  @ApiResponse({
    status: 429,
    description: 'Rate limit exceeded (FR-S14: per-IP 100/60s, per-token 5/60s)',
    type: ProblemDetailResponse,
  })
  async refresh(
    @Body() body: RefreshTokenRequest,
    @Ip() clientIp: string,
  ): Promise<PhoneSmsAuthResponse> {
    const result = await this.refreshTokenUseCase.execute(body.refreshToken, clientIp);
    return {
      accountId: result.accountId.toString(),
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    };
  }
}
