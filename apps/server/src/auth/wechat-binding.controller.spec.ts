import { describe, it, expect, vi } from 'vitest';
import { WechatBindingController } from './wechat-binding.controller';
import type { BindWechatUseCase } from './bind-wechat.usecase';
import { WechatAlreadyBoundException } from './wechat-already-bound.exception';

function build() {
  const bindExecute = vi.fn().mockResolvedValue(undefined);
  const controller = new WechatBindingController({
    execute: bindExecute,
  } as unknown as BindWechatUseCase);
  return { bindExecute, controller };
}

describe('WechatBindingController', () => {
  describe('EP1 bindWechatForMe', () => {
    it('调 usecase(req.user.accountId, body.authCode) + 返回 void (201)', async () => {
      const { controller, bindExecute } = build();
      const res = await controller.bindWechatForMe(
        { user: { accountId: 99n } },
        { authCode: 'wx_auth_code_xxx' },
      );
      expect(bindExecute).toHaveBeenCalledWith(99n, 'wx_auth_code_xxx');
      expect(res).toBeUndefined();
    });

    it('usecase 抛 409 (WechatAlreadyBound) → 控制器透传, 不吞', async () => {
      const { controller, bindExecute } = build();
      bindExecute.mockRejectedValue(new WechatAlreadyBoundException());
      await expect(
        controller.bindWechatForMe({ user: { accountId: 1n } }, { authCode: 'x' }),
      ).rejects.toBeInstanceOf(WechatAlreadyBoundException);
    });
  });
});
