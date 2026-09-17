import type { Env } from '../functions/_lib/env';
import { handleApiRequest } from '../functions/_lib/router';

/**
 * Cloudflare Workers 运行时绑定。
 * 在 Pages Functions 的绑定之上增加静态资源绑定（由 wrangler.jsonc 的
 * `assets.binding` 提供，指向 Vite 构建产物 dist/）。
 */
export interface WorkerEnv extends Env {
  ASSETS: Fetcher;
}

/**
 * 只拦截精确的 `/api` 与 `/api/*`。
 * 注意不能用 `startsWith('/api')`，否则 `/apiary`、`/api-docs` 之类的静态路径
 * 会被误判为接口。
 */
export function isApiPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/');
}

/**
 * Workers 入口：与 Pages Functions 复用同一份 `functions/_lib/router`，
 * 保证两种部署形态的路由、鉴权、校验与错误响应完全一致。
 * 非 API 请求原样交给静态资源绑定（SPA 回退由 assets.not_found_handling 处理）。
 */
export async function handleWorkerRequest(request: Request, env: WorkerEnv): Promise<Response> {
  const url = new URL(request.url);
  if (isApiPath(url.pathname)) {
    return handleApiRequest(request, env);
  }
  return env.ASSETS.fetch(request);
}

export default {
  fetch: handleWorkerRequest,
} satisfies ExportedHandler<WorkerEnv>;
