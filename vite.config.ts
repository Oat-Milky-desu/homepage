import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // 本地开发：/api 代理到 wrangler pages dev 或 wrangler dev（均监听 8788 端口）
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8788',
        changeOrigin: false,
      },
    },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    // Vite 8 默认的 Lightning CSS 压缩会把 `-webkit-backdrop-filter` 与标准属性
    // 视为同一属性而只保留最后一条，导致现代浏览器失去毛玻璃效果。
    // 改用 esbuild 压缩，完整保留带前缀与不带前缀的两条声明。
    cssMinify: 'esbuild',
  },
});
