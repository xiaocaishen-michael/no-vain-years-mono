import { Controller, Get, HttpCode, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { GetAccountProfileUseCase } from '../application/get-account-profile.usecase';
import { JwtAuthGuard, type AuthenticatedUser } from './jwt-auth.guard';
import { AccountProfileResponse } from './dto/account-profile.response';
import { ProblemDetailResponse } from './dto/problem-detail.response';

/**
 * GET /api/v1/accounts/me
 *
 * Returns profile for the authenticated account (FR-001).
 * JwtAuthGuard enforces Bearer token validation + ACTIVE status check (FR-002, FR-009).
 * All auth failures → unified 401 for anti-enumeration (US4).
 */
@ApiTags('accounts')
@Controller('v1/accounts')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AccountProfileController {
  constructor(private readonly useCase: GetAccountProfileUseCase) {}

  @Get('me')
  @HttpCode(200)
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
  async getProfile(
    @Req() req: { user: AuthenticatedUser },
  ): Promise<AccountProfileResponse> {
    const result = await this.useCase.execute(req.user.accountId);
    return {
      accountId: result.accountId.toString(),
      phone: result.phone,
      displayName: result.displayName,
      status: result.status,
      createdAt: result.createdAt,
    };
  }
}
