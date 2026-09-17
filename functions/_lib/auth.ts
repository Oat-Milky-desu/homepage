import type { Env } from './env';
import { randomToken, sha256Hex, timingSafeEqual } from './crypto';
import { HttpError } from './http';

export const SESSION_COOKIE = 'xingyu_session';
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_IP_LIMIT = 20;
export const LOGIN_USER_LIMIT = 5;
export const SETUP_IP_LIMIT = 10;
export const PASSWORD_CHANGE_LIMIT = 10;
export const CSRF_HEADER = 'x-csrf-token';

export interface SessionRecord {
  tokenHash: string;
  userId: number;
  csrfToken: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
}

export interface AuthState {
  token: string;
  session: SessionRecord;
  username: string;
}

interface SessionJoinRow {
  token_hash: string;
  user_id: number;
  csrf_token: string;
  created_at: number;
  last_seen_at: number;
  expires_at: number;
  username: string;
}

export function parseCookies(header: string | null): Record<string, string> {
  const result: Record<string, string> = {};
  if (!header) return result;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key && !(key in result)) result[key] = value;
  }
  return result;
}

export function isSecureRequest(url: URL, env: Env): boolean {
  if (url.protocol === 'https:') return true;
  return env.FORCE_SECURE_COOKIE === 'true';
}

export function buildSessionCookie(token: string, expiresAt: number, secure: boolean, now: number): string {
  const maxAge = Math.max(0, Math.floor((expiresAt - now) / 1000));
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function buildClearedSessionCookie(secure: boolean): string {
  const parts = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export interface NewSession {
  token: string;
  csrfToken: string;
  tokenHash: string;
  expiresAt: number;
}

/** 生成会话凭证（不写库，便于与其它写操作组成同一个事务） */
export async function createSessionValues(now: number): Promise<NewSession> {
  const token = randomToken(32);
  return {
    token,
    tokenHash: await sha256Hex(token),
    csrfToken: randomToken(24),
    expiresAt: now + SESSION_TTL_MS,
  };
}

export function insertSessionStatement(db: D1Database, userId: number, session: NewSession, now: number): D1PreparedStatement {
  return db
    .prepare(
      'INSERT INTO sessions (token_hash, user_id, csrf_token, created_at, last_seen_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?4, ?5)',
    )
    .bind(session.tokenHash, userId, session.csrfToken, now, session.expiresAt);
}

export async function createSession(db: D1Database, userId: number, now: number): Promise<NewSession> {
  const session = await createSessionValues(now);
  await insertSessionStatement(db, userId, session, now).run();
  return session;
}

export async function pruneExpiredSessions(db: D1Database, now: number): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE expires_at <= ?1').bind(now).run();
}

function unauthorized(message = '请先登录'): HttpError {
  return new HttpError(401, 'unauthorized', message);
}

/** 读取并校验会话；过期会话会被立即删除。续期只发生在显式活动上报接口。 */
export async function requireSession(db: D1Database, request: Request, now: number): Promise<AuthState> {
  const token = parseCookies(request.headers.get('cookie'))[SESSION_COOKIE];
  if (!token || !/^[A-Za-z0-9_-]{20,200}$/.test(token)) {
    throw unauthorized();
  }
  const tokenHash = await sha256Hex(token);
  const row = await db
    .prepare(
      `SELECT s.token_hash, s.user_id, s.csrf_token, s.created_at, s.last_seen_at, s.expires_at, u.username
       FROM sessions s JOIN admin_users u ON u.id = s.user_id
       WHERE s.token_hash = ?1`,
    )
    .bind(tokenHash)
    .first<SessionJoinRow>();
  if (!row) throw unauthorized('登录状态已失效，请重新登录');
  if (row.expires_at <= now) {
    await db.prepare('DELETE FROM sessions WHERE token_hash = ?1').bind(tokenHash).run();
    throw new HttpError(401, 'session_expired', '登录已过期，请重新登录');
  }
  const session: SessionRecord = {
    tokenHash: row.token_hash,
    userId: row.user_id,
    csrfToken: row.csrf_token,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
  };
  return { token, session, username: row.username };
}

export async function assertCsrfToken(_db: D1Database, auth: AuthState, request: Request, _now: number): Promise<void> {
  const provided = request.headers.get(CSRF_HEADER) ?? '';
  if (!provided || !timingSafeEqual(provided, auth.session.csrfToken)) {
    throw new HttpError(403, 'csrf_error', '请求令牌无效，请刷新页面后重试');
  }
}

/**
 * 显式活动上报时顺延会话过期时间。
 * 只有用户在页面上的真实操作（或已认证的页面访问）会调用这里，后台轮询不会续期。
 */
export async function touchSession(db: D1Database, auth: AuthState, now: number): Promise<number> {
  const expiresAt = now + SESSION_TTL_MS;
  await db
    .prepare('UPDATE sessions SET last_seen_at = ?1, expires_at = ?2 WHERE token_hash = ?3')
    .bind(now, expiresAt, auth.session.tokenHash)
    .run();
  auth.session.lastSeenAt = now;
  auth.session.expiresAt = expiresAt;
  return expiresAt;
}

/* ------------------------------- 频率限制 ------------------------------- */

export interface RateLimitRule {
  scope: string;
  identifier: string;
  limit: number;
  windowMs?: number;
}

export async function pruneAttempts(db: D1Database, now: number): Promise<void> {
  await db.prepare('DELETE FROM login_attempts WHERE attempted_at < ?1').bind(now - 24 * 60 * 60 * 1000).run();
}

async function retryAfterFor(db: D1Database, rule: RateLimitRule, now: number): Promise<number> {
  const windowMs = rule.windowMs ?? RATE_LIMIT_WINDOW_MS;
  const row = await db
    .prepare('SELECT MIN(attempted_at) AS oldest FROM login_attempts WHERE scope = ?1 AND identifier = ?2 AND attempted_at > ?3')
    .bind(rule.scope, rule.identifier, now - windowMs)
    .first<{ oldest: number | null }>();
  const oldest = row?.oldest ?? now;
  return Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
}

/**
 * 原子占用一次尝试名额。
 * 每条记录的插入都是带条件的单条 SQL（count < limit 时才插入），
 * 由 SQLite 自身保证原子性，因此并发请求不可能一起越过阈值，
 * 也不依赖任何“先读后写”的窗口。
 * 返回每条规则对应记录的行号，供成功清理时精确定位（不误删并发失败记录）。
 * 任意规则达到上限时抛出 429；此前已占用的名额保留为失败记录。
 */
export async function reserveAttempts(db: D1Database, rules: readonly RateLimitRule[], now: number): Promise<number[]> {
  const statements: D1PreparedStatement[] = [];
  for (const rule of rules) {
    const windowMs = rule.windowMs ?? RATE_LIMIT_WINDOW_MS;
    statements.push(
      db
        .prepare(
          `INSERT INTO login_attempts (scope, identifier, attempted_at)
           SELECT ?1, ?2, ?3
           WHERE (SELECT COUNT(*) FROM login_attempts WHERE scope = ?1 AND identifier = ?2 AND attempted_at > ?4) < ?5`,
        )
        .bind(rule.scope, rule.identifier, now, now - windowMs, rule.limit),
      db.prepare('SELECT last_insert_rowid() AS rowid'),
    );
  }

  const results = await db.batch(statements);
  const rowids: number[] = [];
  for (let index = 0; index < rules.length; index += 1) {
    const accepted = (results[index * 2]?.meta?.changes ?? 0) > 0;
    if (!accepted) {
      const rule = rules[index]!;
      const retryAfter = await retryAfterFor(db, rule, now).catch(() => Math.ceil((rule.windowMs ?? RATE_LIMIT_WINDOW_MS) / 1000));
      throw new HttpError(429, 'rate_limited', '尝试次数过多，请稍后再试', { retryAfterSeconds: Math.max(1, retryAfter) });
    }
    const row = results[index * 2 + 1]?.results?.[0] as { rowid?: number } | undefined;
    rowids.push(typeof row?.rowid === 'number' ? row.rowid : 0);
  }
  return rowids;
}

/**
 * 认证成功后清理占位。
 * `through` 模式删除“本次占位及更早”的记录（清掉旧失败但不影响并发的新失败记录），
 * `self` 模式只删除本次占位（用于不希望清空历史失败的 IP 维度）。
 */
export async function releaseAttempt(
  db: D1Database,
  scope: string,
  identifier: string,
  rowid: number,
  mode: 'through' | 'self',
): Promise<void> {
  if (mode === 'through') {
    await db
      .prepare('DELETE FROM login_attempts WHERE scope = ?1 AND identifier = ?2 AND rowid <= ?3')
      .bind(scope, identifier, rowid)
      .run();
  } else {
    await db.prepare('DELETE FROM login_attempts WHERE scope = ?1 AND identifier = ?2 AND rowid = ?3').bind(scope, identifier, rowid).run();
  }
}

export function clientKey(request: Request): string {
  const forwarded = request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim().slice(0, 64) || 'unknown';
  return 'unknown';
}

export function assertInitSecret(env: Env, provided: string | undefined): void {
  if (!env.INIT_SECRET || env.INIT_SECRET.length < 8) {
    throw new HttpError(500, 'server_misconfigured', '服务端未配置 INIT_SECRET，无法完成初始化');
  }
  if (!provided || !timingSafeEqual(provided, env.INIT_SECRET)) {
    throw new HttpError(403, 'forbidden', '初始化密钥不正确');
  }
}
