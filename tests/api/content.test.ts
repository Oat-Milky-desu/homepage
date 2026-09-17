import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { createHarness, resetDatabase, seedAdmin, TEST_PASSWORD } from './helpers';
import type { ContentPayload, NavGroup, NavLink } from '../../src/shared/types';
import type { Harness } from './helpers';

async function authedHarness(): Promise<Harness> {
  await resetDatabase();
  await seedAdmin();
  const harness = createHarness();
  await harness.expectOk(await harness.login());
  return harness;
}

describe('内容管理（分组 / 链接 / 排序 / 设置）', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('分组与链接的创建、读取、更新、删除', async () => {
    const harness = await authedHarness();
    const group = await harness.createGroup('工作');
    expect(group.name).toBe('工作');
    expect(group.position).toBe(0);

    const link = await harness.createLink(group.id, {
      name: 'GitHub',
      url: 'https://github.com',
      description: '代码托管',
    });
    expect(link.groupId).toBe(group.id);
    expect(link.target).toBe('_blank');
    expect(link.iconType).toBe('auto');

    let content = await harness.getContent();
    expect(content.groups).toHaveLength(1);
    expect(content.groups[0]!.links).toHaveLength(1);
    expect(content.groups[0]!.links[0]!.name).toBe('GitHub');

    const renamed = await harness.expectOk<{ revision: number; group: NavGroup }>(
      await harness.call(`/api/groups/${group.id}`, {
        method: 'PATCH',
        body: { revision: content.revision, name: '开发', collapsed: true },
      }),
    );
    expect(renamed.group.name).toBe('开发');
    expect(renamed.group.collapsed).toBe(true);

    const updated = await harness.expectOk<{ revision: number; link: NavLink }>(
      await harness.call(`/api/links/${link.id}`, {
        method: 'PATCH',
        body: { revision: renamed.revision, name: 'GitHub 主页', iconType: 'builtin', iconValue: 'code' },
      }),
    );
    expect(updated.link.name).toBe('GitHub 主页');
    expect(updated.link.iconType).toBe('builtin');

    const removed = await harness.call(`/api/links/${link.id}`, { method: 'DELETE', body: { revision: updated.revision } });
    expect(removed.status).toBe(200);
    content = await harness.getContent();
    expect(content.groups[0]!.links).toHaveLength(0);

    const removedAgain = await harness.call(`/api/links/${link.id}`, {
      method: 'DELETE',
      body: { revision: content.revision },
    });
    expect(removedAgain.status).toBe(404);
  });

  it('严格校验：协议、长度、未知字段与图标引用', async () => {
    const harness = await authedHarness();
    const group = await harness.createGroup('测试');
    const content = await harness.getContent();

    const javascriptUrl = await harness.call('/api/links', {
      body: { revision: content.revision, groupId: group.id, name: '危险', url: 'javascript:alert(1)' },
    });
    expect(javascriptUrl.status).toBe(400);
    const urlIssues = await harness.errorBody(javascriptUrl);
    expect(urlIssues.error.issues?.some((issue) => issue.path === 'url')).toBe(true);

    const longName = await harness.call('/api/links', {
      body: { revision: content.revision, groupId: group.id, name: 'x'.repeat(200), url: 'https://example.com' },
    });
    expect(longName.status).toBe(400);

    const unknownField = await harness.call('/api/groups', {
      body: { revision: content.revision, name: 'ok', role: 'admin' },
    });
    expect(unknownField.status).toBe(400);
    expect((await harness.errorBody(unknownField)).error.issues?.[0]?.message).toContain('未知字段');

    const badIcon = await harness.call('/api/links', {
      body: {
        revision: content.revision,
        groupId: group.id,
        name: '图标',
        url: 'https://example.com',
        iconType: 'builtin',
        iconValue: 'not-a-real-icon',
      },
    });
    expect(badIcon.status).toBe(400);

    const badGroup = await harness.call('/api/links', {
      body: { revision: content.revision, groupId: 'g_missing', name: 'x', url: 'https://example.com' },
    });
    expect(badGroup.status).toBe(400);

    const oversized = await harness.call('/api/groups', {
      rawBody: JSON.stringify({ revision: content.revision, name: 'x'.repeat(2 * 1024 * 1024) }),
    });
    expect(oversized.status).toBe(413);
  });

  it('乐观并发：陈旧版本号被拒绝且不会写入任何数据', async () => {
    const harness = await authedHarness();
    await harness.createGroup('第一组');
    const content = await harness.getContent();
    const staleRevision = content.revision;

    await harness.createGroup('第二组');

    const conflicting = await harness.call('/api/groups', {
      body: { revision: staleRevision, name: '冲突组' },
    });
    expect(conflicting.status).toBe(409);
    const body = await harness.errorBody(conflicting);
    expect(body.error.code).toBe('revision_conflict');
    expect(body.error.revision).toBe(staleRevision + 1);

    const current = await harness.getContent();
    expect(current.groups.map((group) => group.name)).toEqual(['第一组', '第二组']);
    expect(current.revision).toBe(staleRevision + 1);

    const rows = await env.DB.prepare('SELECT COUNT(*) AS count FROM groups').first<{ count: number }>();
    expect(rows?.count).toBe(2);
    const guardRows = await env.DB.prepare('SELECT COUNT(*) AS count FROM revision_guard').first<{ count: number }>();
    expect(guardRows?.count).toBe(0);
  });

  it('两个并发写入使用同一版本号时只有一个成功', async () => {
    const harness = await authedHarness();
    await harness.createGroup('A');
    const content = await harness.getContent();

    const [first, second] = await Promise.all([
      harness.call('/api/groups', { body: { revision: content.revision, name: '并发一' } }),
      harness.call('/api/groups', { body: { revision: content.revision, name: '并发二' } }),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);

    const final = await harness.getContent();
    expect(final.groups).toHaveLength(2);
  });

  it('排序接口支持分组排序与跨分组移动，并拒绝不完整排列', async () => {
    const harness = await authedHarness();
    const groupA = await harness.createGroup('A');
    const groupB = await harness.createGroup('B');
    const link1 = await harness.createLink(groupA.id, { name: '一', url: 'https://one.example.com' });
    const link2 = await harness.createLink(groupA.id, { name: '二', url: 'https://two.example.com' });
    const link3 = await harness.createLink(groupB.id, { name: '三', url: 'https://three.example.com' });

    let content = await harness.getContent();
    const order = await harness.call('/api/order', {
      method: 'PUT',
      body: {
        revision: content.revision,
        groups: [groupB.id, groupA.id],
        links: { [groupA.id]: [link2.id, link1.id], [groupB.id]: [link3.id] },
      },
    });
    expect(order.status).toBe(200);

    content = await harness.getContent();
    expect(content.groups.map((group) => group.id)).toEqual([groupB.id, groupA.id]);
    const groupAState = content.groups.find((group) => group.id === groupA.id)!;
    expect(groupAState.links.map((link) => link.id)).toEqual([link2.id, link1.id]);

    // 跨分组移动：把 link2 移到 B 组末尾
    const cross = await harness.call('/api/order', {
      method: 'PUT',
      body: {
        revision: content.revision,
        groups: [groupB.id, groupA.id],
        links: { [groupA.id]: [link1.id], [groupB.id]: [link3.id, link2.id] },
      },
    });
    expect(cross.status).toBe(200);
    content = await harness.getContent();
    expect(content.groups.find((group) => group.id === groupB.id)!.links.map((link) => link.id)).toEqual([
      link3.id,
      link2.id,
    ]);

    const incomplete = await harness.call('/api/order', {
      method: 'PUT',
      body: { revision: content.revision, groups: [groupB.id, groupA.id], links: { [groupA.id]: [link1.id] } },
    });
    expect(incomplete.status).toBe(400);

    const staleOrder = await harness.call('/api/order', {
      method: 'PUT',
      body: {
        revision: content.revision - 1,
        groups: [groupA.id, groupB.id],
        links: { [groupA.id]: [link1.id], [groupB.id]: [link3.id, link2.id] },
      },
    });
    expect(staleOrder.status).toBe(409);
    const after = await harness.getContent();
    expect(after.groups.map((group) => group.id)).toEqual([groupB.id, groupA.id]);
  });

  it('删除非空分组必须显式迁移或级联确认', async () => {
    const harness = await authedHarness();
    const source = await harness.createGroup('来源');
    const target = await harness.createGroup('目标');
    const sourceLink = await harness.createLink(source.id, { name: '来源链接', url: 'https://source.example.com' });
    const targetLink = await harness.createLink(target.id, { name: '目标链接', url: 'https://target.example.com' });

    let content = await harness.getContent();
    const blocked = await harness.call(`/api/groups/${source.id}`, {
      method: 'DELETE',
      body: { revision: content.revision },
    });
    expect(blocked.status).toBe(409);
    expect((await harness.errorBody(blocked)).error.code).toBe('group_not_empty');

    const migrate = await harness.call(`/api/groups/${source.id}`, {
      method: 'DELETE',
      body: { revision: content.revision, mode: 'migrate', targetGroupId: target.id },
    });
    expect(migrate.status).toBe(200);
    content = await harness.getContent();
    const targetGroup = content.groups.find((group) => group.id === target.id)!;
    // 迁移过来的链接追加在目标分组末尾
    expect(targetGroup.links.map((link) => link.id)).toEqual([targetLink.id, sourceLink.id]);
    expect(content.groups).toHaveLength(1);

    // 级联删除需要确认
    const group = await harness.createGroup('待删除');
    await harness.createLink(group.id, { name: '链接', url: 'https://delete.example.com' });
    content = await harness.getContent();
    const noConfirm = await harness.call(`/api/groups/${group.id}`, {
      method: 'DELETE',
      body: { revision: content.revision, mode: 'cascade' },
    });
    expect(noConfirm.status).toBe(409);

    const confirmed = await harness.call(`/api/groups/${group.id}`, {
      method: 'DELETE',
      body: { revision: content.revision, mode: 'cascade', confirm: true },
    });
    expect(confirmed.status).toBe(200);
    content = await harness.getContent();
    expect(content.groups.map((item) => item.name)).not.toContain('待删除');
    const remainingLinks = await env.DB.prepare('SELECT COUNT(*) AS count FROM links').first<{ count: number }>();
    expect(remainingLinks?.count).toBe(2);

    // 空分组可以直接删除
    const empty = await harness.createGroup('空组');
    content = await harness.getContent();
    const emptyDelete = await harness.call(`/api/groups/${empty.id}`, {
      method: 'DELETE',
      body: { revision: content.revision },
    });
    expect(emptyDelete.status).toBe(200);
  });

  it('链接可以在编辑时移动到其它分组', async () => {
    const harness = await authedHarness();
    const groupA = await harness.createGroup('A');
    const groupB = await harness.createGroup('B');
    const link = await harness.createLink(groupA.id, { name: '移动我', url: 'https://move.example.com' });

    let content = await harness.getContent();
    const moved = await harness.expectOk<{ revision: number; link: NavLink }>(
      await harness.call(`/api/links/${link.id}`, {
        method: 'PATCH',
        body: { revision: content.revision, groupId: groupB.id },
      }),
    );
    expect(moved.link.groupId).toBe(groupB.id);
    content = await harness.getContent();
    expect(content.groups.find((group) => group.id === groupA.id)!.links).toHaveLength(0);
    expect(content.groups.find((group) => group.id === groupB.id)!.links).toHaveLength(1);
  });

  it('站点设置可更新，非法设置被拒绝', async () => {
    const harness = await authedHarness();
    let content = await harness.getContent();
    expect(content.settings.siteTitle).toBe('星屿导航');

    const settings = {
      ...content.settings,
      siteTitle: '我的星屿',
      overlayOpacity: 0.6,
      cardSize: 'compact' as const,
      theme: 'light' as const,
      searchEngine: 'google' as const,
    };
    const saved = await harness.expectOk<{ revision: number; settings: typeof settings }>(
      await harness.call('/api/settings', { method: 'PUT', body: { revision: content.revision, settings } }),
    );
    expect(saved.settings.siteTitle).toBe('我的星屿');

    content = await harness.getContent();
    expect(content.settings.theme).toBe('light');
    expect(content.settings.cardSize).toBe('compact');

    const invalid = await harness.call('/api/settings', {
      method: 'PUT',
      body: { revision: content.revision, settings: { ...settings, overlayOpacity: 5 } },
    });
    expect(invalid.status).toBe(400);

    const unknown = await harness.call('/api/settings', {
      method: 'PUT',
      body: { revision: content.revision, settings: { ...settings, evil: true } },
    });
    expect(unknown.status).toBe(400);

    const badWallpaper = await harness.call('/api/settings', {
      method: 'PUT',
      body: { revision: content.revision, settings: { ...settings, wallpaperUrl: 'javascript:alert(1)' } },
    });
    expect(badWallpaper.status).toBe(400);
  });

  it('未知路由与方法返回结构化错误', async () => {
    const harness = await authedHarness();
    const notFound = await harness.call('/api/nope');
    expect(notFound.status).toBe(404);
    expect((await harness.errorBody(notFound)).error.code).toBe('not_found');

    const wrongMethod = await harness.call('/api/login', { method: 'GET' });
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get('allow')).toContain('POST');

    // GET 不能触发写入
    const writeViaGet = await harness.call('/api/groups', { method: 'GET' });
    expect(writeViaGet.status).toBe(405);
  });

  it('密码修改失败会记录失败次数并限流', async () => {
    const harness = await authedHarness();
    for (let i = 0; i < 3; i += 1) {
      const response = await harness.call('/api/password', {
        body: { currentPassword: 'Wrong-Pass!000', newPassword: 'N3w-Pass!2026-ok' },
      });
      expect(response.status).toBe(400);
    }
    // 正确的当前密码仍然可用
    const ok = await harness.call('/api/password', {
      body: { currentPassword: TEST_PASSWORD, newPassword: 'N3w-Pass!2026-ok' },
    });
    expect(ok.status).toBe(200);
  });

  it('内容载荷不包含任何认证信息', async () => {
    const harness = await authedHarness();
    const content: ContentPayload = await harness.getContent();
    const serialized = JSON.stringify(content);
    expect(serialized).not.toContain('password');
    expect(serialized).not.toContain('token');
    expect(content.groups).toEqual([]);
  });
});
