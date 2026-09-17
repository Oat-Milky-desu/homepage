import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { createHarness, resetDatabase, seedAdmin, TEST_PASSWORD, TEST_USERNAME } from './helpers';
import type { StatusResponse } from '../../src/shared/types';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

describe('认证、会话与安全', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('未初始化时状态仅暴露 setupRequired', async () => {
    const harness = createHarness();
    const response = await harness.call('/api/status');
    expect(response.status).toBe(200);
    const body = await harness.json<StatusResponse>(response);
    expect(body).toEqual({ setupRequired: true, authenticated: false });
    expect(JSON.stringify(body)).not.toContain('csrfToken');
  });

  it('初始化只能成功一次，且返回可用的会话', async () => {
    const harness = createHarness();
    const response = await harness.setup();
    expect(response.status).toBe(201);
    const body = await harness.expectOk<StatusResponse>(response);
    expect(body.authenticated).toBe(true);
    expect(body.setupRequired).toBe(false);
    expect(body.user?.username).toBe(TEST_USERNAME);
    expect(typeof body.csrfToken).toBe('string');
    expect(harness.cookie()).toContain('xingyu_session=');

    const again = await harness.call('/api/setup', {
      body: { initSecret: 'test-init-secret', username: 'other', password: 'An0ther-Pass!99' },
    });
    expect(again.status).toBe(409);
    expect((await harness.errorBody(again)).error.code).toBe('already_setup');

    const status = await harness.json<StatusResponse>(await harness.call('/api/status'));
    expect(status.setupRequired).toBe(false);
  });

  it('初始化密钥错误会被拒绝并计数限流', async () => {
    const harness = createHarness();
    const first = await harness.setup({ initSecret: 'wrong-secret' });
    expect(first.status).toBe(403);
    expect((await harness.errorBody(first)).error.code).toBe('forbidden');

    let limited = false;
    for (let i = 0; i < 12; i += 1) {
      const response = await harness.setup({ initSecret: 'wrong-secret' });
      if (response.status === 429) {
        limited = true;
        expect(response.headers.get('retry-after')).toBeTruthy();
        break;
      }
      expect(response.status).toBe(403);
    }
    expect(limited).toBe(true);
  });

  it('弱密码与非法用户名被拒绝', async () => {
    const harness = createHarness();
    const weak = await harness.setup({ password: 'short' });
    expect(weak.status).toBe(400);
    const weakBody = await harness.errorBody(weak);
    expect(weakBody.error.code).toBe('validation_error');
    expect(weakBody.error.issues?.some((issue) => issue.path === 'password')).toBe(true);

    const badUser = await harness.setup({ username: 'a b', password: 'Str0ng-Pass!2026' });
    expect(badUser.status).toBe(400);
    expect((await harness.errorBody(badUser)).error.issues?.some((issue) => issue.path === 'username')).toBe(true);
  });

  it('登录成功返回安全 Cookie，失败返回 401 并触发限流', async () => {
    await seedAdmin();
    const harness = createHarness();
    const ok = await harness.login();
    expect(ok.status).toBe(200);
    const setCookie = ok.headers.getSetCookie().join(' ');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Secure');
    expect(/Max-Age=(\d+)/.exec(setCookie)?.[1]).toBe(String(SESSION_TTL_MS / 1000));
    await harness.expectOk<StatusResponse>(ok);

    const other = createHarness();
    const bad = await other.login({ password: 'Wrong-Pass!123' });
    expect(bad.status).toBe(401);
    expect((await other.errorBody(bad)).error.code).toBe('invalid_credentials');

    let limited = false;
    for (let i = 0; i < 8; i += 1) {
      const response = await other.login({ password: 'Wrong-Pass!456' });
      if (response.status === 429) {
        limited = true;
        break;
      }
    }
    expect(limited).toBe(true);
  });

  it('未认证无法访问任何内容接口', async () => {
    await resetDatabase();
    await seedAdmin();
    const harness = createHarness();
    for (const path of ['/api/content', '/api/backup']) {
      const response = await harness.call(path);
      expect(response.status).toBe(401);
      expect(response.headers.get('cache-control')).toContain('no-store');
    }
    const settings = await harness.call('/api/settings', { method: 'PUT', body: { revision: 0, settings: {} } });
    expect(settings.status).toBe(401);
    const importRequest = await harness.call('/api/import', { method: 'POST', body: { revision: 0, groups: [] } });
    expect(importRequest.status).toBe(401);
  });

  it('会话以哈希形式存储，登出后立即失效', async () => {
    await seedAdmin();
    const harness = createHarness();
    await harness.expectOk<StatusResponse>(await harness.login());
    const token = harness.cookie()!.replace('xingyu_session=', '');

    const rows = await env.DB.prepare('SELECT token_hash FROM sessions').all<{ token_hash: string }>();
    expect(rows.results).toHaveLength(1);
    expect(rows.results![0]!.token_hash).not.toBe(token);
    expect(rows.results![0]!.token_hash).toMatch(/^[0-9a-f]{64}$/);

    const logout = await harness.call('/api/logout', { body: {} });
    expect(logout.status).toBe(200);
    expect(logout.headers.getSetCookie().join(' ')).toContain('Max-Age=0');
    expect(harness.cookie()).toBeNull();

    const after = await harness.call('/api/content');
    expect(after.status).toBe(401);
  });

  it('修改密码撤销全部会话并要求重新登录', async () => {
    await seedAdmin();
    const deviceA = createHarness();
    const deviceB = createHarness();
    await deviceA.expectOk<StatusResponse>(await deviceA.login());
    await deviceB.expectOk<StatusResponse>(await deviceB.login());
    expect(deviceA.cookie()).not.toBe(deviceB.cookie());

    const newPassword = 'N3w-Pass!2026-ok';
    const changed = await deviceA.call('/api/password', {
      body: { currentPassword: TEST_PASSWORD, newPassword },
    });
    expect(changed.status).toBe(200);
    // 修改成功后清除本站 Cookie，并要求重新登录
    expect(changed.headers.getSetCookie().join(' ')).toContain('Max-Age=0');

    // 包括当前设备在内的全部会话被撤销
    expect((await deviceA.call('/api/content')).status).toBe(401);
    expect((await deviceB.call('/api/content')).status).toBe(401);
    const remaining = await env.DB.prepare('SELECT COUNT(*) AS count FROM sessions').first<{ count: number }>();
    expect(remaining?.count).toBe(0);

    // 旧密码失效、新密码可用
    const fresh = createHarness();
    expect((await fresh.login()).status).toBe(401);
    expect((await fresh.login({ password: newPassword })).status).toBe(200);
  });

  it('同源校验与 CSRF 令牌校验拦截跨站写入', async () => {
    await seedAdmin();
    const harness = createHarness();
    await harness.expectOk<StatusResponse>(await harness.login());

    const crossOrigin = await harness.call('/api/groups', {
      origin: 'https://evil.example',
      body: { revision: 0, name: 'x' },
    });
    expect(crossOrigin.status).toBe(403);
    expect((await harness.errorBody(crossOrigin)).error.code).toBe('origin_rejected');

    const missingCsrf = await harness.call('/api/groups', { csrf: null, body: { revision: 0, name: 'x' } });
    expect(missingCsrf.status).toBe(403);
    expect((await harness.errorBody(missingCsrf)).error.code).toBe('csrf_error');

    const wrongCsrf = await harness.call('/api/groups', { csrf: 'not-the-token', body: { revision: 0, name: 'x' } });
    expect(wrongCsrf.status).toBe(403);

    const ok = await harness.call('/api/groups', { body: { revision: 0, name: '工作' } });
    expect(ok.status).toBe(201);

    const noJson = await harness.call('/api/groups', { body: { revision: 1, name: 'x' }, contentType: 'text/plain' });
    expect(noJson.status).toBe(415);

    const invalidJson = await harness.call('/api/groups', { rawBody: '{oops', contentType: 'application/json' });
    expect(invalidJson.status).toBe(400);
  });

  it('会话 7 天后过期，过期请求不会被续期', async () => {
    await seedAdmin();
    const harness = createHarness();
    await harness.expectOk<StatusResponse>(await harness.login());

    harness.advance(SESSION_TTL_MS + 1000);
    const response = await harness.call('/api/content');
    expect(response.status).toBe(401);
    expect((await harness.errorBody(response)).error.code).toBe('session_expired');

    const remaining = await env.DB.prepare('SELECT COUNT(*) AS count FROM sessions').first<{ count: number }>();
    expect(remaining?.count).toBe(0);
  });

  it('被动内容读取不续期，显式活动上报才顺延过期时间', async () => {
    await seedAdmin();
    const harness = createHarness();
    await harness.expectOk<StatusResponse>(await harness.login());
    const initialExpiry = (
      await env.DB.prepare('SELECT expires_at FROM sessions').first<{ expires_at: number }>()
    )!.expires_at;

    // 长时间后的被动内容读取不会续期（后台轮询不延长会话）
    harness.advance(2 * 60 * 60 * 1000);
    const passive = await harness.call('/api/content');
    expect(passive.status).toBe(200);
    expect(passive.headers.get('set-cookie')).toBeNull();
    const unchanged = (
      await env.DB.prepare('SELECT expires_at FROM sessions').first<{ expires_at: number }>()
    )!.expires_at;
    expect(unchanged).toBe(initialExpiry);

    // 显式活动上报（页面访问 / 前台交互）顺延七天
    const activity = await harness.call('/api/session/activity', { method: 'POST', body: {} });
    expect(activity.status).toBe(200);
    expect(activity.headers.getSetCookie().join(' ')).toContain('xingyu_session=');
    const renewedExpiry = (
      await env.DB.prepare('SELECT expires_at FROM sessions').first<{ expires_at: number }>()
    )!.expires_at;
    expect(renewedExpiry).toBe(harness.now() + SESSION_TTL_MS);
    expect(renewedExpiry).toBeGreaterThan(initialExpiry);

    // 续期后的会话在原到期时间之后依然有效
    harness.setNow(initialExpiry + 60 * 1000);
    expect((await harness.call('/api/content')).status).toBe(200);
  });

  it('无效 Cookie 会被清除并返回未认证状态', async () => {
    await seedAdmin();
    const harness = createHarness();
    const response = await harness.call('/api/status', { cookie: 'xingyu_session=abcdefghijklmnopqrstuvwx' });
    expect(response.status).toBe(200);
    const body = await harness.json<StatusResponse>(response);
    expect(body.authenticated).toBe(false);
    expect(response.headers.getSetCookie().join(' ')).toContain('Max-Age=0');
  });
});
