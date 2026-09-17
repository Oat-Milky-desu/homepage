import { parseSettings, settingsField } from '../../src/shared/settings';
import { validateIconValue } from '../../src/shared/icon-rules';
import { parseObject, str, num, bool, oneOf, httpUrl, list, record, optional } from '../../src/shared/validate';
import { randomId } from '../../src/shared/url';
import { MAX_GROUPS, MAX_LINKS } from '../../src/shared/limits';
import type { NavGroup, NavLink } from '../../src/shared/types';
import {
  assertRevisionCurrent,
  countGroupLinks,
  executeMutation,
  existenceGuard,
  getContent,
  getGroupRow,
  getLinkRow,
  mapGroupRow,
  mapLinkRow,
  nextGroupPosition,
  nextLinkPosition,
  validationGuard,
  type LinkRow,
} from './db';
import { JSON_BODY_LIMIT, requireAuth, type Ctx } from './context';
import { HttpError, jsonResponse, readJson } from './http';
import { chunkJsonItems, updateGroupPositionsFromJson, updateLinkOrderFromJson } from './bulk';

export const ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;

export const idField = str({ min: 1, max: 40, pattern: ID_PATTERN, patternMessage: 'ID 格式不正确', label: 'ID' });
export const revisionField = num({ min: 0, max: Number.MAX_SAFE_INTEGER, integer: true, label: '版本号' });
export const groupNameField = str({ min: 1, max: 60, label: '分组名称' });

export const iconTypeField = oneOf(['auto', 'builtin', 'image', 'favicon'] as const, '图标类型');
export const targetField = oneOf(['_self', '_blank'] as const, '打开方式');

export const linkShape = {
  groupId: idField,
  name: str({ min: 1, max: 120, label: '链接名称' }),
  url: httpUrl({ max: 2048, label: '链接地址' }),
  description: str({ min: 0, max: 500, label: '描述' }),
  iconType: iconTypeField,
  iconValue: str({ min: 0, max: 500, label: '图标值' }),
  target: targetField,
};

export function assertLinkIcon(iconType: NavLink['iconType'], iconValue: string): void {
  const message = validateIconValue(iconType, iconValue);
  if (message) {
    throw new HttpError(400, 'validation_error', message, { issues: [{ path: 'iconValue', message }] });
  }
}

export async function handleGetContent(ctx: Ctx): Promise<Response> {
  requireAuth(ctx);
  const content = await getContent(ctx.env.DB);
  return jsonResponse(content);
}

/* --------------------------------- 分组 --------------------------------- */

export async function handleCreateGroup(ctx: Ctx): Promise<Response> {
  requireAuth(ctx);
  const body = await readJson(ctx.request, JSON_BODY_LIMIT);
  const input = parseObject({ revision: revisionField, name: groupNameField }, body);
  const db = ctx.env.DB;
  const id = randomId('g_');
  const position = await nextGroupPosition(db);
  const revision = await executeMutation(
    db,
    input.revision,
    [
      validationGuard(db, '(SELECT COUNT(*) FROM groups) >= ?1', [MAX_GROUPS]),
      db
        .prepare('INSERT INTO groups (id, name, position, collapsed, created_at, updated_at) VALUES (?1, ?2, ?3, 0, ?4, ?4)')
        .bind(id, input.name, position, ctx.nowIso),
    ],
    ctx.nowIso,
    { validationMessage: `分组数量已达到上限（${MAX_GROUPS}），请先删除或合并分组` },
  );
  const group: NavGroup = {
    id,
    name: input.name,
    position,
    collapsed: false,
    createdAt: ctx.nowIso,
    updatedAt: ctx.nowIso,
    links: [],
  };
  return jsonResponse({ revision, group }, 201);
}

export async function handleUpdateGroup(ctx: Ctx): Promise<Response> {
  requireAuth(ctx);
  const db = ctx.env.DB;
  const id = ctx.params.id ?? '';
  const body = await readJson(ctx.request, JSON_BODY_LIMIT);
  const input = parseObject(
    {
      revision: revisionField,
      name: optional(groupNameField),
      collapsed: optional(bool('折叠状态')),
    },
    body,
  );
  if (input.name === undefined && input.collapsed === undefined) {
    throw new HttpError(400, 'validation_error', '没有需要更新的字段');
  }
  const existing = await getGroupRow(db, id);
  if (!existing) throw new HttpError(404, 'not_found', '分组不存在或已被删除');

  const sets: string[] = [];
  const values: unknown[] = [];
  if (input.name !== undefined) {
    values.push(input.name);
    sets.push(`name = ?${values.length}`);
  }
  if (input.collapsed !== undefined) {
    values.push(input.collapsed ? 1 : 0);
    sets.push(`collapsed = ?${values.length}`);
  }
  values.push(ctx.nowIso);
  sets.push(`updated_at = ?${values.length}`);
  values.push(id);

  const revision = await executeMutation(
    db,
    input.revision,
    [
      existenceGuard(db, 'groups', id),
      db.prepare(`UPDATE groups SET ${sets.join(', ')} WHERE id = ?${values.length}`).bind(...values),
    ],
    ctx.nowIso,
  );
  const updated = (await getGroupRow(db, id)) ?? existing;
  const group: NavGroup = { ...mapGroupRow(updated), links: [] };
  return jsonResponse({ revision, group });
}

const deleteShape = {
  revision: revisionField,
  mode: optional(oneOf(['migrate', 'cascade'] as const, '删除方式')),
  targetGroupId: optional(idField),
  confirm: optional(bool('确认标记')),
};

export async function handleDeleteGroup(ctx: Ctx): Promise<Response> {
  requireAuth(ctx);
  const db = ctx.env.DB;
  const id = ctx.params.id ?? '';
  const body = await readJson(ctx.request, JSON_BODY_LIMIT);
  const input = parseObject(deleteShape, body);
  const group = await getGroupRow(db, id);
  if (!group) throw new HttpError(404, 'not_found', '分组不存在或已被删除');

  const linkCount = await countGroupLinks(db, id);
  const statements: D1PreparedStatement[] = [];

  if (linkCount > 0) {
    if (input.mode === 'migrate') {
      if (!input.targetGroupId) {
        throw new HttpError(400, 'validation_error', '请选择迁移目标分组', {
          issues: [{ path: 'targetGroupId', message: '请选择迁移目标分组' }],
        });
      }
      if (input.targetGroupId === id) {
        throw new HttpError(400, 'validation_error', '迁移目标不能是当前分组', {
          issues: [{ path: 'targetGroupId', message: '迁移目标不能是当前分组' }],
        });
      }
      const target = await getGroupRow(db, input.targetGroupId);
      if (!target) {
        throw new HttpError(400, 'validation_error', '迁移目标分组不存在', {
          issues: [{ path: 'targetGroupId', message: '迁移目标分组不存在' }],
        });
      }
      const offset = await nextLinkPosition(db, target.id);
      statements.push(
        db
          .prepare('UPDATE links SET group_id = ?1, position = position + ?2, updated_at = ?3 WHERE group_id = ?4')
          .bind(target.id, offset, ctx.nowIso, id),
      );
    } else if (input.mode === 'cascade') {
      if (input.confirm !== true) {
        throw new HttpError(409, 'group_not_empty', '分组内仍有链接，请确认级联删除或选择迁移目标');
      }
      statements.push(db.prepare('DELETE FROM links WHERE group_id = ?1').bind(id));
    } else {
      throw new HttpError(409, 'group_not_empty', '分组内仍有链接，请确认级联删除或选择迁移目标');
    }
  }

  statements.push(existenceGuard(db, 'groups', id));
  statements.push(db.prepare('DELETE FROM groups WHERE id = ?1').bind(id));
  const revision = await executeMutation(db, input.revision, statements, ctx.nowIso);
  return jsonResponse({
    revision,
    deletedGroupId: id,
    migratedTo: input.mode === 'migrate' ? (input.targetGroupId ?? null) : null,
  });
}

const orderShape = {
  revision: revisionField,
  groups: list(idField, { max: MAX_GROUPS, label: '分组顺序' }),
  links: record(list(idField, { max: MAX_LINKS, label: '链接顺序' }), { maxKeys: MAX_GROUPS, label: '链接顺序' }),
};

interface GroupOrderItem {
  id: string;
  position: number;
}

interface LinkOrderItem {
  id: string;
  groupId: string;
  position: number;
}

export async function handleReorder(ctx: Ctx): Promise<Response> {
  requireAuth(ctx);
  const db = ctx.env.DB;
  const body = await readJson(ctx.request, JSON_BODY_LIMIT);
  const input = parseObject(orderShape, body);

  const groupRows = await db.prepare('SELECT id, position FROM groups').all<{ id: string; position: number }>();
  const knownGroupIds = new Set((groupRows.results ?? []).map((row) => row.id));
  assertGroupOrder(input.groups, knownGroupIds);
  assertGroupKeys(Object.keys(input.links), knownGroupIds);

  const linkRows = await db
    .prepare('SELECT id, group_id, position FROM links')
    .all<Pick<LinkRow, 'id' | 'group_id' | 'position'>>();
  const currentLinks = new Map((linkRows.results ?? []).map((row) => [row.id, row]));
  assertLinkOrder(input.links, new Set(currentLinks.keys()), knownGroupIds);

  const groupItems: GroupOrderItem[] = input.groups.map((id, position) => ({ id, position }));
  const linkItems: LinkOrderItem[] = [];
  for (const [groupId, ids] of Object.entries(input.links)) {
    ids.forEach((linkId, position) => linkItems.push({ id: linkId, groupId, position }));
  }

  const currentGroupPositions = new Map((groupRows.results ?? []).map((row) => [row.id, row.position]));
  const groupChanged = groupItems.some((item) => currentGroupPositions.get(item.id) !== item.position);
  const linkChanged = linkItems.some((item) => {
    const current = currentLinks.get(item.id);
    return !current || current.group_id !== item.groupId || current.position !== item.position;
  });

  if (!groupChanged && !linkChanged) {
    // 无实际变更时也必须校验版本号：陈旧版本仍返回 409，但不递增版本
    await assertRevisionCurrent(db, input.revision);
    return jsonResponse({ revision: input.revision });
  }

  const statements: D1PreparedStatement[] = [];
  if (groupChanged) {
    for (const chunk of chunkJsonItems(groupItems)) statements.push(updateGroupPositionsFromJson(db, chunk.json));
  }
  if (linkChanged) {
    for (const chunk of chunkJsonItems(linkItems)) statements.push(updateLinkOrderFromJson(db, chunk.json, ctx.nowIso));
  }
  const revision = await executeMutation(db, input.revision, statements, ctx.nowIso);
  return jsonResponse({ revision });
}

function assertGroupOrder(ids: string[], current: Set<string>): void {
  const provided = new Set(ids);
  const valid = current.size === ids.length && provided.size === ids.length && ids.every((id) => current.has(id));
  if (!valid) throw new HttpError(400, 'validation_error', '分组顺序不是当前分组的完整排列');
}

/** 链接顺序的键必须与分组集合完全一致，不能多也不能少 */
function assertGroupKeys(keys: string[], current: Set<string>): void {
  const provided = new Set(keys);
  const valid = current.size === keys.length && provided.size === keys.length && keys.every((id) => current.has(id));
  if (!valid) throw new HttpError(400, 'validation_error', '链接顺序的分组键与当前分组不一致');
}

/**
 * 链接顺序为完整快照：所有链接必须恰好出现一次，且只能引用已提交的分组。
 */
function assertLinkOrder(orders: Record<string, string[]>, current: Set<string>, knownGroups: Set<string>): void {
  const provided = Object.values(orders).flat();
  const unique = new Set(provided);
  const valid =
    provided.length === current.size && unique.size === provided.length && provided.every((id) => current.has(id));
  if (!valid) throw new HttpError(400, 'validation_error', '链接顺序不是当前链接的完整排列');
  for (const groupId of Object.keys(orders)) {
    if (!knownGroups.has(groupId)) {
      throw new HttpError(400, 'validation_error', `链接顺序引用了不存在的分组：${groupId}`);
    }
  }
}

/* --------------------------------- 链接 --------------------------------- */

export async function handleCreateLink(ctx: Ctx): Promise<Response> {
  requireAuth(ctx);
  const db = ctx.env.DB;
  const body = await readJson(ctx.request, JSON_BODY_LIMIT);
  const input = parseObject(
    {
      revision: revisionField,
      groupId: linkShape.groupId,
      name: linkShape.name,
      url: linkShape.url,
      description: linkShape.description.withDefault(''),
      iconType: linkShape.iconType.withDefault('auto'),
      iconValue: linkShape.iconValue.withDefault(''),
      target: linkShape.target.withDefault('_blank'),
    },
    body,
  );
  const group = await getGroupRow(db, input.groupId);
  if (!group) {
    throw new HttpError(400, 'validation_error', '分组不存在', { issues: [{ path: 'groupId', message: '分组不存在' }] });
  }
  assertLinkIcon(input.iconType, input.iconValue);
  const id = randomId('l_');
  const position = await nextLinkPosition(db, input.groupId);
  const revision = await executeMutation(
    db,
    input.revision,
    [
      validationGuard(db, '(SELECT COUNT(*) FROM links) >= ?1', [MAX_LINKS]),
      db
        .prepare(
          'INSERT INTO links (id, group_id, name, url, description, icon_type, icon_value, target, position, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)',
        )
        .bind(
          id,
          input.groupId,
          input.name,
          input.url,
          input.description,
          input.iconType,
          input.iconValue,
          input.target,
          position,
          ctx.nowIso,
        ),
    ],
    ctx.nowIso,
    { validationMessage: `链接数量已达到上限（${MAX_LINKS}）` },
  );
  const link: NavLink = {
    id,
    groupId: input.groupId,
    name: input.name,
    url: input.url,
    description: input.description,
    iconType: input.iconType,
    iconValue: input.iconValue,
    target: input.target,
    position,
    createdAt: ctx.nowIso,
    updatedAt: ctx.nowIso,
  };
  return jsonResponse({ revision, link }, 201);
}

export async function handleUpdateLink(ctx: Ctx): Promise<Response> {
  requireAuth(ctx);
  const db = ctx.env.DB;
  const id = ctx.params.id ?? '';
  const body = await readJson(ctx.request, JSON_BODY_LIMIT);
  const input = parseObject(
    {
      revision: revisionField,
      groupId: optional(linkShape.groupId),
      name: optional(linkShape.name),
      url: optional(linkShape.url),
      description: optional(linkShape.description),
      iconType: optional(linkShape.iconType),
      iconValue: optional(linkShape.iconValue),
      target: optional(linkShape.target),
    },
    body,
  );
  const existing = await getLinkRow(db, id);
  if (!existing) throw new HttpError(404, 'not_found', '链接不存在或已被删除');

  if (input.groupId && input.groupId !== existing.group_id) {
    const group = await getGroupRow(db, input.groupId);
    if (!group) {
      throw new HttpError(400, 'validation_error', '目标分组不存在', {
        issues: [{ path: 'groupId', message: '目标分组不存在' }],
      });
    }
  }
  const nextIconType = (input.iconType ?? existing.icon_type) as NavLink['iconType'];
  const nextIconValue = input.iconValue ?? existing.icon_value;
  assertLinkIcon(nextIconType, nextIconValue);

  const sets: string[] = [];
  const values: unknown[] = [];
  const push = (column: string, value: unknown) => {
    values.push(value);
    sets.push(`${column} = ?${values.length}`);
  };
  if (input.groupId !== undefined) push('group_id', input.groupId);
  if (input.name !== undefined) push('name', input.name);
  if (input.url !== undefined) push('url', input.url);
  if (input.description !== undefined) push('description', input.description);
  if (input.iconType !== undefined) push('icon_type', input.iconType);
  if (input.iconValue !== undefined) push('icon_value', input.iconValue);
  if (input.target !== undefined) push('target', input.target);
  if (input.groupId !== undefined && input.groupId !== existing.group_id) {
    push('position', await nextLinkPosition(db, input.groupId));
  }
  if (sets.length === 0) throw new HttpError(400, 'validation_error', '没有需要更新的字段');
  values.push(ctx.nowIso);
  sets.push(`updated_at = ?${values.length}`);
  values.push(id);

  const revision = await executeMutation(
    db,
    input.revision,
    [
      existenceGuard(db, 'links', id),
      db.prepare(`UPDATE links SET ${sets.join(', ')} WHERE id = ?${values.length}`).bind(...values),
    ],
    ctx.nowIso,
  );
  const updated = (await getLinkRow(db, id)) ?? existing;
  return jsonResponse({ revision, link: mapLinkRow(updated) });
}

export async function handleDeleteLink(ctx: Ctx): Promise<Response> {
  requireAuth(ctx);
  const db = ctx.env.DB;
  const id = ctx.params.id ?? '';
  const body = await readJson(ctx.request, JSON_BODY_LIMIT);
  const input = parseObject({ revision: revisionField }, body);
  const existing = await getLinkRow(db, id);
  if (!existing) throw new HttpError(404, 'not_found', '链接不存在或已被删除');
  const revision = await executeMutation(
    db,
    input.revision,
    [existenceGuard(db, 'links', id), db.prepare('DELETE FROM links WHERE id = ?1').bind(id)],
    ctx.nowIso,
  );
  return jsonResponse({ revision, deletedLinkId: id });
}

/* --------------------------------- 设置 --------------------------------- */

export async function handleUpdateSettings(ctx: Ctx): Promise<Response> {
  requireAuth(ctx);
  const db = ctx.env.DB;
  const body = await readJson(ctx.request, JSON_BODY_LIMIT);
  const input = parseObject({ revision: revisionField, settings: settingsField }, body);
  const settings = parseSettings(input.settings);
  const revision = await executeMutation(
    db,
    input.revision,
    [
      db
        .prepare(
          `INSERT INTO settings (id, settings_json, updated_at) VALUES (1, ?1, ?2)
           ON CONFLICT(id) DO UPDATE SET settings_json = excluded.settings_json, updated_at = excluded.updated_at`,
        )
        .bind(JSON.stringify(settings), ctx.nowIso),
    ],
    ctx.nowIso,
  );
  return jsonResponse({ revision, settings });
}

