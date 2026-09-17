import { env } from 'cloudflare:test';
import { expect, it } from 'vitest';

it('迁移已应用，app_meta 存在初始版本号', async () => {
  const row = await env.DB.prepare('SELECT revision FROM app_meta WHERE id = 1').first<{ revision: number }>();
  expect(row?.revision).toBe(0);
});

it('外键约束生效', async () => {
  await env.DB.prepare('DELETE FROM links').run();
  let failed = false;
  try {
    await env.DB.prepare(
      "INSERT INTO links (id, group_id, name, url, description, icon_type, icon_value, target, position, created_at, updated_at) VALUES ('x', 'missing', 'n', 'https://a.com', '', 'auto', '', '_blank', 0, 'now', 'now')",
    ).run();
  } catch {
    failed = true;
  }
  expect(failed).toBe(true);
});
