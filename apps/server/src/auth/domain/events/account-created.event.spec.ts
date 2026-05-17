import { describe, it, expect } from 'vitest';
import { AccountCreatedEvent, ACCOUNT_CREATED_EVENT_TYPE } from './account-created.event';

describe('AccountCreatedEvent', () => {
  it('type constant matches namespaced format', () => {
    expect(ACCOUNT_CREATED_EVENT_TYPE).toBe('auth.account.created');
    expect(AccountCreatedEvent.type).toBe(ACCOUNT_CREATED_EVENT_TYPE);
  });

  it('create() converts BigInt to string + Date to ISO 8601', () => {
    const createdAt = new Date('2026-05-17T10:00:00Z');
    const event = AccountCreatedEvent.create(9007199254740993n, '+8613800138000', createdAt);
    expect(event.payload).toEqual({
      accountId: '9007199254740993',
      phone: '+8613800138000',
      createdAt: '2026-05-17T10:00:00.000Z',
    });
  });
});
