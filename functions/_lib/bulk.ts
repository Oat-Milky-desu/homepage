import { JSON_CHUNK_MAX_BYTES, JSON_CHUNK_MAX_ITEMS } from '../../src/shared/limits';

/**
 * Cloudflare D1 限制每次 Worker 调用可执行的查询数量（Free 50 / Paid 1000），
 * 因此所有批量导入 / 恢复 / 排序都通过 `json_each(...)` 在少量语句内完成，
 * 并按体积与条目数分块，避免超出单条语句的绑定参数体积。
 */

const encoder = new TextEncoder();

export interface JsonChunk {
  json: string;
  count: number;
}

export function chunkJsonItems(items: readonly unknown[]): JsonChunk[] {
  const chunks: JsonChunk[] = [];
  let current: unknown[] = [];
  let currentBytes = 2; // "["

  const flush = () => {
    if (current.length === 0) return;
    chunks.push({ json: JSON.stringify(current), count: current.length });
    current = [];
    currentBytes = 2;
  };

  for (const item of items) {
    const size = encoder.encode(JSON.stringify(item)).length + 1;
    if (current.length > 0 && (current.length >= JSON_CHUNK_MAX_ITEMS || currentBytes + size > JSON_CHUNK_MAX_BYTES)) {
      flush();
    }
    current.push(item);
    currentBytes += size;
  }
  flush();
  return chunks;
}

/**
 * 批量插入分组。JSON 项需包含 id/name/position/collapsed/createdAt/updatedAt。
 */
export function insertGroupsFromJson(db: D1Database, json: string): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO groups (id, name, position, collapsed, created_at, updated_at)
       SELECT json_extract(value, '$.id'),
              json_extract(value, '$.name'),
              json_extract(value, '$.position'),
              CASE WHEN json_extract(value, '$.collapsed') THEN 1 ELSE 0 END,
              json_extract(value, '$.createdAt'),
              json_extract(value, '$.updatedAt')
       FROM json_each(?1)`,
    )
    .bind(json);
}

/**
 * 批量插入链接。JSON 项字段与 links 表列一一对应。
 */
export function insertLinksFromJson(db: D1Database, json: string): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO links (id, group_id, name, url, description, icon_type, icon_value, target, position, created_at, updated_at)
       SELECT json_extract(value, '$.id'),
              json_extract(value, '$.groupId'),
              json_extract(value, '$.name'),
              json_extract(value, '$.url'),
              json_extract(value, '$.description'),
              json_extract(value, '$.iconType'),
              json_extract(value, '$.iconValue'),
              json_extract(value, '$.target'),
              json_extract(value, '$.position'),
              json_extract(value, '$.createdAt'),
              json_extract(value, '$.updatedAt')
       FROM json_each(?1)`,
    )
    .bind(json);
}

/**
 * 就地更新分组顺序。JSON 项为 { id, position }。
 */
export function updateGroupPositionsFromJson(db: D1Database, json: string): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE groups AS g
       SET position = json_extract(j.value, '$.position')
       FROM json_each(?1) AS j
       WHERE g.id = json_extract(j.value, '$.id')`,
    )
    .bind(json);
}

/**
 * 就地更新链接所属分组与顺序。JSON 项为 { id, groupId, position }。
 */
export function updateLinkOrderFromJson(db: D1Database, json: string, nowIso: string): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE links AS l
       SET group_id = json_extract(j.value, '$.groupId'),
           position = json_extract(j.value, '$.position'),
           updated_at = ?2
       FROM json_each(?1) AS j
       WHERE l.id = json_extract(j.value, '$.id')`,
    )
    .bind(json, nowIso);
}
