import { Body, Controller, Get, HttpCode, Patch, Req, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { AccountIdThrottlerGuard } from './account-id-throttler.guard';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { GetAccountProfileUseCase } from './get-account-profile.usecase';
import { UpdateDisplayNameUseCase } from './update-display-name.usecase';
import { UpdateBioUseCase } from './update-bio.usecase';
import { JwtAuthGuard, type AuthenticatedUser } from './jwt-auth.guard';
import { AccountProfileResponse } from './account-profile.response';
import { ProblemDetailResponse } from '../security/problem-detail.response';
import { ALL_DELETION_BUCKETS, DEVICE_BUCKETS } from '../security/throttler-skip-buckets';
import { UpdateDisplayNameRequest } from './update-display-name.request';
import { UpdateBioRequest } from './update-bio.request';

/**
 * GET /api/v1/accounts/me
 *
 * Returns profile for the authenticated account (FR-001).
 * JwtAuthGuard enforces Bearer token validation + ACTIVE status check (FR-002, FR-009).
 * All auth failures → unified 401 for anti-enumeration (US4).
 */
@ApiTags('accounts')
@Controller('v1/accounts')
@UseGuards(JwtAuthGuard, AccountIdThrottlerGuard)
@ApiBearerAuth()
export class AccountProfileController {
  constructor(
    private readonly useCase: GetAccountProfileUseCase,
    private readonly updateDisplayNameUseCase: UpdateDisplayNameUseCase,
    private readonly updateBioUseCase: UpdateBioUseCase,
  ) {}

  @Get('me')
  @HttpCode(200)
  @SkipThrottle({
    default: true,
    'sms-phone-24h': true,
    'sms-ip-24h': true,
    'me-patch': true,
    'refresh-ip': true,
    'refresh-token': true,
    'logout-all-ip': true,
    'logout-all-account': true,
    ...ALL_DELETION_BUCKETS,
    ...DEVICE_BUCKETS,
  })
  @Throttle({ 'me-get': { limit: 60, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Get authenticated account profile',
    description:
      'Returns account profile for the bearer-authenticated user. Phone is E.164 raw string; displayName is null for new users (FR-007).',
  })
  @ApiResponse({
    status: 200,
    description: 'Profile retrieved successfully',
    type: AccountProfileResponse,
  })
  @ApiResponse({
    status: 401,
    description:
      'Missing / invalid / expired token, or account not ACTIVE (FR-002, FR-009) — reason not disclosed (anti-enumeration)',
    type: ProblemDetailResponse,
  })
  @ApiResponse({
    status: 429,
    description: 'Rate limit exceeded (FR-008: 60 requests per 60s per account)',
    type: ProblemDetailResponse,
  })
  async getProfile(@Req() req: { user: AuthenticatedUser }): Promise<AccountProfileResponse> {
    const result = await this.useCase.execute(req.user.accountId);
    return {
      accountId: result.accountId.toString(),
      phone: result.phone,
      displayName: result.displayName,
      bio: result.bio,
      status: result.status,
      createdAt: result.createdAt,
    };
  }

  @Patch('me')
  @HttpCode(200)
  @SkipThrottle({
    default: true,
    'sms-phone-24h': true,
    'sms-ip-24h': true,
    'me-get': true,
    'refresh-ip': true,
    'refresh-token': true,
    'logout-all-ip': true,
    'logout-all-account': true,
    ...ALL_DELETION_BUCKETS,
    ...DEVICE_BUCKETS,
  })
  @Throttle({ 'me-patch': { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Update authenticated account display name',
    description:
      'Sets a new display name for the bearer-authenticated user. Validates FR-005 rules (1-32 Unicode code points, no forbidden chars). Returns updated profile.',
  })
  @ApiResponse({
    status: 200,
    description: 'Display name updated successfully',
    type: AccountProfileResponse,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid display name (violates FR-005 rules)',
    type: ProblemDetailResponse,
  })
  @ApiResponse({
    status: 401,
    description:
      'Missing / invalid / expired token, or account not ACTIVE (FR-004, FR-009) — reason not disclosed (anti-enumeration)',
    type: ProblemDetailResponse,
  })
  @ApiResponse({
    status: 429,
    description: 'Rate limit exceeded (FR-008: 10 requests per 60s per account)',
    type: ProblemDetailResponse,
  })
  async updateDisplayName(
    @Req() req: { user: AuthenticatedUser },
    @Body() body: UpdateDisplayNameRequest,
  ): Promise<AccountProfileResponse> {
    const result = await this.updateDisplayNameUseCase.execute(
      req.user.accountId,
      body.displayName,
    );
    return {
      accountId: result.accountId.toString(),
      phone: result.phone,
      displayName: result.displayName,
      bio: result.bio,
      status: result.status,
      createdAt: result.createdAt,
    };
  }

  @Patch('me/bio')
  @HttpCode(200)
  @SkipThrottle({
    default: true,
    'sms-phone-24h': true,
    'sms-ip-24h': true,
    'me-get': true,
    'refresh-ip': true,
    'refresh-token': true,
    'logout-all-ip': true,
    'logout-all-account': true,
    ...ALL_DELETION_BUCKETS,
    ...DEVICE_BUCKETS,
  })
  @Throttle({ 'me-patch': { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Update authenticated account bio (个人简介)',
    description:
      'Sets the personal bio for the bearer-authenticated user. Validates 007 FR-S03 rules (≤120 Unicode code points after trim, no forbidden chars, empty clears). Returns updated profile.',
  })
  @ApiResponse({
    status: 200,
    description: 'Bio updated successfully (including clear via empty string)',
    type: AccountProfileResponse,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid bio (violates 007 FR-S03 rules)',
    type: ProblemDetailResponse,
  })
  @ApiResponse({
    status: 401,
    description:
      'Missing / invalid / expired token, or account not ACTIVE (FR-S04) — reason not disclosed (anti-enumeration)',
    type: ProblemDetailResponse,
  })
  @ApiResponse({
    status: 429,
    description: 'Rate limit exceeded (FR-S05: 10 requests per 60s per account)',
    type: ProblemDetailResponse,
  })
  async updateBio(
    @Req() req: { user: AuthenticatedUser },
    @Body() body: UpdateBioRequest,
  ): Promise<AccountProfileResponse> {
    const result = await this.updateBioUseCase.execute(req.user.accountId, body.bio);
    return {
      accountId: result.accountId.toString(),
      phone: result.phone,
      displayName: result.displayName,
      bio: result.bio,
      status: result.status,
      createdAt: result.createdAt,
    };
  }
}
