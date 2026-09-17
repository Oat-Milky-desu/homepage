import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { createHarness, resetDatabase, seedAdmin, TEST_USERNAME } from './helpers';
import type { BackupFile, ContentPayload, ImportResult } from '../../src/shared/types';
import type { Harness } from './helpers';

async function authedHarness(): Promise<Harness> {
  await resetDatabase();
  await seedAdmin();
  const harness = createHarness();
  await harness.expectOk(await harness.login());
  return harness;
}

async function seedContent(harness: Harness): Promise<{ groupId: string; linkId: string }> {
  const group = await harness.createGroup('工作');
  const link = await harness.createLink(group.id, { name: 'GitHub', url: 'https://github.com', description: '代码' });
  const other = await harness.createGroup('生活');
  await harness.createLink(other.id, { name: '豆瓣', url: 'https://douban.com' });
  const content = await harness.getContent();
  await harness.expectOk(
    await harness.call('/api/settings', {
      method: 'PUT',
      body: { revision: content.revision, settings: { ...content.settings, siteTitle: '测试站点' } },
    }),
  );
  return { groupId: group.id, linkId: link.id };
}

describe('备份、恢复与书签导入', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('导出备份包含全部内容但不包含任何认证机密', async () => {
    const harness = await authedHarness();
    const { groupId, linkId } = await seedContent(harness);

    const response = await harness.call('/api/backup');
    expect(response.status).toBe(200);
    const backup = await harness.json<BackupFile>(response);
    expect(backup.format).toBe('xingyu-nav-backup');
    expect(backup.version).toBe(1);
    expect(backup.groups).toHaveLength(2);
    expect(backup.links).toHaveLength(2);
    expect(backup.groups.map((group) => group.id)).toContain(groupId);
    expect(backup.links.map((link) => link.id)).toContain(linkId);
    expect(backup.settings.siteTitle).toBe('测试站点');

    const serialized = JSON.stringify(backup);
    expect(serialized).not.toContain('password');
    expect(serialized).not.toContain('token');
    expect(serialized).not.toContain('csrf');
    expect(serialized).not.toContain(TEST_USERNAME);
    expect(backup).not.toHaveProperty('sessions');
  });

  it('备份内容可以原子恢复，版本号继续保持递增', async () => {
    const harness = await authedHarness();
    await seedContent(harness);
    const backup = await harness.json<BackupFile>(await harness.call('/api/backup'));

    // 破坏现场
    let content = await harness.getContent();
    const firstLink = content.groups[0]!.links[0]!;
    await harness.expectOk(
      await harness.call(`/api/links/${firstLink.id}`, { method: 'DELETE', body: { revision: content.revision } }),
    );
    content = await harness.getContent();
    await harness.expectOk(
      await harness.call('/api/settings', {
        method: 'PUT',
        body: { revision: content.revision, settings: { ...content.settings, siteTitle: '被改坏的标题' } },
      }),
    );

    content = await harness.getContent();
    const restore = await harness.call('/api/restore', {
      body: { revision: content.revision, backup },
    });
    expect(restore.status).toBe(200);
    const restored = await harness.expectOk<{ revision: number; groups: number; links: number }>(restore);
    expect(restored.revision).toBe(content.revision + 1);

    const after: ContentPayload = await harness.getContent();
    expect(after.revision).toBe(content.revision + 1);
    expect(after.settings.siteTitle).toBe('测试站点');
    const groupNames = after.groups.map((group) => group.name);
    expect(groupNames).toEqual(backup.groups.map((group) => group.name));
    expect(after.groups.flatMap((group) => group.links.map((link) => link.id)).sort()).toEqual(
      backup.links.map((link) => link.id).sort(),
    );
  });

  it('非法备份被拒绝且不会破坏现有数据', async () => {
    const harness = await authedHarness();
    await seedContent(harness);
    const backup = await harness.json<BackupFile>(await harness.call('/api/backup'));
    const before = await harness.getContent();
    const countBefore = await env.DB.prepare('SELECT COUNT(*) AS count FROM links').first<{ count: number }>();

    const cases: { name: string; mutate: (file: BackupFile) => unknown }[] = [
      { name: '格式错误', mutate: (file) => ({ ...file, format: 'other' }) },
      { name: '版本过高', mutate: (file) => ({ ...file, version: 99 }) },
      {
        name: '悬空分组引用',
        mutate: (file) => ({
          ...file,
          links: file.links.map((link) => ({ ...link, groupId: 'g_missing' })),
        }),
      },
      {
        name: '重复 ID',
        mutate: (file) => ({ ...file, links: [file.links[0], file.links[0]] }),
      },
      {
        name: '危险协议',
        mutate: (file) => ({
          ...file,
          links: file.links.map((link) => ({ ...link, url: 'javascript:alert(1)' })),
        }),
      },
      {
        name: '未知字段',
        mutate: (file) => ({ ...file, injected: true }),
      },
    ];

    for (const testCase of cases) {
      const response = await harness.call('/api/restore', {
        body: { revision: before.revision, backup: testCase.mutate(backup) },
      });
      expect(response.status, testCase.name).toBe(400);
    }

    const stale = await harness.call('/api/restore', { body: { revision: before.revision - 1, backup } });
    expect(stale.status).toBe(409);

    const after = await env.DB.prepare('SELECT COUNT(*) AS count FROM links').first<{ count: number }>();
    expect(after?.count).toBe(countBefore?.count);
    const content = await harness.getContent();
    expect(content.revision).toBe(before.revision);
    expect(content.settings.siteTitle).toBe('测试站点');
  });

  it('恢复请求体积超限时返回 413', async () => {
    const harness = await authedHarness();
    const content = await harness.getContent();
    const huge = {
      revision: content.revision,
      backup: { format: 'xingyu-nav-backup', version: 1, blob: 'x'.repeat(21 * 1024 * 1024) },
    };
    const response = await harness.call('/api/restore', { body: huge });
    expect(response.status).toBe(413);
  });

  it('书签导入创建分组、跳过重复链接并返回统计', async () => {
    const harness = await authedHarness();
    const existingGroup = await harness.createGroup('已有分组');
    await harness.createLink(existingGroup.id, { name: '已有', url: 'https://existing.example.com' });

    const content = await harness.getContent();
    const response = await harness.call('/api/import', {
      body: {
        revision: content.revision,
        groups: [
          {
            name: '导入一',
            links: [
              { name: '新站点', url: 'https://new.example.com' },
              { name: '重复站点', url: 'https://existing.example.com' },
              { name: '同址重复', url: 'https://new.example.com/' },
            ],
          },
          { name: '导入二', links: [{ name: '另一个', url: 'https://another.example.com', description: '说明' }] },
          { name: '空分组', links: [] },
        ],
      },
    });
    expect(response.status).toBe(200);
    const result = await harness.expectOk<ImportResult>(response);
    expect(result.createdGroups).toBe(2);
    expect(result.createdLinks).toBe(2);
    expect(result.skipped.filter((item) => item.reason === 'duplicate')).toHaveLength(2);
    expect(result.revision).toBe(content.revision + 1);

    const after = await harness.getContent();
    expect(after.groups.map((group) => group.name)).toEqual(['已有分组', '导入一', '导入二']);
    const imported = after.groups.find((group) => group.name === '导入一')!;
    expect(imported.links.map((link) => link.name)).toEqual(['新站点']);
    expect(imported.links[0]!.url).toBe('https://new.example.com');
    expect(after.groups.find((group) => group.name === '导入二')!.links[0]!.description).toBe('说明');
  });

  it('导入可关闭去重并支持跳过非法图标', async () => {
    const harness = await authedHarness();
    const existingGroup = await harness.createGroup('已有');
    await harness.createLink(existingGroup.id, { name: '已有', url: 'https://dup.example.com' });

    const content = await harness.getContent();
    const response = await harness.call('/api/import', {
      body: {
        revision: content.revision,
        skipDuplicateUrls: false,
        groups: [
          {
            name: '全部导入',
            links: [
              { name: '重复', url: 'https://dup.example.com' },
              { name: '坏图标', url: 'https://icon.example.com', iconType: 'builtin', iconValue: 'nope' },
              { name: '正常', url: 'https://ok.example.com', iconType: 'builtin', iconValue: 'star' },
            ],
          },
        ],
      },
    });
    expect(response.status).toBe(200);
    const result = await harness.expectOk<ImportResult>(response);
    expect(result.skipped).toEqual([{ url: 'https://icon.example.com', name: '坏图标', reason: 'invalid' }]);
    expect(result.createdLinks).toBe(2);
  });

  it('导入空列表不会改变版本号', async () => {
    const harness = await authedHarness();
    const content = await harness.getContent();
    const response = await harness.call('/api/import', { body: { revision: content.revision, groups: [] } });
    expect(response.status).toBe(200);
    const result = await harness.expectOk<ImportResult>(response);
    expect(result.revision).toBe(content.revision);
    expect(result.createdGroups).toBe(0);
  });

  it('导入使用陈旧版本号会被拒绝', async () => {
    const harness = await authedHarness();
    const group = await harness.createGroup('A');
    const content = await harness.getContent();
    await harness.createLink(group.id, { name: 'x', url: 'https://x.example.com' });

    const stale = await harness.call('/api/import', {
      body: { revision: content.revision, groups: [{ name: '导入', links: [{ name: 'y', url: 'https://y.example.com' }] }] },
    });
    expect(stale.status).toBe(409);
    const after = await harness.getContent();
    expect(after.groups).toHaveLength(1);
  });
});
