import type { ApiErrorBody, ApiErrorCode, ApiErrorIssue } from '../shared/types';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode | 'network_error';
  readonly issues?: ApiErrorIssue[];
  readonly retryAfterSeconds?: number;
  readonly revision?: number;

  constructor(
    status: number,
    code: ApiErrorCode | 'network_error',
    message: string,
    options: { issues?: ApiErrorIssue[]; retryAfterSeconds?: number; revision?: number } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.issues = options.issues;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.revision = options.revision;
  }

  get isConflict(): boolean {
    return this.code === 'revision_conflict';
  }

  get isSessionExpired(): boolean {
    return this.code === 'session_expired' || this.code === 'unauthorized';
  }
}

type SessionExpiredHandler = () => void;

let sessionExpiredHandler: SessionExpiredHandler | null = null;
let csrfToken: string | null = null;
/**
 * 会话代际：登录 / 登出 / 会话过期时递增。
 * 内容请求会记住发起时的代际，响应返回时如果代际已变化则丢弃，
 * 防止已失效会话的在途响应把私有内容重新写回状态。
 */
let sessionEpoch = 0;

export function getSessionEpoch(): number {
  return sessionEpoch;
}

export function bumpSessionEpoch(): void {
  sessionEpoch += 1;
}

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

export function getCsrfToken(): string | null {
  return csrfToken;
}

export function setSessionExpiredHandler(handler: SessionExpiredHandler | null): void {
  sessionExpiredHandler = handler;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** 跳过会话过期回调（用于状态探测） */
  silentSession?: boolean;
  signal?: AbortSignal;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  // 记录发起请求时的会话代际：响应返回后，如果登录 / 登出 / 会话过期已经发生，
  // 这次响应就属于旧会话，绝不能再用它修改全局 CSRF 或触发会话过期回调。
  const requestEpoch = sessionEpoch;
  const method = options.method ?? (options.body === undefined ? 'GET' : 'POST');
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(0, 'network_error', '网络连接失败，请检查网络后重试');
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    // 读取完响应体后、产生任何全局副作用之前，先丢弃旧代际的响应
    if (requestEpoch !== sessionEpoch) throw staleResponseError();
    const body = payload as ApiErrorBody | null;
    const error = new ApiError(response.status, body?.error?.code ?? 'internal_error', body?.error?.message ?? `请求失败（${response.status}）`, {
      issues: body?.error?.issues,
      retryAfterSeconds: body?.error?.retryAfterSeconds,
      revision: body?.error?.revision,
    });
    if (error.isSessionExpired && !options.silentSession && sessionExpiredHandler) sessionExpiredHandler();
    throw error;
  }

  if (requestEpoch !== sessionEpoch) throw staleResponseError();

  if (payload && typeof payload === 'object' && 'csrfToken' in payload) {
    const token = (payload as { csrfToken?: unknown }).csrfToken;
    if (typeof token === 'string') csrfToken = token;
  }
  return payload as T;
}

function staleResponseError(): ApiError {
  return new ApiError(0, 'stale_response', '登录状态已变化，该响应已被忽略');
}

export function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'rate_limited' && error.retryAfterSeconds) {
      return `${error.message}（约 ${error.retryAfterSeconds} 秒后可重试）`;
    }
    if (error.code === 'network_error') {
      return `${error.message}（可点击重试）`;
    }
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return '发生未知错误';
}
