import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { createHarness, resetDatabase, seedAdmin, ORIGIN, TEST_PASSWORD, type Harness } from './helpers';
import { createApiHandler } from '../../functions/_lib/router';
import { assertSameOrigin } from '../../functions/_lib/http';
import { MAX_GROUPS, MAX_LINKS } from '../../src/shared/limits';
import type { BackupFile, ContentPayload, ImportResult } from '../../src/shared/types';

beforeEach(resetDatabase);

async function authedHarness(): Promise<Harness> {
  await resetDatabase();
  await seedAdmin();
  const harness = createHarness();
  await harness.expectOk(await harness.login());
  return harness;
}

/** 统计一次处理器调用中执行的 SQL 语句数量，用于验证 D1 查询预算 */
function countingHandler(harness: Harness) {
  let statements = 0;
  const budget = { max: 50 };
  const db = new Proxy(env.DB, {
    get(target, key) {
      if (key === 'prepare') {
        return (sql: string) => {
          statements += 1;
          if (statements > budget.max) throw new Error(`查询数量超出预算（>${budget.max}）`);
          return target.prepare(sql);
        };
      }
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const handler = createApiHandler({ now: () => harness.now(), pbkdf2Iterations: 1000 });
  return {
    statements: () => statements,
    call: (path: string, init: { method: string; body: unknown }) =>
      handler(
        new Request(ORIGIN + path, {
          method: init.method,
          headers: {
            Origin: ORIGIN,
            'Content-Type': 'application/json',
            Cookie: harness.cookie()!,
            'X-CSRF-Token': harness.csrf()!,
          },
          body: JSON.stringify(init.body),
        }),
        { ...env, DB: db } as Cloudflare.Env,
      ),
  };
}

function makeBackup(groupCount: number, linkCount: number): BackupFile {
  const now = '2026-03-01T00:00:00.000Z';
  const backup: BackupFile = {
    format: 'xingyu-nav-backup',
    version: 1,
    exportedAt: now,
    settings: {
      siteTitle: '批量站点',
      siteSubtitle: '批量测试',
      wallpaperUrl: '',
      overlayOpacity: 0.4,
      cardOpacity: 0.6,
      cardSize: 'cozy',
      theme: 'dark',
      searchEngine: 'baidu',
      clockShowSeconds: true,
      glassBlur: 10,
    },
    groups: [],
    links: [],
  };
  for (let g = 0; g < groupCount; g += 1) {
    backup.groups.push({ id: `g_${g}`, name: `分组${g}`, position: g, collapsed: false, createdAt: now, updatedAt: now });
  }
  for (let l = 0; l < linkCount; l += 1) {
    const g = l % groupCount;
    backup.links.push({
      id: `l_${l}`,
      groupId: `g_${g}`,
      name: `站点${l}`,
      url: `https://example.com/${l}`,
      description: '',
      iconType: 'auto',
      iconValue: '',
      target: '_blank',
      position: Math.floor(l / groupCount),
      createdAt: now,
      updatedAt: now,
    });
  }
  return backup;
}

describe('批量操作与 D1 查询预算', () => {
  it('600 条链接的恢复在 50 条 SQL 预算内原子完成', async () => {
    const harness = await authedHarness();
    const content = await harness.getContent();
    const backup = makeBackup(3, 600);
    const budget = countingHandler(harness);
    const response = await budget.call('/api/restore', { method: 'POST', body: { revision: content.revision, backup } });
    expect(response.status).toBe(200);
    expect(budget.statements()).toBeLessThanOrEqual(50);

    const after = await harness.getContent();
    expect(after.groups).toHaveLength(3);
    expect(after.groups.flatMap((group) => group.links)).toHaveLength(600);
  });

  it('600 条链接的跨分组排序在 50 条 SQL 预算内完成', async () => {
    const harness = await authedHarness();
    const importResult = await harness.expectOk<ImportResult>(
      await harness.call('/api/import', {
        body: {
          revision: 0,
          groups: [
            { name: 'A', links: Array.from({ length: 300 }, (_, i) => ({ name: `A${i}`, url: `https://a.example.com/${i}` })) },
            { name: 'B', links: Array.from({ length: 300 }, (_, i) => ({ name: `B${i}`, url: `https://b.example.com/${i}` })) },
          ],
        },
      }),
    );
    const content = await harness.getContent();
    const [groupA, groupB] = content.groups;
    const aLinks = groupA!.links.map((link) => link.id);
    const bLinks = groupB!.links.map((link) => link.id);
    // 交叉排列：A 组的后半段移到 B 组，B 组链接全部倒序并跨组移动
    const movedToB = [...bLinks.slice(0, 150), ...aLinks.slice(150)].reverse();
    const movedToA = [...aLinks.slice(0, 150), ...bLinks.slice(150)].reverse();

    const budget = countingHandler(harness);
    const response = await budget.call('/api/order', {
      method: 'PUT',
      body: {
        revision: content.revision,
        groups: content.groups.map((group) => group.id),
        links: { [groupA!.id]: movedToA, [groupB!.id]: movedToB },
      },
    });
    expect(response.status).toBe(200);
    expect(budget.statements()).toBeLessThanOrEqual(50);
    expect(importResult.createdLinks).toBe(600);

    const after: ContentPayload = await harness.getContent();
    expect(after.groups.find((group) => group.id === groupA!.id)!.links.map((link) => link.id)).toEqual(movedToA);
    expect(after.groups.find((group) => group.id === groupB!.id)!.links.map((link) => link.id)).toEqual(movedToB);
  });

  it('300 分组 / 5000 链接的备份可以完整恢复并再次导出', async () => {
    const harness = await authedHarness();
    const content = await harness.getContent();
    const backup = makeBackup(MAX_GROUPS, MAX_LINKS);
    const restore = await harness.call('/api/restore', { body: { revision: content.revision, backup } });
    expect(restore.status).toBe(200);

    const exported = await harness.json<BackupFile>(await harness.call('/api/backup'));
    expect(exported.groups).toHaveLength(MAX_GROUPS);
    expect(exported.links).toHaveLength(MAX_LINKS);

    const relay = await harness.call('/api/restore', { body: { revision: (await harness.getContent()).revision, backup: exported } });
    expect(relay.status).toBe(200);
    const final = await harness.getContent();
    expect(final.groups.flatMap((group) => group.links)).toHaveLength(MAX_LINKS);
  });
});

describe('排序与导入的严格校验', () => {
  it('排序必须提交完整且唯一的全局排列', async () => {
    const harness = await authedHarness();
    const a = await harness.createGroup('A');
    const b = await harness.createGroup('B');
    const l1 = await harness.createLink(a.id, { url: 'https://one.example.com' });
    const l2 = await harness.createLink(a.id, { url: 'https://two.example.com' });
    const l3 = await harness.createLink(b.id, { url: 'https://three.example.com' });
    const content = await harness.getContent();

    const cases: { name: string; body: unknown }[] = [
      { name: '重复链接', body: { revision: content.revision, groups: [a.id, b.id], links: { [a.id]: [l1.id, l1.id, l2.id], [b.id]: [l3.id] } } },
      { name: '缺少链接', body: { revision: content.revision, groups: [a.id, b.id], links: { [a.id]: [l1.id], [b.id]: [l3.id] } } },
      { name: '未知链接', body: { revision: content.revision, groups: [a.id, b.id], links: { [a.id]: [l1.id, 'l_unknown'], [b.id]: [l3.id] } } },
      { name: '分组顺序重复', body: { revision: content.revision, groups: [a.id, a.id], links: { [a.id]: [l1.id, l2.id, l3.id] } } },
      { name: '缺少分组键', body: { revision: content.revision, groups: [a.id, b.id], links: { [a.id]: [l1.id, l2.id] } } },
      { name: '多余分组键', body: { revision: content.revision, groups: [a.id], links: { [a.id]: [l1.id, l2.id], [b.id]: [l3.id] } } },
      { name: '未知分组键', body: { revision: content.revision, groups: [a.id, b.id], links: { [a.id]: [l1.id, l2.id], [b.id]: [l3.id], g_x: [] } } },
    ];
    for (const testCase of cases) {
      const response = await harness.call('/api/order', { method: 'PUT', body: testCase.body });
      expect(response.status, testCase.name).toBe(400);
    }
  });

  it('陈旧版本的空导入与空排序同样返回 409', async () => {
    const harness = await authedHarness();
    const group = await harness.createGroup('A');
    const state = await harness.getContent();
    await harness.expectOk(await harness.call(`/api/groups/${group.id}`, { method: 'PATCH', body: { revision: state.revision, name: 'B' } }));

    const emptyImport = await harness.call('/api/import', { body: { revision: state.revision, groups: [] } });
    expect(emptyImport.status).toBe(409);
    const emptyOrder = await harness.call('/api/order', {
      method: 'PUT',
      body: { revision: state.revision, groups: [group.id], links: { [group.id]: [] } },
    });
    expect(emptyOrder.status).toBe(409);
  });

  it('数量上限在写入前生效且不会产生部分写入', async () => {
    const harness = await authedHarness();
    const now = '2026-03-01T00:00:00.000Z';
    // 直接写入 300 个分组
    const groups = Array.from({ length: MAX_GROUPS }, (_, i) => ({
      id: `g_cap_${i}`,
      name: `上限分组${i}`,
      position: i,
      collapsed: false,
      createdAt: now,
      updatedAt: now,
    }));
    await env.DB.prepare(
      `INSERT INTO groups (id, name, position, collapsed, created_at, updated_at)
       SELECT json_extract(value,'$.id'), json_extract(value,'$.name'), json_extract(value,'$.position'),
              CASE WHEN json_extract(value,'$.collapsed') THEN 1 ELSE 0 END,
              json_extract(value,'$.createdAt'), json_extract(value,'$.updatedAt')
       FROM json_each(?1)`,
    )
      .bind(JSON.stringify(groups))
      .run();

    const content = await harness.getContent();
    const create = await harness.call('/api/groups', { body: { revision: content.revision, name: '超出上限' } });
    expect(create.status).toBe(400);
    expect((await harness.errorBody(create)).error.code).toBe('validation_error');
    const count = await env.DB.prepare('SELECT COUNT(*) AS count FROM groups').first<{ count: number }>();
    expect(count?.count).toBe(MAX_GROUPS);
    const guards = await env.DB.prepare('SELECT COUNT(*) AS count FROM validation_guard').first<{ count: number }>();
    expect(guards?.count).toBe(0);

    // 导入也不能越过上限
    const state = await harness.getContent();
    const overflowImport = await harness.call('/api/import', {
      body: { revision: state.revision, groups: [{ name: '溢出', links: [{ name: 'x', url: 'https://overflow.example.com' }] }] },
    });
    expect(overflowImport.status).toBe(400);

    // 链接上限：直接写入 5000 条链接
    const groupId = groups[0]!.id;
    const links = Array.from({ length: MAX_LINKS }, (_, i) => ({
      id: `l_cap_${i}`,
      groupId,
      name: `链接${i}`,
      url: `https://cap.example.com/${i}`,
      description: '',
      iconType: 'auto',
      iconValue: '',
      target: '_blank',
      position: i,
      createdAt: now,
      updatedAt: now,
    }));
    await env.DB.prepare(
      `INSERT INTO links (id, group_id, name, url, description, icon_type, icon_value, target, position, created_at, updated_at)
       SELECT json_extract(value,'$.id'), json_extract(value,'$.groupId'), json_extract(value,'$.name'), json_extract(value,'$.url'),
              json_extract(value,'$.description'), json_extract(value,'$.iconType'), json_extract(value,'$.iconValue'),
              json_extract(value,'$.target'), json_extract(value,'$.position'), json_extract(value,'$.createdAt'), json_extract(value,'$.updatedAt')
       FROM json_each(?1)`,
    )
      .bind(JSON.stringify(links))
      .run();

    const linkContent = await harness.getContent();
    const createLink = await harness.call('/api/links', {
      body: { revision: linkContent.revision, groupId, name: '溢出', url: 'https://overflow-link.example.com' },
    });
    expect(createLink.status).toBe(400);
    const linkCount = await env.DB.prepare('SELECT COUNT(*) AS count FROM links').first<{ count: number }>();
    expect(linkCount?.count).toBe(MAX_LINKS);
  });
});

describe('同源校验与限流', () => {
  it('端口或协议不同一律拒绝，显式 devOrigin 才放行', () => {
    const url = new URL(`${ORIGIN}/api/login`);
    const make = (origin: string, host = 'nav.example.com') =>
      new Request(url, { method: 'POST', headers: { origin, host } });

    expect(() => assertSameOrigin(make(ORIGIN), url)).not.toThrow();
    expect(() => assertSameOrigin(make(ORIGIN.replace('https:', 'http:')), url)).toThrow(/跨站/);
    expect(() => assertSameOrigin(make('https://nav.example.com:8443'), url)).toThrow(/跨站/);
    expect(() => assertSameOrigin(make('http://localhost:5173', 'localhost:5173'), url)).toThrow(/跨站/);
    expect(() => assertSameOrigin(make('http://localhost:5173', 'localhost:5173'), url, 'http://localhost:5173')).not.toThrow();
    expect(() => assertSameOrigin(make('https://evil.example'), url)).toThrow(/跨站/);
  });

  it('并发初始化错误密钥不能突破限流阈值', async () => {
    const harness = createHarness();
    const responses = await Promise.all(
      Array.from({ length: 14 }, () => harness.setup({ initSecret: 'wrong-secret' })),
    );
    const statuses = responses.map((response) => response.status);
    expect(statuses.filter((status) => status === 429).length).toBeGreaterThanOrEqual(4);
    const attempts = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM login_attempts WHERE scope = 'setup'",
    ).first<{ count: number }>();
    expect(attempts?.count).toBeLessThanOrEqual(10);
  });

  it('并发密码尝试不能突破限流阈值', async () => {
    await seedAdmin();
    const harness = createHarness();
    await harness.expectOk(await harness.login());
    const responses = await Promise.all(
      Array.from({ length: 14 }, () =>
        harness.call('/api/password', {
          body: { currentPassword: 'Wrong-Pass!000', newPassword: 'N3w-Pass!2026-ok' },
        }),
      ),
    );
    const statuses = responses.map((response) => response.status);
    expect(statuses.filter((status) => status === 400).length).toBeLessThanOrEqual(10);
    expect(statuses.filter((status) => status === 429).length).toBeGreaterThanOrEqual(4);
    expect((await harness.call('/api/content')).status).toBe(200);
  });

  it('并发密码修改与旧密码登录不会留下有效会话', async () => {
    await seedAdmin();
    const changer = createHarness();
    await changer.expectOk(await changer.login());
    const oldLogin = createHarness();
    const newPassword = 'R4ced-Pass!2026-ok';

    const [changeResult] = await Promise.all([
      changer.call('/api/password', { body: { currentPassword: TEST_PASSWORD, newPassword } }),
      oldLogin.login(),
    ]);

    // 并发下修改应该成功；成功后所有会话被撤销，旧密码永远不能再次登录
    expect(changeResult.status).toBe(200);
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM sessions').first<{ count: number }>()).toEqual({ count: 0 });
    expect((await oldLogin.call('/api/content')).status).toBe(401);
    const retry = await createHarness().login();
    expect([401, 429]).toContain(retry.status);
  });
});

describe('一致性读取', () => {
  it('导出备份与内容读取共享同一版本快照', async () => {
    const harness = await authedHarness();
    const group = await harness.createGroup('快照');
    await harness.createLink(group.id, { url: 'https://snapshot.example.com' });
    const content = await harness.getContent();
    const backup = await harness.json<BackupFile>(await harness.call('/api/backup'));
    expect(backup.groups.map((item) => item.id)).toEqual(content.groups.map((item) => item.id));
    expect(backup.links.map((item) => item.id)).toEqual(content.groups.flatMap((item) => item.links).map((item) => item.id));
    expect(backup.settings).toEqual(content.settings);
  });
});
