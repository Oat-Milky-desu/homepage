import { ValidationError } from '../../src/shared/validate';
import { CSRF_HEADER, buildClearedSessionCookie, isSecureRequest, requireSession } from './auth';
import { timingSafeEqual } from './crypto';
import type { ApiOptions, Env } from './env';
import {
  HttpError,
  UNSAFE_METHODS,
  assertJsonContentType,
  assertSameOrigin,
  errorResponse,
  methodNotAllowed,
  notFound,
} from './http';
import type { Ctx } from './context';
import { handleActivity, handleLogin, handleLogout, handlePasswordChange, handleSetup, handleStatus } from './handlers-auth';
import {
  handleCreateGroup,
  handleCreateLink,
  handleDeleteGroup,
  handleDeleteLink,
  handleGetContent,
  handleReorder,
  handleUpdateGroup,
  handleUpdateLink,
  handleUpdateSettings,
} from './handlers-content';
import { handleExportBackup, handleImport, handleRestoreBackup } from './handlers-data';

interface RouteDefinition {
  method: string;
  /** 相对于 /api 的模式，例如 groups/:id */
  pattern: string;
  auth: boolean;
  handler: (ctx: Ctx) => Promise<Response>;
}

export const ROUTES: RouteDefinition[] = [
  { method: 'GET', pattern: 'status', auth: false, handler: handleStatus },
  { method: 'POST', pattern: 'setup', auth: false, handler: handleSetup },
  { method: 'POST', pattern: 'login', auth: false, handler: handleLogin },
  { method: 'POST', pattern: 'logout', auth: true, handler: handleLogout },
  { method: 'POST', pattern: 'session/activity', auth: true, handler: handleActivity },
  { method: 'POST', pattern: 'password', auth: true, handler: handlePasswordChange },
  { method: 'GET', pattern: 'content', auth: true, handler: handleGetContent },
  { method: 'POST', pattern: 'groups', auth: true, handler: handleCreateGroup },
  { method: 'PATCH', pattern: 'groups/:id', auth: true, handler: handleUpdateGroup },
  { method: 'DELETE', pattern: 'groups/:id', auth: true, handler: handleDeleteGroup },
  { method: 'PUT', pattern: 'order', auth: true, handler: handleReorder },
  { method: 'POST', pattern: 'links', auth: true, handler: handleCreateLink },
  { method: 'PATCH', pattern: 'links/:id', auth: true, handler: handleUpdateLink },
  { method: 'DELETE', pattern: 'links/:id', auth: true, handler: handleDeleteLink },
  { method: 'PUT', pattern: 'settings', auth: true, handler: handleUpdateSettings },
  { method: 'GET', pattern: 'backup', auth: true, handler: handleExportBackup },
  { method: 'POST', pattern: 'restore', auth: true, handler: handleRestoreBackup },
  { method: 'POST', pattern: 'import', auth: true, handler: handleImport },
];

function segmentsOf(pathname: string): string[] {
  const stripped = pathname.replace(/^\/api(?=\/|$)/, '');
  return stripped.split('/').map((part) => part.trim()).filter((part) => part.length > 0);
}

function matchPattern(pattern: string, segments: string[]): boolean {
  const parts = pattern.split('/');
  if (parts.length !== segments.length) return false;
  return parts.every((part, index) => (part.startsWith(':') ? segments[index]!.length > 0 : part === segments[index]));
}

function extractParams(pattern: string, segments: string[]): Record<string, string> {
  const params: Record<string, string> = {};
  pattern.split('/').forEach((part, index) => {
    if (part.startsWith(':')) params[part.slice(1)] = decodeURIComponent(segments[index] ?? '');
  });
  return params;
}

export function createApiHandler(options: ApiOptions = {}) {
  const clock = options.now ?? (() => Date.now());

  async function dispatch(request: Request, env: Env): Promise<Response> {
    const url = tryParseUrl(request.url);
    if (!url) throw new HttpError(400, 'validation_error', '请求地址无效');
    const segments = segmentsOf(url.pathname);
    const method = request.method.toUpperCase();

    const pathMatches = ROUTES.filter((route) => matchPattern(route.pattern, segments));
    if (pathMatches.length === 0) throw notFound();
    const route = pathMatches.find((candidate) => candidate.method === method);
    if (!route) throw methodNotAllowed([...new Set(pathMatches.map((candidate) => candidate.method))]);

    const now = clock();
    const ctx: Ctx = {
      request,
      env,
      url,
      params: extractParams(route.pattern, segments),
      now,
      nowIso: new Date(now).toISOString(),
      secureCookie: isSecureRequest(url, env),
      options,
    };

    const unsafe = UNSAFE_METHODS.has(method);
    if (unsafe) {
      assertSameOrigin(request, url, options.devOrigin ?? env.DEV_ORIGIN);
      assertJsonContentType(request);
    }

    if (!route.auth) {
      return route.handler(ctx);
    }

    const auth = await requireSession(env.DB, request, now);
    ctx.auth = auth;
    if (unsafe) {
      const provided = request.headers.get(CSRF_HEADER) ?? '';
      if (!provided || !timingSafeEqual(provided, auth.session.csrfToken)) {
        throw new HttpError(403, 'csrf_error', '请求令牌无效，请刷新页面后重试');
      }
    }

    // 注意：普通 GET 不会续期会话。只有显式的 POST /api/session/activity 会顺延过期时间。
    return route.handler(ctx);
  }

  return async function handle(request: Request, env: Env): Promise<Response> {
    try {
      return await dispatch(request, env);
    } catch (error) {
      return toErrorResponse(error, request, env);
    }
  };
}

function tryParseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function toErrorResponse(error: unknown, request: Request, env: Env): Response {
  const url = tryParseUrl(request.url);
  const secure = url ? isSecureRequest(url, env) : false;

  if (error instanceof ValidationError) {
    return errorResponse(new HttpError(400, 'validation_error', '请求数据校验失败', { issues: error.issues }));
  }
  if (error instanceof HttpError) {
    const response = errorResponse(error);
    if (error.status === 401) {
      const headers = new Headers(response.headers);
      headers.append('Set-Cookie', buildClearedSessionCookie(secure));
      return new Response(response.body, { status: error.status, headers });
    }
    return response;
  }
  console.error('API 未处理错误:', error);
  return errorResponse(new HttpError(500, 'internal_error', '服务器内部错误'));
}

/** 生产环境使用的处理器实例 */
export const handleApiRequest = createApiHandler();
