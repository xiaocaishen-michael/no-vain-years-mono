import { Controller, Get, Headers, HttpCode, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle, ThrottlerGuard } from '@nestjs/throttler';
import { JwtAccessGuard, type AuthenticatedUser } from './jwt-access.guard';
import { ListDevicesUseCase } from './list-devices.usecase';
import { DeviceListQuery } from './device-list.query';
import { DeviceListResponse } from './device-list.response';
import { ProblemDetailResponse } from '../security/problem-detail.response';
import {
  ALL_DELETION_BUCKETS,
  DEFAULT_BUCKET,
  DEVICE_REVOKE_BUCKETS,
  ME_BUCKETS,
  SMS_CODE_BUCKETS,
  TOKEN_BUCKETS,
} from '../security/throttler-skip-buckets';

/**
 * 设备 / 登录管理端点 (auth 编排层, ADR-0032):
 *   - GET /v1/auth/devices (EP1): bearer (JwtAccessGuard) → 分页活跃设备列表 (US1)。
 *   - DELETE :recordId (EP2, T010): 单设备远程撤销 (US2)。
 *
 * 鉴权用 auth 自有 **JwtAccessGuard** (无账号状态门控,与 logout-all 同款) —— 设备管理
 * 是 session 安全操作,FROZEN 账号亦应能撤可疑设备 (不复用 account JwtAuthGuard 的
 * isActive 门控)。限流 (FR-S13): named throttler dev-list-* / dev-revoke-* 在 auth.module
 * 定义 (per-throttler getTracker, logout-all 同款),JwtAccessGuard 先填 req.user 供
 * account tracker;每路由 @SkipThrottle 非己桶反共享桶污染 (per throttler-skip-buckets)。
 */
@ApiTags('devices')
@Controller('v1/auth/devices')
export class DeviceManagementController {
  constructor(private readonly listDevices: ListDevicesUseCase) {}

  @Get()
  @HttpCode(200)
  // JwtAccessGuard 先行填 req.user.accountId → ThrottlerGuard 读 dev-list-account tracker。
  @UseGuards(JwtAccessGuard, ThrottlerGuard)
  @SkipThrottle({
    ...DEFAULT_BUCKET,
    ...SMS_CODE_BUCKETS,
    ...ME_BUCKETS,
    ...TOKEN_BUCKETS,
    ...ALL_DELETION_BUCKETS,
    ...DEVICE_REVOKE_BUCKETS, // GET 不属撤销桶
  })
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List active login devices',
    description:
      'Returns the bearer-authenticated account active refresh tokens (one per device), ' +
      'createdAt DESC, paginated. Location is resolved Chinese province+city (raw IP never ' +
      'exposed, FR-S04); isCurrent compares the request x-device-id header to each row deviceId.',
  })
  @ApiResponse({ status: 200, description: 'Paginated device list', type: DeviceListResponse })
  @ApiResponse({
    status: 401,
    description: 'Missing / invalid / expired access token',
    type: ProblemDetailResponse,
  })
  @ApiResponse({
    status: 429,
    description: 'Rate limit exceeded (FR-S13: per-account 30/60s, per-IP 100/60s)',
    type: ProblemDetailResponse,
  })
  async list(
    @Req() req: { user: AuthenticatedUser },
    @Query() query: DeviceListQuery,
    @Headers('x-device-id') deviceId?: string,
  ): Promise<DeviceListResponse> {
    return this.listDevices.execute(req.user.accountId, deviceId ?? null, query.page, query.size);
  }
}
