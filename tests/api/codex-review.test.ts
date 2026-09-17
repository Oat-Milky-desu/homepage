import { beforeEach, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { createHarness, resetDatabase, seedAdmin, ORIGIN, TEST_USERNAME, TEST_PASSWORD } from './helpers';
import { createApiHandler } from '../../functions/_lib/router';
import type { BackupFile } from '../../src/shared/types';

beforeEach(resetDatabase);

async function authenticated() {
  await seedAdmin();
  const h = createHarness();
  await h.expectOk(await h.login());
  return h;
}

it('review: 跨分组排序一次原子移动并保留全部链接', async () => {
  const h = await authenticated();
  const a = await h.createGroup('A');
  const b = await h.createGroup('B');
  const l = await h.createLink(a.id);
  const before = await h.getContent();
  const r = await h.call('/api/order', { method: 'PUT', body: {
    revision: before.revision, groups: [a.id, b.id], links: { [a.id]: [], [b.id]: [l.id] },
  } });
  expect(r.status).toBe(200);
  const after = await h.getContent();
  expect(after.groups[0]!.links).toHaveLength(0);
  expect(after.groups[1]!.links.map(x => x.id)).toEqual([l.id]);
});

it('review: 协议不同即不同源，禁止登录请求', async () => {
  await seedAdmin();
  const h = createHarness();
  const r = await h.call('/api/login', { body: { username: TEST_USERNAME, password: TEST_PASSWORD }, origin: ORIGIN.replace('https:', 'http:') });
  expect(r.status).toBe(403);
});

it('review: 恢复时拒绝非法图标且不改变数据', async () => {
  const h = await authenticated();
  const g = await h.createGroup('A');
  await h.createLink(g.id);
  const before = await h.getContent();
  const backup = await h.json<BackupFile>(await h.call('/api/backup'));
  backup.links[0]!.iconType = 'image';
  backup.links[0]!.iconValue = 'javascript:alert(1)';
  const r = await h.call('/api/restore', { body: { revision: before.revision, backup } });
  expect(r.status).toBe(400);
  expect(await h.getContent()).toEqual(before);
});

it('review: 生产默认哈希参数可在真实 workerd 完成初始化登录', async () => {
  const handle = createApiHandler();
  const request = (path: string, data: unknown) => new Request(ORIGIN + path, {
    method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
  const setup = await handle(request('/api/setup', { initSecret: 'test-init-secret', username: TEST_USERNAME, password: TEST_PASSWORD }), env);
  expect(setup.status).toBe(201);
  const login = await handle(request('/api/login', { username: TEST_USERNAME, password: TEST_PASSWORD }), env);
  expect(login.status).toBe(200);
  expect(login.headers.get('set-cookie')).toContain('Secure');
});
