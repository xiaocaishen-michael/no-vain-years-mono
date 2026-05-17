import { Account } from '../../domain/account.aggregate';
import { Phone } from '../../domain/phone.vo';

/**
 * AccountRepository port (Constitution IV: domain 层定义 interface, infrastructure 实现).
 *
 * 操作:
 * - findByPhone(phone): 查 phone unique 索引, 返 Account | null
 * - save(account): insert (新建; ACTIVE 自动注册路径); unique 冲突 throws
 * - updateLastLoginAt(id, at): 更新 last_login_at 单字段 (避免 race)
 */
export const ACCOUNT_REPOSITORY = Symbol('ACCOUNT_REPOSITORY');

export interface AccountRepository {
  findByPhone(phone: Phone): Promise<Account | null>;
  save(account: Account): Promise<void>;
  updateLastLoginAt(id: bigint, at: Date): Promise<void>;
}
