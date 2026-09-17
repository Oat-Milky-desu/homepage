import { DEFAULT_SETTINGS } from '../../src/shared/settings';
import { parseObject, str } from '../../src/shared/validate';
import {
  PASSWORD_CHANGE_LIMIT,
  SETUP_IP_LIMIT,
  LOGIN_IP_LIMIT,
  LOGIN_USER_LIMIT,
  assertCsrfToken,
  assertInitSecret,
  buildClearedSessionCookie,
  buildSessionCookie,
  clientKey,
  createSession,
  createSessionValues,
  insertSessionStatement,
  parseCookies,
  pruneAttempts,
  pruneExpiredSessions,
  releaseAttempt,
  requireSession,
  reserveAttempts,
  SESSION_COOKIE,
  touchSession,
} from './auth';
import { DEFAULT_PBKDF2_ITERATIONS } from './env';
import { hashPassword, verifyPassword } from './crypto';
import { JSON_BODY_LIMIT, requireAuth, type Ctx } from './context';
import { HttpError, jsonResponse, readJson } from './http';
import { batchGuard, getRevision, EXISTENCE_GUARD_CONSTRAINT } from './db';
import { validatePassword, validateUsername } from '../../src/shared/policy';

const DUMMY_SALT = 'AAAAAAAAAAAAAAAAAAAAAA';
const DUMMY_DIGEST = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

function dummyHash(iterations: number): string {
  return `pbkdf2-sha256$${iterations}$${DUMMY_SALT}$${DUMMY_DIGEST}`;
}

function iterationsOf(ctx: Ctx): number {
  return ctx.options.pbkdf2Iterations ?? DEFAULT_PBKDF2_ITERATIONS;
}

interface AdminRow {
  id: number;
  username: string;
  password_hash: string;
}

async function adminExists(db: D1Database): Promise<boolean> {
  const row = await db.prepare('SELECT id FROM admin_users WHERE id = 1').first<{ id: number }>();
  return Boolean(row);
}

function isGuardFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(EXISTENCE_GUARD_CONSTRAINT);
}

export async function handleStatus(ctx: Ctx): Promise<Response> {
  const db = ctx.env.DB;
  if (!(await adminExists(db))) {
    // 尚未初始化时只暴露“需要初始化”，不泄露其它信息
    return jsonResponse({ setupRequired: true, authenticated: false });
  }
  const token = parseCookies(ctx.request.headers.get('cookie'))[SESSION_COOKIE];
  if (!token) {
    return jsonResponse({ setupRequired: false, authenticated: false });
  }
  try {
    const auth = await requireSession(db, ctx.request, ctx.now);
    const revision = await getRevision(db);
    return jsonResponse({
      setupRequired: false,
      authenticated: true,
      user: { username: auth.username },
      csrfToken: auth.session.csrfToken,
      revision,
    });
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) {
      return jsonResponse(
        { setupRequired: false, authenticated: false },
        200,
        { 'Set-Cookie': buildClearedSessionCookie(ctx.secureCookie) },
      );
    }
    throw error;
  }
}

const setupShape = {
  initSecret: str({ min: 1, max: 300, label: '初始化密钥' }),
  username: str({ min: 1, max: 64, label: '用户名' }),
  password: str({ min: 1, max: 300, trim: false, label: '密码' }),
};

export async function handleSetup(ctx: Ctx): Promise<Response> {
  const db = ctx.env.DB;
  const body = await readJson(ctx.request, JSON_BODY_LIMIT);
  const input = parseObject(setupShape, body);
  const ip = clientKey(ctx.request);
  await pruneAttempts(db, ctx.now);

  if (await adminExists(db)) {
    throw new HttpError(409, 'already_setup', '站点已完成初始化，无法重复执行');
  }

  // 先原子占用一次尝试名额，再校验密钥：并发请求无法绕过限流阈值
  const [reservationRowid] = await reserveAttempts(db, [{ scope: 'setup', identifier: ip, limit: SETUP_IP_LIMIT }], ctx.now);

  const issues = [];
  const usernameError = validateUsername(input.username);
  if (usernameError) issues.push({ path: 'username', message: usernameError });
  const passwordError = validatePassword(input.password, input.username);
  if (passwordError) issues.push({ path: 'password', message: passwordError });
  if (issues.length > 0) {
    throw new HttpError(400, 'validation_error', '初始化信息不符合要求', { issues });
  }

  assertInitSecret(ctx.env, input.initSecret);

  const passwordHash = await hashPassword(input.password, iterationsOf(ctx));
  try {
    // 原子初始化：主键约束保证并发下只有一次成功
    await db.batch([
      db
        .prepare('INSERT INTO admin_users (id, username, password_hash, created_at, updated_at) VALUES (1, ?1, ?2, ?3, ?3)')
        .bind(input.username, passwordHash, ctx.nowIso),
      db
        .prepare(
          'INSERT INTO settings (id, settings_json, updated_at) SELECT 1, ?1, ?2 WHERE NOT EXISTS (SELECT 1 FROM settings WHERE id = 1)',
        )
        .bind(JSON.stringify(DEFAULT_SETTINGS), ctx.nowIso),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/UNIQUE|PRIMARY KEY|CONSTRAINT/i.test(message)) {
      throw new HttpError(409, 'already_setup', '站点已完成初始化，无法重复执行');
    }
    throw error;
  }

  const session = await createSession(db, 1, ctx.now);
  await releaseAttempt(db, 'setup', ip, reservationRowid, 'through').catch(() => undefined);
  const revision = await getRevision(db);
  return jsonResponse(
    {
      setupRequired: false,
      authenticated: true,
      user: { username: input.username },
      csrfToken: session.csrfToken,
      revision,
    },
    201,
    { 'Set-Cookie': buildSessionCookie(session.token, session.expiresAt, ctx.secureCookie, ctx.now) },
  );
}

const loginShape = {
  username: str({ min: 1, max: 64, label: '用户名' }),
  password: str({ min: 1, max: 300, trim: false, label: '密码' }),
};

export async function handleLogin(ctx: Ctx): Promise<Response> {
  const db = ctx.env.DB;
  const body = await readJson(ctx.request, JSON_BODY_LIMIT);
  const input = parseObject(loginShape, body);
  const ip = clientKey(ctx.request);
  const userKey = input.username.toLowerCase();

  await pruneAttempts(db, ctx.now);

  // 原子占用名额必须发生在密码校验之前：并发请求无法先校验再一起写入，从而绕过阈值
  const [ipRowid, userRowid] = await reserveAttempts(
    db,
    [
      { scope: 'login-ip', identifier: ip, limit: LOGIN_IP_LIMIT },
      { scope: 'login-user', identifier: userKey, limit: LOGIN_USER_LIMIT },
    ],
    ctx.now,
  );

  const admin = await db
    .prepare('SELECT id, username, password_hash FROM admin_users WHERE username = ?1 COLLATE NOCASE')
    .bind(input.username)
    .first<AdminRow>();

  // 用户不存在时仍执行一次同等开销的派生，避免通过响应时间枚举用户名
  const check = await verifyPassword(
    input.password,
    admin?.password_hash ?? dummyHash(iterationsOf(ctx)),
    iterationsOf(ctx),
  );

  if (!admin || !check.ok) {
    // 占位记录保留，作为失败次数
    throw new HttpError(401, 'invalid_credentials', '用户名或密码不正确');
  }

  const session = await createSessionValues(ctx.now);
  const observedHash = admin.password_hash;
  let newHash: string | null = null;
  if (check.needsRehash) {
    newHash = await hashPassword(input.password, iterationsOf(ctx));
  }
  const expectedHash = newHash ?? observedHash;

  const statements: D1PreparedStatement[] = [];
  if (newHash) {
    statements.push(
      db
        .prepare('UPDATE admin_users SET password_hash = ?1, updated_at = ?2 WHERE id = 1 AND password_hash = ?3')
        .bind(newHash, ctx.nowIso, observedHash),
    );
  }
  // 条件会话：密码哈希在批量执行时若已变化（例如另一设备修改了密码），整个事务回滚
  statements.push(
    batchGuard(db, 'login:hash', 'NOT EXISTS (SELECT 1 FROM admin_users WHERE id = 1 AND password_hash = ?2)', [expectedHash]),
    insertSessionStatement(db, admin.id, session, ctx.now),
    db.prepare('DELETE FROM login_attempts WHERE scope = ?1 AND identifier = ?2 AND rowid <= ?3').bind('login-user', userKey, userRowid),
    db.prepare('DELETE FROM login_attempts WHERE scope = ?1 AND identifier = ?2 AND rowid = ?3').bind('login-ip', ip, ipRowid),
  );

  try {
    await db.batch(statements);
  } catch (error) {
    if (isGuardFailure(error)) {
      throw new HttpError(401, 'invalid_credentials', '登录凭据已变更，请重新输入密码');
    }
    throw error;
  }

  await pruneExpiredSessions(db, ctx.now);
  const revision = await getRevision(db);
  return jsonResponse(
    {
      setupRequired: false,
      authenticated: true,
      user: { username: admin.username },
      csrfToken: session.csrfToken,
      revision,
    },
    200,
    { 'Set-Cookie': buildSessionCookie(session.token, session.expiresAt, ctx.secureCookie, ctx.now) },
  );
}

export async function handleLogout(ctx: Ctx): Promise<Response> {
  const auth = requireAuth(ctx);
  await ctx.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?1').bind(auth.session.tokenHash).run();
  return jsonResponse({ ok: true }, 200, { 'Set-Cookie': buildClearedSessionCookie(ctx.secureCookie) });
}

export async function handleActivity(ctx: Ctx): Promise<Response> {
  const auth = requireAuth(ctx);
  await assertCsrfToken(ctx.env.DB, auth, ctx.request, ctx.now);
  const expiresAt = await touchSession(ctx.env.DB, auth, ctx.now);
  return jsonResponse(
    { expiresAt },
    200,
    { 'Set-Cookie': buildSessionCookie(auth.token, expiresAt, ctx.secureCookie, ctx.now) },
  );
}

const passwordShape = {
  currentPassword: str({ min: 1, max: 300, trim: false, label: '当前密码' }),
  newPassword: str({ min: 1, max: 300, trim: false, label: '新密码' }),
};

export async function handlePasswordChange(ctx: Ctx): Promise<Response> {
  const auth = requireAuth(ctx);
  const db = ctx.env.DB;
  await assertCsrfToken(db, auth, ctx.request, ctx.now);
  const body = await readJson(ctx.request, JSON_BODY_LIMIT);
  const input = parseObject(passwordShape, body);

  const [reservationRowid] = await reserveAttempts(
    db,
    [{ scope: 'password', identifier: auth.username, limit: PASSWORD_CHANGE_LIMIT }],
    ctx.now,
  );

  const admin = await db.prepare('SELECT id, username, password_hash FROM admin_users WHERE id = 1').first<AdminRow>();
  if (!admin) throw new HttpError(401, 'unauthorized', '请先登录');

  const check = await verifyPassword(input.currentPassword, admin.password_hash, iterationsOf(ctx));
  if (!check.ok) {
    throw new HttpError(400, 'validation_error', '当前密码不正确', {
      issues: [{ path: 'currentPassword', message: '当前密码不正确' }],
    });
  }

  const policyError = validatePassword(input.newPassword, admin.username);
  if (policyError) {
    throw new HttpError(400, 'validation_error', policyError, { issues: [{ path: 'newPassword', message: policyError }] });
  }
  if (input.newPassword === input.currentPassword) {
    throw new HttpError(400, 'validation_error', '新密码不能与当前密码相同', {
      issues: [{ path: 'newPassword', message: '新密码不能与当前密码相同' }],
    });
  }

  const passwordHash = await hashPassword(input.newPassword, iterationsOf(ctx));
  try {
    // 条件更新：当前会话仍有效且密码哈希未变时才允许修改；
    // 修改成功后撤销包括当前设备在内的全部会话，用户必须重新登录。
    await db.batch([
      batchGuard(db, 'password:session', 'NOT EXISTS (SELECT 1 FROM sessions WHERE token_hash = ?2)', [auth.session.tokenHash]),
      batchGuard(db, 'password:hash', 'NOT EXISTS (SELECT 1 FROM admin_users WHERE id = 1 AND password_hash = ?2)', [admin.password_hash]),
      db.prepare('UPDATE admin_users SET password_hash = ?1, updated_at = ?2 WHERE id = 1').bind(passwordHash, ctx.nowIso),
      db.prepare('DELETE FROM sessions WHERE user_id = 1'),
      db
        .prepare('DELETE FROM login_attempts WHERE scope = ?1 AND identifier = ?2 AND rowid <= ?3')
        .bind('password', auth.username, reservationRowid),
    ]);
  } catch (error) {
    if (isGuardFailure(error)) {
      throw new HttpError(401, 'unauthorized', '登录状态或密码已变化，请重新登录后再试');
    }
    throw error;
  }

  const revision = await getRevision(db);
  return jsonResponse({ revision, sessionsRevoked: true }, 200, { 'Set-Cookie': buildClearedSessionCookie(ctx.secureCookie) });
}
