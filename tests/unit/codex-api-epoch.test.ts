import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { apiRequest, getCsrfToken, setCsrfToken } from '../../src/api/client';
import { resetContentState } from '../../src/stores/content';
import { bootstrapSession, loginRequest, sessionState } from '../../src/stores/session';

/**
 * 会话代际（epoch）回归测试：
 * 登录 / 登出 / 会话过期会推进代际，属于旧代际的响应在触碰任何全局状态
 * （CSRF 令牌 / 会话过期回调 / bootstrap 清理）之前必须被丢弃。
 */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const LOGIN_OK = () =>
  jsonResponse({
    setupRequired: false,
    authenticated: true,
    user: { username: 'admin' },
    csrfToken: 'fresh-token',
  });

beforeEach(() => {
  resetContentState();
  sessionState.ready = true;
  sessionState.statusError = '';
  sessionState.setupRequired = false;
  sessionState.authenticated = false;
  sessionState.username = '';
  sessionState.busy = false;
  setCsrfToken(null);
});

afterEach(() => vi.unstubAllGlobals());

it('登录前发出的 status 响应不能覆盖登录后的 CSRF 令牌', async () => {
  let resolveStatus!: (response: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/status')) {
        return new Promise<Response>((resolve) => {
          resolveStatus = resolve;
        });
      }
      if (url.includes('/api/login')) return Promise.resolve(LOGIN_OK());
      return Promise.resolve(jsonResponse({ ok: true }));
    }),
  );

  const pendingStatus = apiRequest<{ csrfToken?: string }>('/api/status', { silentSession: true });
  await loginRequest('admin', 'password');
  expect(getCsrfToken()).toBe('fresh-token');
  expect(sessionState.authenticated).toBe(true);

  resolveStatus(jsonResponse({ setupRequired: false, authenticated: true, csrfToken: 'stale-token' }));
  await expect(pendingStatus).rejects.toMatchObject({ code: 'stale_response' });
  expect(getCsrfToken()).toBe('fresh-token');
  expect(sessionState.authenticated).toBe(true);
});

it('登录前发出的 401 响应不能把新会话标记为过期', async () => {
  let resolveContent!: (response: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/content')) {
        return new Promise<Response>((resolve) => {
          resolveContent = resolve;
        });
      }
      if (url.includes('/api/login')) return Promise.resolve(LOGIN_OK());
      return Promise.resolve(jsonResponse({ ok: true }));
    }),
  );

  const pendingContent = apiRequest('/api/content');
  const settled = pendingContent.catch(() => undefined);
  await loginRequest('admin', 'password');
  expect(sessionState.authenticated).toBe(true);

  resolveContent(jsonResponse({ error: { code: 'unauthorized', message: '会话已过期' } }, 401));
  await expect(pendingContent).rejects.toMatchObject({ code: 'stale_response' });
  expect(sessionState.authenticated).toBe(true);
  expect(getCsrfToken()).toBe('fresh-token');
  await settled;
});

it('旧代际的 bootstrap 响应不会清理刚登录的状态', async () => {
  let resolveStatus!: (response: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/status')) {
        return new Promise<Response>((resolve) => {
          resolveStatus = resolve;
        });
      }
      if (url.includes('/api/login')) return Promise.resolve(LOGIN_OK());
      return Promise.resolve(jsonResponse({ ok: true }));
    }),
  );

  const pendingBootstrap = bootstrapSession();
  await loginRequest('admin', 'password');
  expect(sessionState.authenticated).toBe(true);

  resolveStatus(jsonResponse({ setupRequired: false, authenticated: false }));
  await expect(pendingBootstrap).resolves.toBeNull();
  expect(sessionState.authenticated).toBe(true);
  expect(sessionState.username).toBe('admin');
  expect(getCsrfToken()).toBe('fresh-token');
});
