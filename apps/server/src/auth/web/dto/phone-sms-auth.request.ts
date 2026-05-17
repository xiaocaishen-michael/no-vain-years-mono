import { IsString, Matches } from 'class-validator';

/**
 * POST /api/v1/accounts/phone-sms-auth request body (FR-S02, FR-S04).
 */
export class PhoneSmsAuthRequest {
  @IsString()
  @Matches(/^\+861[3-9]\d{9}$/, {
    message: 'phone must be E.164 +86 CN mobile (1[3-9]xxxxxxxxx)',
  })
  phone!: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must be 6 digits' })
  code!: string;
}
