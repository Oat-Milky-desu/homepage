import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { handleWorkerRequest, isApiPath, type WorkerEnv } from '../../worker/index';
import type { ApiErrorBody } from '../../src/shared/types';
import { resetDatabase } from './helpers';

const ORIGIN = 'https://nav.example.com';
const HOST = 'nav.example.com';

/**
 * 测试里用假的 ASSETS 绑定：官方 Workers 静态资源绑定在 Vitest 集成中
 * 不会自动暴露，适配层只需保证把非 API 请求原样委派给它。
 */
function createAssetsFetcher(): { fetcher: Fetcher; requests: Request[] } {
  const requests: Request[] = [];
  const fetcher = {
    fetch: async (request: Request): Promise<Response> => {
      requests.push(request);
      const url = new URL(request.url);
      return new Response(`static:${url.pathname}${url.search}`, {
        status: 200,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Asset': '1' },
      });
    },
  };
  return { fetcher: fetcher as unknown as Fetcher, requests };
}

/** 真实 Miniflare 绑定（D1 / INIT_SECRET）+ 假的 ASSETS 绑定 */
function buildWorkerEnv(assets: Fetcher): WorkerEnv {
  return { ...env, ASSETS: assets } as unknown as WorkerEnv;
}

function apiRequest(path: string, method = 'GET'): Request {
  return new Request(`${ORIGIN}${path}`, { method, headers: { host: HOST } });
}

describe('Worker 入口（Workers 适配层）', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('精确的 /api 与 /api/* 都走 API 路由，未知接口返回 no-store JSON 404', async () => {
    const { fetcher, requests } = createAssetsFetcher();
    const workerEnv = buildWorkerEnv(fetcher);

    for (const path of ['/api', '/api/', '/api/unknown', '/api/unknown/deeper']) {
      const response = await handleWorkerRequest(apiRequest(path), workerEnv);
      expect(response.status).toBe(404);
      expect(response.headers.get('content-type')).toContain('application/json');
      expect(response.headers.get('cache-control')).toContain('no-store');
      const body = (await response.json()) as ApiErrorBody;
      expect(body.error.code).toBe('not_found');
    }
    expect(requests).toHaveLength(0);
  });

  it('未登录访问受保护接口返回 401，并清除会话 Cookie', async () => {
    const { fetcher, requests } = createAssetsFetcher();
    const workerEnv = buildWorkerEnv(fetcher);

    for (const path of ['/api/content', '/api/backup']) {
      const response = await handleWorkerRequest(apiRequest(path), workerEnv);
      expect(response.status).toBe(401);
      expect(response.headers.get('content-type')).toContain('application/json');
      expect(response.headers.get('cache-control')).toContain('no-store');
      const body = (await response.json()) as ApiErrorBody;
      expect(body.error.code).toBe('unauthorized');
      expect(response.headers.get('set-cookie')).toContain('xingyu_session=');
      expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    }
    expect(requests).toHaveLength(0);
  });

  it('Worker 运行时通过真实 D1 提供 /api/status', async () => {
    const { fetcher } = createAssetsFetcher();
    const response = await handleWorkerRequest(apiRequest('/api/status'), buildWorkerEnv(fetcher));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ setupRequired: true, authenticated: false });
  });

  it('非 API 路径原样委派给 ASSETS，且不误伤前缀相似的 /apiary、/api-docs', async () => {
    const { fetcher, requests } = createAssetsFetcher();
    const workerEnv = buildWorkerEnv(fetcher);

    for (const path of ['/', '/admin?tab=links', '/index.html', '/apiary', '/api-docs', '/apiary/extra']) {
      const request = apiRequest(path);
      const response = await handleWorkerRequest(request, workerEnv);
      expect(response.status).toBe(200);
      expect(response.headers.get('x-asset')).toBe('1');
      expect(await response.text()).toBe(`static:${new URL(request.url).pathname}${new URL(request.url).search}`);
    }

    expect(requests).toHaveLength(6);
    expect(requests[1]!.url).toBe(`${ORIGIN}/admin?tab=links`);
    expect(requests[1]!.headers.get('host')).toBe(HOST);
  });

  it('isApiPath 只接受精确的 /api 与 /api/ 前缀', () => {
    expect(isApiPath('/api')).toBe(true);
    expect(isApiPath('/api/')).toBe(true);
    expect(isApiPath('/api/content')).toBe(true);
    expect(isApiPath('/apiary')).toBe(false);
    expect(isApiPath('/api-docs')).toBe(false);
    expect(isApiPath('/')).toBe(false);
  });
});
