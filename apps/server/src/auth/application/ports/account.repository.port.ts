import { Account } from '../../domain/account.aggregate';
import { DisplayName } from '../../domain/display-name.vo';
import { Phone } from '../../domain/phone.vo';

/**
 * AccountRepository port (Constitution IV: domain 层定义 interface, infrastructure 实现).
 *
 * 操作:
 * - findById(id): 查 PK, 返 Account | null (GET/PATCH /me 路径, JWT accountId)
 * - findByPhone(phone): 查 phone unique 索引, 返 Account | null
 * - save(account): insert (新建; ACTIVE 自动注册路径); unique 冲突 throws
 * - updateLastLoginAt(id, at): 更新 last_login_at 单字段 (避免 race)
 * - updateDisplayName(id, displayName): 更新 display_name 单字段 (US2 PATCH /me)
 */
export const ACCOUNT_REPOSITORY = Symbol('ACCOUNT_REPOSITORY');

export interface AccountRepository {
  findById(id: bigint): Promise<Account | null>;
  findByPhone(phone: Phone): Promise<Account | null>;
  save(account: Account): Promise<void>;
  updateLastLoginAt(id: bigint, at: Date): Promise<void>;
  updateDisplayName(id: bigint, displayName: DisplayName | null): Promise<void>;
}
