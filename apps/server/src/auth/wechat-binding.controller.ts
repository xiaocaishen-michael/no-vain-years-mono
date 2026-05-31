import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { AccountIdThrottlerGuard } from '../account/account-id-throttler.guard';
import { JwtAuthGuard, type AuthenticatedUser } from '../account/jwt-auth.guard';
import { ProblemDetailResponse } from '../security/problem-detail.response';
import {
  ALL_DELETION_BUCKETS,
  DEFAULT_BUCKET,
  DEVICE_BUCKETS,
  ME_BUCKETS,
  SMS_CODE_BUCKETS,
  TOKEN_BUCKETS,
  WECHAT_UNBIND_BUCKETS,
  WECHAT_UNBIND_CODE_BUCKETS,
} from '../security/throttler-skip-buckets';
import { BindWechatUseCase } from './bind-wechat.usecase';
import { BindWechatRequest } from './bind-wechat.request';

/**
 * 微信绑定端点 (auth 编排, authed; `/v1/accounts/me/wechat-binding*`)。
 * EP1 绑定创建 (本文件)。EP2 解绑发码 + EP3 验码解绑 由 T016 续接同文件。
 * JwtAuthGuard 取 accountId, AccountIdThrottlerGuard 评估 module throttler
 * (wx-* 自带 getTracker)。每路由 @SkipThrottle 跳过非己 throttler (反共享桶污染)。
 */
@ApiTags('wechat-binding')
@Controller('v1/accounts')
@UseGuards(JwtAuthGuard, AccountIdThrottlerGuard)
@ApiBearerAuth()
export class WechatBindingController {
  constructor(private readonly bindWechat: BindWechatUseCase) {}

  @Post('me/wechat-binding')
  @HttpCode(201)
  @SkipThrottle({
    ...DEFAULT_BUCKET,
    ...SMS_CODE_BUCKETS,
    ...ME_BUCKETS,
    ...TOKEN_BUCKETS,
    ...DEVICE_BUCKETS,
    ...ALL_DELETION_BUCKETS,
    ...WECHAT_UNBIND_CODE_BUCKETS,
    ...WECHAT_UNBIND_BUCKETS,
  })
  @Throttle({
    'wx-bind': { limit: 5, ttl: 60_000 },
    'wx-bind-ip': { limit: 10, ttl: 60_000 },
  })
  @ApiOperation({
    summary: 'Bind WeChat to the authenticated account (EP1)',
    description:
      'Resolves the opaque authCode to an openid (Phase 1 stub) then links it to the ' +
      'bearer-authenticated account (FR-S02). Non-ACTIVE accounts fold to 401 (anti-enumeration). ' +
      'Idempotent re-bind of the same openid returns 201 (O7). Does NOT modify profile.',
  })
  @ApiResponse({ status: 201, description: 'WeChat bound (or idempotent re-bind); no body' })
  @ApiResponse({
    status: 401,
    description: 'Invalid token or account not ACTIVE — reason not disclosed (anti-enumeration)',
    type: ProblemDetailResponse,
  })
  @ApiResponse({
    status: 409,
    description:
      'WECHAT_ALREADY_BOUND_OTHER (openid bound to another account) or ' +
      'WECHAT_ACCOUNT_ALREADY_BOUND (this account already has a different WeChat, R2)',
    type: ProblemDetailResponse,
  })
  @ApiResponse({
    status: 429,
    description: 'Rate limit exceeded (FR-S06: per-account 5/60s, per-IP 10/60s)',
    type: ProblemDetailResponse,
  })
  async bindWechatForMe(
    @Req() req: { user: AuthenticatedUser },
    @Body() body: BindWechatRequest,
  ): Promise<void> {
    await this.bindWechat.execute(req.user.accountId, body.authCode);
  }
}
