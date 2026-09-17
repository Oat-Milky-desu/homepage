import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { createHarness, resetDatabase } from './helpers';
import type { StatusResponse } from '../../src/shared/types';

describe('并发与原子性', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('并发初始化只有一个请求成功', async () => {
    const first = createHarness();
    const second = createHarness();
    const [a, b] = await Promise.all([
      first.setup({ username: 'first', password: 'F1rst-Pass!2026' }),
      second.setup({ username: 'second', password: 'Sec0nd-Pass!2026' }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);

    const admins = await env.DB.prepare('SELECT COUNT(*) AS count FROM admin_users').first<{ count: number }>();
    expect(admins?.count).toBe(1);

    const winner = a.status === 201 ? first : second;
    const status = await winner.expectOk<StatusResponse>(await winner.call('/api/status'));
    expect(status.authenticated).toBe(true);
    expect(['first', 'second']).toContain(status.user?.username);
  });

  it('并发修改同一版本号时不会产生部分写入', async () => {
    const setup = createHarness();
    await setup.expectOk(await setup.setup());
    const content = await setup.getContent();

    const [groupResult, settingsResult] = await Promise.all([
      setup.call('/api/groups', { body: { revision: content.revision, name: '并发分组' } }),
      setup.call('/api/settings', {
        method: 'PUT',
        body: { revision: content.revision, settings: { ...content.settings, siteTitle: '并发标题' } },
      }),
    ]);
    const statuses = [groupResult.status, settingsResult.status].sort();
    // 恰好一个成功、一个因版本冲突被拒绝
    expect([200, 201]).toContain(statuses[0]);
    expect(statuses[1]).toBe(409);

    const after = await setup.getContent();
    expect(after.revision).toBe(content.revision + 1);
    const groupApplied = after.groups.some((group) => group.name === '并发分组');
    const settingsApplied = after.settings.siteTitle === '并发标题';
    // 恰好只有一个请求生效（另一个因版本冲突被拒绝）
    expect(Number(groupApplied) + Number(settingsApplied)).toBe(1);
  });

  it('守卫语句始终是空表，失败的事务会完整回滚', async () => {
    const setup = createHarness();
    await setup.expectOk(await setup.setup());
    const content = await setup.getContent();
    const rejected = await setup.call('/api/groups', { body: { revision: content.revision + 5, name: '不会写入' } });
    expect(rejected.status).toBe(409);

    const guards = await env.DB.prepare('SELECT COUNT(*) AS count FROM revision_guard').first<{ count: number }>();
    const existence = await env.DB.prepare('SELECT COUNT(*) AS count FROM existence_guard').first<{ count: number }>();
    const groups = await env.DB.prepare('SELECT COUNT(*) AS count FROM groups').first<{ count: number }>();
    expect(guards?.count).toBe(0);
    expect(existence?.count).toBe(0);
    expect(groups?.count).toBe(0);
  });
});
