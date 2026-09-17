import type { ApiOptions, Env } from './env';
import type { AuthState } from './auth';
import { HttpError } from './http';
import { IMPORT_BODY_LIMIT_BYTES, JSON_BODY_LIMIT_BYTES, RESTORE_BODY_LIMIT_BYTES } from '../../src/shared/limits';

export const JSON_BODY_LIMIT = JSON_BODY_LIMIT_BYTES;
export const IMPORT_BODY_LIMIT = IMPORT_BODY_LIMIT_BYTES;
export const RESTORE_BODY_LIMIT = RESTORE_BODY_LIMIT_BYTES;

export interface Ctx {
  request: Request;
  env: Env;
  url: URL;
  params: Record<string, string>;
  now: number;
  nowIso: string;
  secureCookie: boolean;
  options: ApiOptions;
  auth?: AuthState;
}

/** 已在路由器中完成鉴权的处理器使用该函数取得会话 */
export function requireAuth(ctx: Ctx): AuthState {
  if (!ctx.auth) throw new HttpError(401, 'unauthorized', '请先登录');
  return ctx.auth;
}
