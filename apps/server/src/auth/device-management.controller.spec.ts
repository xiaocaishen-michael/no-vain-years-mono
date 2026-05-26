import { describe, it, expect, vi } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { DeviceManagementController } from './device-management.controller';
import { DeviceListQuery } from './device-list.query';
import type { ListDevicesUseCase } from './list-devices.usecase';
import type { DeviceListResponse } from './device-list.response';

describe('DeviceManagementController.list', () => {
  const envelope: DeviceListResponse = {
    page: 0,
    size: 10,
    totalElements: 0,
    totalPages: 0,
    items: [],
  };

  function make() {
    const execute = vi.fn().mockResolvedValue(envelope);
    const uc = { execute } as unknown as ListDevicesUseCase;
    return { controller: new DeviceManagementController(uc), execute };
  }

  it('委托 listDevices.execute(accountId, x-device-id, page, size) + 返回 envelope', async () => {
    const { controller, execute } = make();
    const res = await controller.list(
      { user: { accountId: 42n } },
      { page: 2, size: 5 } as DeviceListQuery,
      'cur-device',
    );
    expect(res).toBe(envelope);
    expect(execute).toHaveBeenCalledWith(42n, 'cur-device', 2, 5);
  });

  it('缺 x-device-id 头 → 传 null (isCurrent 由 usecase 全置 false)', async () => {
    const { controller, execute } = make();
    await controller.list(
      { user: { accountId: 7n } },
      { page: 0, size: 10 } as DeviceListQuery,
      undefined,
    );
    expect(execute).toHaveBeenCalledWith(7n, null, 0, 10);
  });
});

describe('DeviceListQuery 校验 (全局 ValidationPipe → 400 FORM_VALIDATION)', () => {
  it('缺省 → page=0 size=10, 无错', () => {
    const dto = plainToInstance(DeviceListQuery, {});
    expect(validateSync(dto)).toHaveLength(0);
    expect(dto.page).toBe(0);
    expect(dto.size).toBe(10);
  });

  it('合法字符串 → 转 number, 无错', () => {
    const dto = plainToInstance(DeviceListQuery, { page: '2', size: '5' });
    expect(validateSync(dto)).toHaveLength(0);
    expect(dto.page).toBe(2);
    expect(dto.size).toBe(5);
  });

  it('page 非 int → 校验失败 (→ 400)', () => {
    expect(validateSync(plainToInstance(DeviceListQuery, { page: 'abc' })).length).toBeGreaterThan(
      0,
    );
  });

  it('size < 1 → 校验失败 (size=0 无意义; 上限 100 不在此拒绝而截断)', () => {
    expect(validateSync(plainToInstance(DeviceListQuery, { size: '0' })).length).toBeGreaterThan(0);
    expect(validateSync(plainToInstance(DeviceListQuery, { page: '-1' })).length).toBeGreaterThan(
      0,
    );
  });
});
