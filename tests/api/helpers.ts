import { env } from 'cloudflare:test';
import { createApiHandler } from '../../functions/_lib/router';
import { hashPassword } from '../../functions/_lib/crypto';
import type { ApiErrorBody, ContentPayload, NavGroup, NavLink } from '../../src/shared/types';

export const ORIGIN = 'https://nav.example.com';
export const HOST = 'nav.example.com';
export const TEST_ITERATIONS = 1000;
export const TEST_USERNAME = 'admin';
export const TEST_PASSWORD = 'Str0ng-Pass!2026';
export const TEST_INIT_SECRET = 'test-init-secret';

export interface CallInit {
  method?: string;
  body?: unknown;
  /** 显式指定 Cookie（默认使用会话中保存的 Cookie） */
  cookie?: string | null;
  csrf?: string | null;
  origin?: string | null;
  headers?: Record<string, string>;
  contentType?: string | null;
  rawBody?: string;
}

export interface Harness {
  call(path: string, init?: CallInit): Promise<Response>;
  json<T = unknown>(response: Response): Promise<T>;
  /** 断言状态码 < 400，并自动记录返回的 csrfToken */
  expectOk<T>(response: Response): Promise<T>;
  errorBody(response: Response): Promise<ApiErrorBody>;
  now(): number;
  advance(ms: number): void;
  setNow(value: number): void;
  cookie(): string | null;
  csrf(): string | null;
  setup(overrides?: { initSecret?: string; username?: string; password?: string }): Promise<Response>;
  login(overrides?: { username?: string; password?: string }): Promise<Response>;
  getContent(): Promise<ContentPayload>;
  createGroup(name: string): Promise<NavGroup>;
  createLink(
    groupId: string,
    overrides?: Partial<Pick<NavLink, 'name' | 'url' | 'description' | 'iconType' | 'iconValue' | 'target'>>,
  ): Promise<NavLink>;
}

const DEFAULT_NOW = Date.parse('2026-03-01T08:00:00.000Z');

export function createHarness(): Harness {
  let currentNow = DEFAULT_NOW;
  const handler = createApiHandler({ now: () => currentNow, pbkdf2Iterations: TEST_ITERATIONS });
  let cookie: string | null = null;
  let csrfToken: string | null = null;

  function captureCookies(response: Response): void {
    const values = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
    const list = values.length > 0 ? values : [response.headers.get('set-cookie') ?? ''];
    for (const value of list) {
      const match = /(?:^|[,\s])xingyu_session=([^;,\s]*)/.exec(value);
      if (!match) continue;
      const token = match[1] ?? '';
      if (token === '') {
        cookie = null;
        csrfToken = null;
      } else {
        cookie = `xingyu_session=${token}`;
      }
    }
  }

  async function call(path: string, init: CallInit = {}): Promise<Response> {
    const method = init.method ?? (init.body === undefined && init.rawBody === undefined ? 'GET' : 'POST');
    const headers: Record<string, string> = { ...(init.headers ?? {}) };
    const origin = init.origin === undefined ? ORIGIN : init.origin;
    // Host 始终指向真实站点：跨站请求不会把 Host 改成攻击者的域名
    headers.host = HOST;
    if (origin) {
      headers.origin = origin;
    }
    if (method !== 'GET' && method !== 'HEAD') {
      const contentType = init.contentType === undefined ? 'application/json' : init.contentType;
      if (contentType) headers['content-type'] = contentType;
    }
    const activeCookie = init.cookie === undefined ? cookie : init.cookie;
    if (activeCookie) headers.cookie = activeCookie;
    const activeCsrf = init.csrf === undefined ? csrfToken : init.csrf;
    if (activeCsrf) headers['x-csrf-token'] = activeCsrf;
    let body: string | undefined;
    if (init.rawBody !== undefined) body = init.rawBody;
    else if (init.body !== undefined) body = JSON.stringify(init.body);
    const response = await handler(new Request(`${ORIGIN}${path}`, { method, headers, body }), env);
    captureCookies(response);
    return response;
  }

  async function json<T>(response: Response): Promise<T> {
    const text = await response.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`响应不是 JSON（状态码 ${response.status}）：${text.slice(0, 200)}`);
    }
  }

  async function expectOk<T>(response: Response): Promise<T> {
    const payload = await json<T & { csrfToken?: string }>(response);
    if (response.status >= 400) {
      throw new Error(`请求失败（${response.status}）：${JSON.stringify(payload).slice(0, 300)}`);
    }
    if (typeof payload === 'object' && payload !== null && typeof payload.csrfToken === 'string') {
      csrfToken = payload.csrfToken;
    }
    return payload;
  }

  const harness: Harness = {
    call,
    json,
    expectOk,
    errorBody: (response) => json<ApiErrorBody>(response),
    now: () => currentNow,
    advance: (ms) => {
      currentNow += ms;
    },
    setNow: (value) => {
      currentNow = value;
    },
    cookie: () => cookie,
    csrf: () => csrfToken,
    async setup(overrides = {}) {
      return call('/api/setup', {
        body: {
          initSecret: overrides.initSecret ?? TEST_INIT_SECRET,
          username: overrides.username ?? TEST_USERNAME,
          password: overrides.password ?? TEST_PASSWORD,
        },
      });
    },
    async login(overrides = {}) {
      return call('/api/login', {
        body: { username: overrides.username ?? TEST_USERNAME, password: overrides.password ?? TEST_PASSWORD },
      });
    },
    async getContent() {
      return expectOk<ContentPayload>(await call('/api/content', { method: 'GET' }));
    },
    async createGroup(name: string) {
      const content = await expectOk<ContentPayload>(await call('/api/content', { method: 'GET' }));
      const created = await expectOk<{ revision: number; group: NavGroup }>(
        await call('/api/groups', { body: { revision: content.revision, name } }),
      );
      return created.group;
    },
    async createLink(groupId, overrides = {}) {
      const content = await expectOk<ContentPayload>(await call('/api/content', { method: 'GET' }));
      const created = await expectOk<{ revision: number; link: NavLink }>(
        await call('/api/links', {
          body: {
            revision: content.revision,
            groupId,
            name: '示例站点',
            url: 'https://example.com',
            description: '',
            ...overrides,
          },
        }),
      );
      return created.link;
    },
  };

  return harness;
}

/** 清空所有表并重置版本号，保证测试之间互不影响 */
export async function resetDatabase(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM links'),
    env.DB.prepare('DELETE FROM groups'),
    env.DB.prepare('DELETE FROM sessions'),
    env.DB.prepare('DELETE FROM login_attempts'),
    env.DB.prepare('DELETE FROM admin_users'),
    env.DB.prepare('DELETE FROM settings'),
    env.DB.prepare("INSERT INTO settings (id, settings_json, updated_at) VALUES (1, '{}', '2026-03-01T00:00:00.000Z')"),
    env.DB.prepare("UPDATE app_meta SET revision = 0, updated_at = '2026-03-01T00:00:00.000Z' WHERE id = 1"),
  ]);
}

/** 直接写入管理员记录（跳过初始化接口） */
export async function seedAdmin(): Promise<void> {
  const hash = await hashPassword(TEST_PASSWORD, TEST_ITERATIONS);
  await env.DB.prepare(
    'INSERT INTO admin_users (id, username, password_hash, created_at, updated_at) VALUES (1, ?1, ?2, ?3, ?3)',
  )
    .bind(TEST_USERNAME, hash, '2026-03-01T00:00:00.000Z')
    .run();
}
