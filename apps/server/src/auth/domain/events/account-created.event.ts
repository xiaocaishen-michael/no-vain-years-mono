/**
 * AccountCreatedEvent (FR-S11) — 自动注册路径 publish.
 *
 * Payload schema: `{ accountId, phone, createdAt }`.
 * 通过 OutboxPublisher 写入 `event_publication` 表; 真消费方由后续 use case 加.
 */
export const ACCOUNT_CREATED_EVENT_TYPE = 'auth.account.created';

export interface AccountCreatedEventPayload {
  accountId: string; // bigint stringified
  phone: string;
  createdAt: string; // ISO 8601
}

export class AccountCreatedEvent {
  static readonly type = ACCOUNT_CREATED_EVENT_TYPE;
  constructor(public readonly payload: AccountCreatedEventPayload) {}

  static create(accountId: bigint, phone: string, createdAt: Date): AccountCreatedEvent {
    return new AccountCreatedEvent({
      accountId: accountId.toString(),
      phone,
      createdAt: createdAt.toISOString(),
    });
  }
}
