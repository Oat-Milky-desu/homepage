import type { AppSettings, ContentPayload, NavGroup, NavLink } from '../../src/shared/types';
import { coerceSettings } from '../../src/shared/settings';
import { CONTENT_SERIALIZED_BUDGET_BYTES } from '../../src/shared/limits';
import { HttpError } from './http';

export interface GroupRow {
  id: string;
  name: string;
  position: number;
  collapsed: number;
  created_at: string;
  updated_at: string;
}

export interface LinkRow {
  id: string;
  group_id: string;
  name: string;
  url: string;
  description: string;
  icon_type: string;
  icon_value: string;
  target: string;
  position: number;
  created_at: string;
  updated_at: string;
}

export const REVISION_GUARD_TABLE = 'revision_guard';
export const EXISTENCE_GUARD_TABLE = 'existence_guard';
export const VALIDATION_GUARD_TABLE = 'validation_guard';
export const CONTENT_BUDGET_GUARD_TABLE = 'content_budget_guard';
export const REVISION_GUARD_CONSTRAINT = 'guard_revision';
export const EXISTENCE_GUARD_CONSTRAINT = 'guard_existence';
export const VALIDATION_GUARD_CONSTRAINT = 'guard_validation';
export const CONTENT_BUDGET_GUARD_CONSTRAINT = 'guard_content_budget';

function contentBudgetMiB(): number {
  return Math.round(CONTENT_SERIALIZED_BUDGET_BYTES / (1024 * 1024));
}

export const CONTENT_BUDGET_MESSAGE = `内容总量超过上限（${contentBudgetMiB()} MiB），请先删减分组、链接或缩短名称 / 描述 / 地址后重试`;

export function mapGroupRow(row: GroupRow): Omit<NavGroup, 'links'> {
  return {
    id: row.id,
    name: row.name,
    position: row.position,
    collapsed: row.collapsed === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapLinkRow(row: LinkRow): NavLink {
  return {
    id: row.id,
    groupId: row.group_id,
    name: row.name,
    url: row.url,
    description: row.description,
    iconType: row.icon_type as NavLink['iconType'],
    iconValue: row.icon_value,
    target: row.target as NavLink['target'],
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getRevision(db: D1Database): Promise<number> {
  const row = await db.prepare('SELECT revision FROM app_meta WHERE id = 1').first<{ revision: number }>();
  return row?.revision ?? 0;
}

/**
 * 乐观并发控制的核心：在事务内断言版本号，不匹配时通过 CHECK 约束触发回滚。
 * 该语句必须与真正的写操作处于同一个 db.batch() 中。
 */
export function revisionGuard(db: D1Database, expectedRevision: number): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO ${REVISION_GUARD_TABLE} (id, expected_revision)
       SELECT 1, ?1 WHERE (SELECT revision FROM app_meta WHERE id = 1) <> ?1`,
    )
    .bind(expectedRevision);
}

/** 事务内断言目标行存在，防止并发删除后出现静默更新 */
export function existenceGuard(db: D1Database, table: 'groups' | 'links', id: string): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO ${EXISTENCE_GUARD_TABLE} (id, note)
       SELECT 1, ?1 WHERE NOT EXISTS (SELECT 1 FROM ${table} WHERE id = ?2)`,
    )
    .bind(`${table}:${id}`, id);
}

/**
 * 通用事务守卫：当 conditionSql 为真时插入守卫表，触发 CHECK 约束让整个事务回滚。
 * conditionSql 中的参数占位符从 ?2 开始（?1 固定为 note）。
 */
export function batchGuard(db: D1Database, note: string, conditionSql: string, binds: unknown[]): D1PreparedStatement {
  return db.prepare(`INSERT INTO ${EXISTENCE_GUARD_TABLE} (id, note) SELECT 1, ?1 WHERE ${conditionSql}`).bind(note, ...binds);
}

/**
 * 业务规则守卫：conditionSql 为真时插入 validation_guard，触发 CHECK 约束回滚整个事务。
 * 参数占位符从 ?1 开始。
 */
export function validationGuard(db: D1Database, conditionSql: string, binds: unknown[]): D1PreparedStatement {
  return db.prepare(`INSERT INTO ${VALIDATION_GUARD_TABLE} (id, note) SELECT 1, '' WHERE ${conditionSql}`).bind(...binds);
}

/**
 * 内容体积守卫条件：分组 + 链接 + 设置的紧凑 JSON 字节数，外加数组分隔符、
 * 顶层包装字段与环境余量。字段名与备份导出完全一致，保证“能写入的内容一定能
 * 被导出并再次恢复”；SUM 按行计算 json_object，不会受单条 SQL 绑定体积影响。
 */
const CONTENT_BUDGET_CONDITION = `(
  (SELECT COALESCE(SUM(length(CAST(json_object(
    'id', id, 'name', name, 'position', position, 'collapsed', collapsed,
    'createdAt', created_at, 'updatedAt', updated_at
  ) AS BLOB))), 0) FROM groups)
  + (SELECT COALESCE(SUM(length(CAST(json_object(
    'id', id, 'groupId', group_id, 'name', name, 'url', url, 'description', description,
    'iconType', icon_type, 'iconValue', icon_value, 'target', target, 'position', position,
    'createdAt', created_at, 'updatedAt', updated_at
  ) AS BLOB))), 0) FROM links)
  + (SELECT COALESCE(length(CAST(COALESCE((SELECT settings_json FROM settings WHERE id = 1), '{}') AS BLOB)), 0))
  + (SELECT COUNT(*) FROM groups) + (SELECT COUNT(*) FROM links) + 4096
) > ?1`;

/**
 * 事务内内容体积守卫：在写入语句执行之后、版本号递增之前断言总预算，
 * 超限时整个 db.batch() 回滚。executeMutation 会自动把它加入每一批写操作。
 */
export function contentBudgetGuard(db: D1Database): D1PreparedStatement {
  return db
    .prepare(`INSERT INTO ${CONTENT_BUDGET_GUARD_TABLE} (id, note) SELECT 1, '' WHERE ${CONTENT_BUDGET_CONDITION}`)
    .bind(CONTENT_SERIALIZED_BUDGET_BYTES);
}

export function bumpRevisionStatement(db: D1Database, nowIso: string): D1PreparedStatement {
  return db.prepare('UPDATE app_meta SET revision = revision + 1, updated_at = ?1 WHERE id = 1').bind(nowIso);
}

function isGuardFailure(error: unknown, constraint: string): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(constraint);
}

/** 把守卫表触发的回滚转换成对外的结构化错误 */
async function mapGuardedFailure(
  db: D1Database,
  expectedRevision: number,
  error: unknown,
  validationMessage?: string,
): Promise<never> {
  if (isGuardFailure(error, CONTENT_BUDGET_GUARD_CONSTRAINT)) {
    throw new HttpError(400, 'validation_error', CONTENT_BUDGET_MESSAGE);
  }
  if (isGuardFailure(error, VALIDATION_GUARD_CONSTRAINT)) {
    throw new HttpError(400, 'validation_error', validationMessage ?? '操作不符合业务规则');
  }
  if (isGuardFailure(error, EXISTENCE_GUARD_CONSTRAINT)) {
    throw new HttpError(404, 'not_found', '目标不存在或已被删除');
  }
  if (isGuardFailure(error, REVISION_GUARD_CONSTRAINT)) {
    const current = await getRevision(db).catch(() => expectedRevision);
    throw new HttpError(409, 'revision_conflict', '内容已在其他设备更新，请刷新后重试', { revision: current });
  }
  // 兜底：某些运行时的约束错误信息可能不含表名
  const current = await getRevision(db).catch(() => expectedRevision);
  if (current !== expectedRevision) {
    throw new HttpError(409, 'revision_conflict', '内容已在其他设备更新，请刷新后重试', { revision: current });
  }
  throw error;
}

/**
 * 原子执行一组写操作：
 * 1. 版本守卫（版本不一致 → 全部回滚 → 409）
 * 2. 业务语句
 * 3. 内容体积守卫（超预算 → 全部回滚 → 400）
 * 4. 全局版本号 +1
 */
export async function executeMutation(
  db: D1Database,
  expectedRevision: number,
  statements: D1PreparedStatement[],
  nowIso: string,
  options: { validationMessage?: string } = {},
): Promise<number> {
  const batch = [
    revisionGuard(db, expectedRevision),
    ...statements,
    contentBudgetGuard(db),
    bumpRevisionStatement(db, nowIso),
  ];
  try {
    await db.batch(batch);
  } catch (error) {
    await mapGuardedFailure(db, expectedRevision, error, options.validationMessage);
  }
  return expectedRevision + 1;
}

/**
 * 只读版本断言：用于“无实际写入”的操作（例如空导入、原地排序），
 * 仍然拒绝陈旧版本号，但不改变版本号。
 */
export async function assertRevisionCurrent(db: D1Database, expectedRevision: number): Promise<void> {
  try {
    await db.batch([revisionGuard(db, expectedRevision)]);
  } catch (error) {
    await mapGuardedFailure(db, expectedRevision, error);
  }
}

function parseSettingsRow(row: { settings_json: string } | undefined): AppSettings {
  if (!row) return coerceSettings(undefined);
  try {
    return coerceSettings(JSON.parse(row.settings_json) as unknown);
  } catch {
    return coerceSettings(undefined);
  }
}

/**
 * 一次性读取完整内容。使用单个 db.batch() 获得一致性快照：
 * 并发写入不可能让内容、设置与版本号来自不同时间点（备份导出因此也是一致的）。
 */
export async function getContent(db: D1Database): Promise<ContentPayload> {
  const [metaResult, settingsResult, groupResult, linkResult] = await db.batch([
    db.prepare('SELECT revision FROM app_meta WHERE id = 1'),
    db.prepare('SELECT settings_json FROM settings WHERE id = 1'),
    db.prepare('SELECT * FROM groups ORDER BY position ASC, created_at ASC'),
    db.prepare('SELECT * FROM links ORDER BY position ASC, created_at ASC'),
  ]);
  const revision = (metaResult?.results?.[0] as { revision: number } | undefined)?.revision ?? 0;
  const settings = parseSettingsRow(settingsResult?.results?.[0] as { settings_json: string } | undefined);
  const groupRows = (groupResult?.results ?? []) as unknown as GroupRow[];
  const linkRows = (linkResult?.results ?? []) as unknown as LinkRow[];

  const linksByGroup = new Map<string, NavLink[]>();
  for (const row of linkRows) {
    const link = mapLinkRow(row);
    const bucket = linksByGroup.get(link.groupId);
    if (bucket) bucket.push(link);
    else linksByGroup.set(link.groupId, [link]);
  }
  const groups: NavGroup[] = groupRows.map((row) => ({
    ...mapGroupRow(row),
    links: linksByGroup.get(row.id) ?? [],
  }));
  return { revision, settings, groups };
}

export async function getGroupRow(db: D1Database, id: string): Promise<GroupRow | null> {
  return db.prepare('SELECT * FROM groups WHERE id = ?1').bind(id).first<GroupRow>();
}

export async function getLinkRow(db: D1Database, id: string): Promise<LinkRow | null> {
  return db.prepare('SELECT * FROM links WHERE id = ?1').bind(id).first<LinkRow>();
}

export async function nextGroupPosition(db: D1Database): Promise<number> {
  const row = await db.prepare('SELECT COALESCE(MAX(position), -1) AS max_position FROM groups').first<{ max_position: number }>();
  return (row?.max_position ?? -1) + 1;
}

export async function nextLinkPosition(db: D1Database, groupId: string): Promise<number> {
  const row = await db
    .prepare('SELECT COALESCE(MAX(position), -1) AS max_position FROM links WHERE group_id = ?1')
    .bind(groupId)
    .first<{ max_position: number }>();
  return (row?.max_position ?? -1) + 1;
}

export async function countGroupLinks(db: D1Database, groupId: string): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) AS count FROM links WHERE group_id = ?1').bind(groupId).first<{ count: number }>();
  return row?.count ?? 0;
}
