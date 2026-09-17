import type { ApiErrorBody, ApiErrorCode, ApiErrorIssue } from '../../src/shared/types';

export class HttpError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly issues?: ApiErrorIssue[];
  readonly retryAfterSeconds?: number;
  readonly revision?: number;
  readonly extraHeaders?: Record<string, string>;

  constructor(
    status: number,
    code: ApiErrorCode,
    message: string,
    options: {
      issues?: ApiErrorIssue[];
      retryAfterSeconds?: number;
      revision?: number;
      headers?: Record<string, string>;
    } = {},
  ) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.issues = options.issues;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.revision = options.revision;
    this.extraHeaders = options.headers;
  }
}

export const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function baseHeaders(): Record<string, string> {
  return {
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    Vary: 'Cookie',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  };
}

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...baseHeaders(),
      'Content-Type': 'application/json; charset=utf-8',
      ...headers,
    },
  });
}

export function errorResponse(error: HttpError): Response {
  const body: ApiErrorBody = {
    error: {
      code: error.code,
      message: error.message,
      ...(error.issues ? { issues: error.issues } : {}),
      ...(error.retryAfterSeconds !== undefined ? { retryAfterSeconds: error.retryAfterSeconds } : {}),
      ...(error.revision !== undefined ? { revision: error.revision } : {}),
    },
  };
  const headers: Record<string, string> = { ...(error.extraHeaders ?? {}) };
  if (error.retryAfterSeconds !== undefined) headers['Retry-After'] = String(error.retryAfterSeconds);
  return jsonResponse(body, error.status, headers);
}

export function methodNotAllowed(allowed: string[]): HttpError {
  return new HttpError(405, 'method_not_allowed', `不支持的请求方法，允许：${allowed.join(', ')}`, {
    headers: { Allow: allowed.join(', ') },
  });
}

export function notFound(message = '接口不存在'): HttpError {
  return new HttpError(404, 'not_found', message);
}

/** 以流式方式读取请求体，超过上限立即中止（避免大体积请求占用内存） */
export async function readBodyText(request: Request, maxBytes: number): Promise<string> {
  const contentLength = request.headers.get('content-length');
  if (contentLength) {
    const length = Number.parseInt(contentLength, 10);
    if (Number.isFinite(length) && length > maxBytes) {
      throw new HttpError(413, 'payload_too_large', '请求体过大');
    }
  }
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          throw new HttpError(413, 'payload_too_large', '请求体过大');
        }
        chunks.push(value);
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* 读取器已被取消 */
    }
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

export async function readJson(request: Request, maxBytes: number): Promise<unknown> {
  const text = await readBodyText(request, maxBytes);
  if (!text.trim()) {
    throw new HttpError(400, 'validation_error', '请求体不能为空');
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HttpError(400, 'validation_error', '请求体不是合法的 JSON');
  }
}

export function assertJsonContentType(request: Request): void {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'unsupported_media_type', '请求必须使用 application/json');
  }
}

/**
 * 同源校验：所有非安全方法都必须来自本站页面。
 * 比较完整的 origin（协议 + 主机 + 端口），协议或端口不同即拒绝。
 * 反向代理场景以 Host 头推导出的完整 origin 作为本站 origin；
 * 本地 Vite 代理等开发场景必须通过 DEV_ORIGIN 显式配置，绝不在生产环境放宽。
 */
export function assertSameOrigin(request: Request, url: URL, devOrigin?: string): void {
  const expectedOrigins = new Set<string>([url.origin.toLowerCase()]);
  const hostHeader = request.headers.get('host');
  if (hostHeader && hostHeader.toLowerCase() !== url.host.toLowerCase()) {
    // 请求经过代理（例如 Vite → wrangler pages dev），Host 头反映浏览器实际访问的 origin
    expectedOrigins.add(`${url.protocol}//${hostHeader.toLowerCase()}`);
  }
  if (devOrigin) {
    try {
      expectedOrigins.add(new URL(devOrigin).origin.toLowerCase());
    } catch {
      /* 配置错误时忽略，绝不放宽校验 */
    }
  }

  const headerOrigin = request.headers.get('origin');
  const headerReferer = request.headers.get('referer');
  const candidate = headerOrigin ?? (headerReferer ? safeOrigin(headerReferer) : null);
  if (!candidate) {
    throw new HttpError(403, 'origin_rejected', '缺少来源信息，已拒绝该请求');
  }
  if (candidate === 'null') {
    throw new HttpError(403, 'origin_rejected', '来源不受信任，已拒绝该请求');
  }
  const candidateUrl = safeUrl(candidate);
  if (!candidateUrl) {
    throw new HttpError(403, 'origin_rejected', '来源不受信任，已拒绝该请求');
  }
  if (!expectedOrigins.has(candidateUrl.origin.toLowerCase())) {
    throw new HttpError(403, 'origin_rejected', '跨站请求已被拒绝');
  }
}

function safeUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function safeOrigin(value: string): string | null {
  const url = safeUrl(value);
  return url ? url.origin : null;
}
