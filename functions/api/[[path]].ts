import type { Env } from '../_lib/env';
import { handleApiRequest } from '../_lib/router';

/**
 * 所有 /api/* 请求的统一入口（Cloudflare Pages Functions 文件路由）。
 * 具体路由与业务逻辑位于 functions/_lib 中，测试直接覆盖同一份代码。
 */
export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  return handleApiRequest(request, env);
};
