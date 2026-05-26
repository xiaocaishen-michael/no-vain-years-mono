import { Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { AccountIdThrottlerGuard } from '../account/account-id-throttler.guard';
import { JwtAuthGuard, type AuthenticatedUser } from '../account/jwt-auth.guard';
import { ProblemDetailResponse } from '../security/problem-detail.response';
import {
  CANCEL_CODE_BUCKETS,
  CANCEL_SUBMIT_BUCKETS,
  DEFAULT_BUCKET,
  DEL_SUBMIT_BUCKETS,
  ME_BUCKETS,
  SMS_CODE_BUCKETS,
  TOKEN_BUCKETS,
} from '../security/throttler-skip-buckets';
import { SendDeletionCodeUseCase } from './send-deletion-code.usecase';

/**
 * 注销删除端点 (auth 编排, authed; `/v1/accounts/me/*`)。EP1 发注销码 (本 task);
 * EP2 提交注销码冻结 (T014) 后续挂入本 controller。JwtAuthGuard 取 accountId,
 * AccountIdThrottlerGuard 评估 module throttler (del-code-* 自带 getTracker)。
 * 每路由 @SkipThrottle 跳过非己 throttler (反共享桶污染, per throttler-skip-buckets)。
 */
@ApiTags('account-deletion')
@Controller('v1/accounts')
@UseGuards(JwtAuthGuard, AccountIdThrottlerGuard)
@ApiBearerAuth()
export class AccountDeletionController {
  constructor(private readonly sendDeletionCode: SendDeletionCodeUseCase) {}

  @Post('me/deletion-codes')
  @HttpCode(204)
  @SkipThrottle({
    ...DEFAULT_BUCKET,
    ...SMS_CODE_BUCKETS,
    ...ME_BUCKETS,
    ...TOKEN_BUCKETS,
    ...DEL_SUBMIT_BUCKETS,
    ...CANCEL_CODE_BUCKETS,
    ...CANCEL_SUBMIT_BUCKETS,
  })
  @Throttle({
    'del-code-account': { limit: 1, ttl: 60_000 },
    'del-code-ip': { limit: 5, ttl: 60_000 },
  })
  @ApiOperation({
    summary: 'Send account-deletion verification code (EP1)',
    description:
      'Issues a DELETE_ACCOUNT SMS code for the bearer-authenticated account (FR-S01/S02). ' +
      'Non-ACTIVE accounts fold to 401 (anti-enumeration). 204 on dispatch.',
  })
  @ApiResponse({ status: 204, description: 'Code dispatched (no body)' })
  @ApiResponse({
    status: 401,
    description: 'Invalid token or account not ACTIVE — reason not disclosed (anti-enumeration)',
    type: ProblemDetailResponse,
  })
  @ApiResponse({
    status: 429,
    description: 'Rate limit exceeded (FR-S18: per-account 1/60s, per-IP 5/60s)',
    type: ProblemDetailResponse,
  })
  @ApiResponse({
    status: 503,
    description: 'SMS dispatch failed (FR-S21)',
    type: ProblemDetailResponse,
  })
  async sendDeletionCodeForMe(@Req() req: { user: AuthenticatedUser }): Promise<void> {
    await this.sendDeletionCode.execute(req.user.accountId);
  }
}
