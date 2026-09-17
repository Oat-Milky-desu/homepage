import { beforeEach, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { createHarness, resetDatabase, seedAdmin, type Harness } from './helpers';
import { CONTENT_SERIALIZED_BUDGET_BYTES, EXPORT_PRETTY_OVERHEAD_BYTES, RESTORE_BODY_LIMIT_BYTES } from '../../src/shared/limits';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';
import type { AppSettings, BackupFile, BackupGroup, BackupLink } from '../../src/shared/types';

/**
 * 内容预算与备份往返保证：
 * 这些测试刻意使用多字节 Unicode 字段把内容推到接近 / 超过 10 MiB 预算，
 * 验证「能写入的内容一定能导出并再次恢复」，以及超预算写入的原子回滚。
 */

const encoder = new TextEncoder();
const NOW = '2026-03-01T00:00:00.000Z';

beforeEach(resetDatabase);

async function authed(): Promise<Harness> {
  await seedAdmin();
  const harness = createHarness();
  await harness.expectOk(await harness.login());
  return harness;
}

/** 2048 字符的 http(s) URL，绝大多数为 3 字节 UTF-8 字符 */
function bigUrl(index: number): string {
  const prefix = `https://example.com/${index}/`;
  return prefix + '界'.repeat(2048 - prefix.length);
}

function bigLink(index: number, groupId: string): BackupLink {
  return {
    id: `l_big_${index}`,
    groupId,
    name: '链'.repeat(120),
    url: bigUrl(index),
    description: '述'.repeat(500),
    iconType: 'auto',
    iconValue: '图'.repeat(500),
    target: '_blank',
    position: index,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function backupWith(linkCount: number, settings: AppSettings): BackupFile {
  const group: BackupGroup = { id: 'g_big', name: '大体积分组', position: 0, collapsed: false, createdAt: NOW, updatedAt: NOW };
  return {
    format: 'xingyu-nav-backup',
    version: 1,
    exportedAt: NOW,
    settings,
    groups: [group],
    links: Array.from({ length: linkCount }, (_, index) => bigLink(index, group.id)),
  };
}

function compactSize(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).length;
}

it('接近预算边界的多字节内容可以导出并被再次恢复', async () => {
  const harness = await authed();
  const content = await harness.getContent();
  const backup = backupWith(950, content.settings);
  expect(compactSize(backup)).toBeLessThan(CONTENT_SERIALIZED_BUDGET_BYTES - 64 * 1024);

  const imported = await harness.call('/api/restore', { body: { revision: content.revision, backup } });
  expect(imported.status).toBe(200);

  const exported = await harness.json<BackupFile>(await harness.call('/api/backup'));
  const compact = compactSize(exported);
  // 断言这确实是一份“接近边界”的内容，而不是只测试了很小的数据
  expect(compact).toBeGreaterThan(CONTENT_SERIALIZED_BUDGET_BYTES * 0.8);
  expect(compact).toBeLessThan(CONTENT_SERIALIZED_BUDGET_BYTES);

  // 前端“下载备份”保存的是 2 空格缩进的 pretty JSON，它必须小于恢复请求上限，
  // 用户才能把自己导出的文件重新上传恢复。
  const pretty = encoder.encode(JSON.stringify(exported, null, 2)).length;
  expect(pretty).toBeGreaterThan(compact);
  expect(pretty - compact).toBeLessThan(EXPORT_PRETTY_OVERHEAD_BYTES);
  expect(pretty).toBeLessThan(RESTORE_BODY_LIMIT_BYTES);

  const current = await harness.getContent();
  const relay = await harness.call('/api/restore', { body: { revision: current.revision, backup: exported } });
  expect(relay.status).toBe(200);

  const final = await harness.getContent();
  expect(final.groups).toHaveLength(1);
  expect(final.groups[0]!.links).toHaveLength(950);
  expect(final.groups[0]!.links[0]!.url).toBe(exported.links[0]!.url);
  expect(final.groups[0]!.links[949]!.description).toBe('述'.repeat(500));
  expect(final.groups[0]!.links[949]!.iconValue).toBe('图'.repeat(500));
}, 120_000);

it('超过内容预算的恢复会整批回滚并返回清晰的 400', async () => {
  const harness = await authed();
  const content = await harness.getContent();
  const backup = backupWith(1150, content.settings);
  expect(compactSize(backup)).toBeGreaterThan(CONTENT_SERIALIZED_BUDGET_BYTES);
  expect(compactSize(backup)).toBeLessThan(RESTORE_BODY_LIMIT_BYTES);

  const response = await harness.call('/api/restore', { body: { revision: content.revision, backup } });
  expect(response.status).toBe(400);
  const error = await harness.errorBody(response);
  expect(error.error.code).toBe('validation_error');
  expect(error.error.message).toContain('内容总量超过上限');

  const after = await harness.getContent();
  expect(after.revision).toBe(content.revision);
  expect(after.groups).toHaveLength(0);
  const guardRows = await env.DB.prepare('SELECT COUNT(*) AS count FROM content_budget_guard').first<{ count: number }>();
  expect(guardRows?.count).toBe(0);
  const linkRows = await env.DB.prepare('SELECT COUNT(*) AS count FROM links').first<{ count: number }>();
  expect(linkRows?.count).toBe(0);
}, 120_000);

it('超过内容预算的书签导入被拒绝且不留下任何数据', async () => {
  const harness = await authed();
  const content = await harness.getContent();
  const links = Array.from({ length: 1150 }, (_, index) => ({
    name: '链'.repeat(120),
    url: bigUrl(index),
    description: '述'.repeat(500),
    iconValue: '图'.repeat(500),
  }));
  const response = await harness.call('/api/import', {
    body: { revision: content.revision, groups: [{ name: '导入大体积', links }] },
  });
  expect(response.status).toBe(400);
  const error = await harness.errorBody(response);
  expect(error.error.message).toContain('内容总量超过上限');

  const after = await harness.getContent();
  expect(after.revision).toBe(content.revision);
  expect(after.groups).toHaveLength(0);
}, 120_000);

it('已超预算的数据会阻止设置 / 链接 / 分组写操作，且不会产生部分写入', async () => {
  const harness = await authed();
  const groupId = 'g_seed';
  await env.DB.prepare('INSERT INTO groups (id, name, position, collapsed, created_at, updated_at) VALUES (?1, ?2, 0, 0, ?3, ?3)')
    .bind(groupId, '超预算分组', NOW)
    .run();
  const links = Array.from({ length: 1150 }, (_, index) => bigLink(index, groupId));
  for (let offset = 0; offset < links.length; offset += 200) {
    const chunk = links.slice(offset, offset + 200);
    await env.DB.prepare(
      `INSERT INTO links (id, group_id, name, url, description, icon_type, icon_value, target, position, created_at, updated_at)
       SELECT json_extract(value,'$.id'), json_extract(value,'$.groupId'), json_extract(value,'$.name'),
              json_extract(value,'$.url'), json_extract(value,'$.description'), json_extract(value,'$.iconType'),
              json_extract(value,'$.iconValue'), json_extract(value,'$.target'), json_extract(value,'$.position'),
              json_extract(value,'$.createdAt'), json_extract(value,'$.updatedAt')
       FROM json_each(?1)`,
    )
      .bind(JSON.stringify(chunk))
      .run();
  }

  const settings = await harness.call('/api/settings', {
    method: 'PUT',
    body: { revision: 0, settings: { ...DEFAULT_SETTINGS, siteTitle: '新标题' } },
  });
  expect(settings.status).toBe(400);
  expect((await harness.errorBody(settings)).error.message).toContain('内容总量超过上限');

  const createLink = await harness.call('/api/links', {
    body: { revision: 0, groupId, name: '新链接', url: 'https://new.example.com' },
  });
  expect(createLink.status).toBe(400);

  const updateGroup = await harness.call(`/api/groups/${groupId}`, {
    method: 'PATCH',
    body: { revision: 0, name: '改名' },
  });
  expect(updateGroup.status).toBe(400);

  const row = await env.DB.prepare('SELECT name FROM groups WHERE id = ?1').bind(groupId).first<{ name: string }>();
  expect(row?.name).toBe('超预算分组');
  const settingsRow = await env.DB.prepare('SELECT settings_json FROM settings WHERE id = 1').first<{ settings_json: string }>();
  expect(settingsRow?.settings_json ?? '').not.toContain('新标题');
  // 版本号没有被递增：失败的批次整体回滚
  const meta = await env.DB.prepare('SELECT revision FROM app_meta WHERE id = 1').first<{ revision: number }>();
  expect(meta?.revision).toBe(0);
}, 120_000);

it('超过 10000 的安全整数排序位置可以随备份往返', async () => {
  const harness = await authed();
  const content = await harness.getContent();
  const backup: BackupFile = {
    format: 'xingyu-nav-backup',
    version: 1,
    exportedAt: NOW,
    settings: content.settings,
    groups: [{ id: 'g_pos', name: '大位置分组', position: 123456789, collapsed: false, createdAt: NOW, updatedAt: NOW }],
    links: [
      {
        id: 'l_pos',
        groupId: 'g_pos',
        name: '大位置链接',
        url: 'https://pos.example.com',
        description: '',
        iconType: 'auto',
        iconValue: '',
        target: '_blank',
        position: 987654321,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
  };
  const restore = await harness.call('/api/restore', { body: { revision: content.revision, backup } });
  expect(restore.status).toBe(200);

  const exported = await harness.json<BackupFile>(await harness.call('/api/backup'));
  expect(exported.groups[0]!.position).toBe(123456789);
  expect(exported.links[0]!.position).toBe(987654321);

  const relay = await harness.call('/api/restore', { body: { revision: (await harness.getContent()).revision, backup: exported } });
  expect(relay.status).toBe(200);
});
