import { describe, it, expect, vi } from 'vitest';
import { AccountTokenController } from './account-token.controller';
import type { RefreshTokenUseCase } from './refresh-token.usecase';

describe('AccountTokenController', () => {
  it('refresh: 调 usecase(refreshToken, clientIp) + 映射 accountId→string (复用 LoginResponse shape)', async () => {
    const execute = vi.fn().mockResolvedValue({
      accountId: 42n,
      accessToken: 'access-xyz',
      refreshToken: 'refresh-xyz',
    });
    const useCase = { execute } as unknown as RefreshTokenUseCase;
    const controller = new AccountTokenController(useCase);

    const res = await controller.refresh({ refreshToken: 'raw-tok' }, '8.8.8.8');

    expect(execute).toHaveBeenCalledWith('raw-tok', '8.8.8.8');
    expect(res).toEqual({
      accountId: '42',
      accessToken: 'access-xyz',
      refreshToken: 'refresh-xyz',
    });
  });
});
