import { describe, it, expect, vi } from 'vitest';
import { AccountDeletionController } from './account-deletion.controller';
import type { SendDeletionCodeUseCase } from './send-deletion-code.usecase';

function build() {
  const execute = vi.fn().mockResolvedValue(undefined);
  const controller = new AccountDeletionController({
    execute,
  } as unknown as SendDeletionCodeUseCase);
  return { execute, controller };
}

describe('AccountDeletionController', () => {
  it('sendDeletionCodeForMe: 调 usecase(req.user.accountId) + 返回 void (204)', async () => {
    const { controller, execute } = build();
    const res = await controller.sendDeletionCodeForMe({ user: { accountId: 99n } });
    expect(execute).toHaveBeenCalledWith(99n);
    expect(res).toBeUndefined();
  });

  it('usecase 抛 (反枚举 401 / 503) → 控制器透传, 不吞', async () => {
    const { controller, execute } = build();
    execute.mockRejectedValue(new Error('mapped-by-usecase'));
    await expect(controller.sendDeletionCodeForMe({ user: { accountId: 1n } })).rejects.toThrow(
      'mapped-by-usecase',
    );
  });
});
