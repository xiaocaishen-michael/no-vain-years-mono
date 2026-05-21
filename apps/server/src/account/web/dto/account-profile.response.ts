import { ApiProperty } from '@nestjs/swagger';
import { AccountStatus } from '../../domain/account.aggregate';

/**
 * GET /api/v1/accounts/me response body (FR-001).
 *
 * accountId serialized as string (JSON-safe vs BigInt; matches JWT sub claim).
 * phone is E.164 raw string (+8613800138000); masking is client-side.
 * displayName is null for new users who have not set one (FR-007).
 */
export class AccountProfileResponse {
  @ApiProperty({
    description:
      'Account ID (serialized as string for JSON-safety vs BigInt; matches JWT sub claim)',
    example: '1234567890',
  })
  accountId!: string;

  @ApiProperty({
    description: 'E.164 phone number; mask handled by client (per apps/mobile/lib/format/phone.ts)',
    example: '+8613800138000',
  })
  phone!: string;

  @ApiProperty({
    description: 'Display name; null for new users before first update (FR-007)',
    example: 'Alice',
    nullable: true,
    type: 'string',
  })
  displayName!: string | null;

  @ApiProperty({
    description: 'Account status',
    enum: AccountStatus,
    example: AccountStatus.ACTIVE,
  })
  status!: AccountStatus;

  @ApiProperty({
    description: 'Account creation timestamp (ISO 8601)',
    example: '2026-01-01T00:00:00.000Z',
    type: 'string',
    format: 'date-time',
  })
  createdAt!: Date;
}
