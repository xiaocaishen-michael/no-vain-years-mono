import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { ProblemDetailResponse } from '../security/problem-detail.response';
import {
  CANCEL_SUBMIT_BUCKETS,
  DEFAULT_BUCKET,
  DEL_CODE_BUCKETS,
  DEL_SUBMIT_BUCKETS,
  ME_BUCKETS,
  SMS_CODE_BUCKETS,
  TOKEN_BUCKETS,
} from '../security/throttler-skip-buckets';
import { CancelCodePhoneThrottlerGuard } from './cancel-code-phone-throttler.guard';
import { SendCancelDeletionCodeUseCase } from './send-cancel-deletion-code.usecase';
import { SendCancelCodeRequest } from './send-cancel-code.request';
import { InvalidPhoneFormatException } from './invalid-phone-format.exception';

// E.164 +86 CN mobile —— 镜像 account.rules CN_MOBILE_REGEX (未导出, 沿用既有 DTO 内联惯例)。
const CN_MOBILE_PHONE = /^\+861[3-9]\d{9}$/;

/**
 * 撤销注销端点 (auth 编排, **public 无 JwtGuard**; `/v1/auth/cancel-deletion/*`)。
 * 本控制器目前仅 EP3 发撤销码; EP4 提交撤销码 (T023) 后续同控制器追加。
 *
 * CancelCodePhoneThrottlerGuard: phone-hash tracker (FR-S08 不明文落限流器)。
 * cancel-code 1/60s (phone-hash) + cancel-code-ip 5/60s; @SkipThrottle 其余桶反污染。
 * 手机号 E.164 格式校验在控制器显式做 (非法 → 422), 因全局 pipe 把 @Matches 失败
 * 统一映射 400, 无法产出 FR-S08 要求的 422 `INVALID_PHONE_FORMAT`。
 */
@ApiTags('account-deletion')
@Controller('v1/auth/cancel-deletion')
@UseGuards(CancelCodePhoneThrottlerGuard)
export class CancelDeletionController {
  constructor(private readonly sendCancelDeletionCode: SendCancelDeletionCodeUseCase) {}

  @Post('sms-codes')
  @HttpCode(200)
  @SkipThrottle({
    ...DEFAULT_BUCKET,
    ...SMS_CODE_BUCKETS,
    ...ME_BUCKETS,
    ...TOKEN_BUCKETS,
    ...DEL_CODE_BUCKETS,
    ...DEL_SUBMIT_BUCKETS,
    ...CANCEL_SUBMIT_BUCKETS,
  })
  @Throttle({
    'cancel-code': { limit: 1, ttl: 60_000 },
    'cancel-code-ip': { limit: 5, ttl: 60_000 },
  })
  @ApiOperation({
    summary: 'Send cancel-deletion verification code (EP3, public)',
    description:
      'Public endpoint: accepts a phone number; only FROZEN-in-grace accounts receive a ' +
      'CANCEL_DELETION SMS code. The 4 ineligible classes (unregistered / ACTIVE / ANONYMIZED / ' +
      'grace-expired) silently return 200 with a dummy timing pad — no code written, no SMS — so ' +
      'eligible/ineligible are byte- and timing-indistinguishable (FR-S07 anti-enumeration).',
  })
  @ApiResponse({
    status: 200,
    description: 'Accepted — code sent iff eligible (response indistinguishable from ineligible)',
  })
  @ApiResponse({
    status: 422,
    description: 'Phone not E.164 +86 CN mobile — INVALID_PHONE_FORMAT',
    type: ProblemDetailResponse,
  })
  @ApiResponse({
    status: 429,
    description: 'Rate limit exceeded (FR-S18: per-phone-hash 1/60s, per-IP 5/60s)',
    type: ProblemDetailResponse,
  })
  @ApiResponse({
    status: 503,
    description: 'SMS dispatch failed on the eligible path (FR-S21)',
    type: ProblemDetailResponse,
  })
  async sendCancelCode(@Body() body: SendCancelCodeRequest): Promise<void> {
    const phone = body.phone.trim();
    if (!CN_MOBILE_PHONE.test(phone)) {
      throw new InvalidPhoneFormatException();
    }
    await this.sendCancelDeletionCode.execute(phone);
  }
}
