import { beforeEach, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { createHarness, resetDatabase, seedAdmin, ORIGIN, TEST_USERNAME, TEST_PASSWORD } from './helpers';
import { createApiHandler } from '../../functions/_lib/router';

beforeEach(resetDatabase);

async function loggedIn() {
  await seedAdmin();
  const h = createHarness();
  await h.expectOk(await h.login());
  return h;
}

it('review: 并发失败登录也不能绕过每用户五次限流', async () => {
  await seedAdmin();
  const h = createHarness();
  const results = await Promise.all(Array.from({ length: 12 }, () => h.call('/api/login', {
    body: { username: TEST_USERNAME, password: 'wrong-password-for-test' },
  })));
  expect(results.filter(r => r.status === 401).length).toBeLessThanOrEqual(5);
  expect(results.filter(r => r.status === 429).length).toBeGreaterThanOrEqual(7);
});

it('review: 被动内容读取不延长会话，显式用户活动才续期', async () => {
  const h = await loggedIn();
  const expiry = () => env.DB.prepare('SELECT expires_at FROM sessions').first<number>('expires_at');
  const initial = await expiry();
  h.advance(2 * 60 * 60 * 1000);
  await h.getContent();
  expect(await expiry()).toBe(initial);
  await h.expectOk(await h.call('/api/session/activity', { method: 'POST', body: {} }));
  expect(await expiry()).toBe(h.now() + 7 * 24 * 60 * 60 * 1000);
});

it('review: 修改密码后全部现有会话失效并要求重新登录', async () => {
  const h = await loggedIn();
  await h.expectOk(await h.call('/api/password', {
    body: { currentPassword: TEST_PASSWORD, newPassword: 'Another-Str0ng-Pass!2026' },
  }));
  expect(await env.DB.prepare('SELECT COUNT(*) FROM sessions').first<number>('COUNT(*)')).toBe(0);
  expect((await h.call('/api/content')).status).toBe(401);
});

it('review: 无变化的排序请求仍必须拒绝陈旧版本', async () => {
  const h = await loggedIn();
  const g = await h.createGroup('A');
  const state = await h.getContent();
  await h.expectOk(await h.call(`/api/groups/${g.id}`, { method: 'PATCH', body: { revision: state.revision, name: 'B' } }));
  const r = await h.call('/api/order', { method: 'PUT', body: { revision: state.revision, groups: [g.id], links: { [g.id]: [] } } });
  expect(r.status).toBe(409);
});

it('review: 导入600个书签使用真实D1且单次请求SQL不超过50条', async () => {
  const h = await loggedIn();
  let statements = 0;
  const real = env.DB;
  const budgetDb = new Proxy(real, {
    get(target, key) {
      if (key === 'prepare') return (sql: string) => {
        statements += 1;
        if (statements > 50) throw new Error('Review query budget exceeded: 50');
        return target.prepare(sql);
      };
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const handle = createApiHandler({ now: () => h.now(), pbkdf2Iterations: 1000 });
  const r = await handle(new Request(ORIGIN + '/api/import', {
    method: 'POST',
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json', Cookie: h.cookie()!, 'X-CSRF-Token': h.csrf()! },
    body: JSON.stringify({ revision: 0, groups: [{ name: '批量导入', links: Array.from({ length: 600 }, (_, i) => ({ name: `站点${i}`, url: `https://example.com/${i}` })) }] }),
  }), { ...env, DB: budgetDb });
  expect(r.status).toBe(200);
  expect(statements).toBeLessThanOrEqual(50);
  expect((await h.getContent()).groups[0]!.links).toHaveLength(600);
});
