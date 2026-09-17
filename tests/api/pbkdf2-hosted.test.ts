import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHarness, resetDatabase, TEST_PASSWORD } from './helpers';
import type { StatusResponse } from '../../src/shared/types';

/**
 * 托管版 Cloudflare Workers 的 WebCrypto 对 PBKDF2 迭代次数有 100000 的硬上限
 * （https://github.com/cloudflare/workerd/issues/1346），超限时 deriveBits 会抛出
 * `Pbkdf2 failed: iteration counts above 100000 are not supported`。
 * 本地 workerd / Miniflare 不强制执行该上限，因此这里用 spy 模拟托管约束：
 * 超限派生一律按生产失败处理，允许的派生仍交给真实 WebCrypto 完成。
 */
const HOSTED_PBKDF2_CAP = 100_000;
const HOSTED_CAP_ERROR = 'Pbkdf2 failed: iteration counts above 100000 are not supported';

describe('生产默认 PBKDF2 迭代次数不超过托管上限', () => {
  let capSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    await resetDatabase();
    const original = crypto.subtle.deriveBits.bind(crypto.subtle);
    capSpy = vi.spyOn(crypto.subtle, 'deriveBits').mockImplementation(async (algorithm, key, length) => {
      if (
        typeof algorithm === 'object' &&
        algorithm !== null &&
        'iterations' in algorithm &&
        typeof algorithm.iterations === 'number' &&
        algorithm.iterations > HOSTED_PBKDF2_CAP
      ) {
        throw new Error(HOSTED_CAP_ERROR);
      }
      return original(algorithm, key, length);
    });
  });

  afterEach(() => {
    capSpy.mockRestore();
  });

  it('初始化、登录、未知用户与改密都使用生产默认值且不会触发托管上限', async () => {
    const harness = createHarness({ pbkdf2Iterations: undefined });

    const setup = await harness.setup();
    expect(setup.status).toBe(201);
    await harness.expectOk<StatusResponse>(setup);

    // 持久化的哈希自描述为生产默认迭代次数
    const row = await env.DB.prepare('SELECT password_hash FROM admin_users WHERE id = 1').first<{ password_hash: string }>();
    expect(row?.password_hash?.startsWith(`pbkdf2-sha256$${HOSTED_PBKDF2_CAP}$`)).toBe(true);

    // 登出后重新登录
    expect((await harness.call('/api/logout', { body: {} })).status).toBe(200);
    const login = await harness.login();
    expect(login.status).toBe(200);
    await harness.expectOk<StatusResponse>(login);

    // 错误密码与不存在的用户都会走同等开销的 dummy 派生，仍必须保持在上限内
    const probe = createHarness({ pbkdf2Iterations: undefined });
    expect((await probe.login({ password: 'Wrong-Pass!123' })).status).toBe(401);
    expect((await probe.login({ username: 'nobody', password: 'Wrong-Pass!123' })).status).toBe(401);

    // 改密撤销当前会话；旧密码失效，新密码可以登录
    const newPassword = 'N3w-Pass!2026-ok';
    const changed = await harness.call('/api/password', {
      body: { currentPassword: TEST_PASSWORD, newPassword },
    });
    expect(changed.status).toBe(200);
    expect((await harness.call('/api/content')).status).toBe(401);

    const fresh = createHarness({ pbkdf2Iterations: undefined });
    expect((await fresh.login()).status).toBe(401);
    expect((await fresh.login({ password: newPassword })).status).toBe(200);
  });
});
