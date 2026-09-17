import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * 服务端集成测试：在 workerd 运行时中运行，使用真实的 Miniflare D1 数据库，
 * 因此测试覆盖真实的 SQL、事务与约束行为。
 */
export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(fileURLToPath(new URL('./migrations', import.meta.url)));
      return {
        miniflare: {
          // 注意：vitest 测试池捆绑的 workerd（miniflare 5.20260815）最高支持 2026-08-15；
          // wrangler.jsonc 中 Pages 运行时使用较新的 2026-09-15（由 wrangler 捆绑的 workerd 提供）。
          compatibilityDate: '2026-08-15',
          d1Databases: ['DB'],
          bindings: {
            INIT_SECRET: 'test-init-secret',
            TEST_MIGRATIONS: migrations,
          },
        },
      };
    }),
  ],
  test: {
    include: ['tests/api/**/*.test.ts'],
    setupFiles: ['./tests/api/setup.ts'],
  },
});
