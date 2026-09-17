import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, beforeEach, expect, it } from 'vitest';
import App from '../../src/App.vue';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';
import { contentState, resetContentState } from '../../src/stores/content';
import { clearPreview, effectiveSettings, previewState, setPreview } from '../../src/stores/preview';
import { sessionState } from '../../src/stores/session';

let wrapper: VueWrapper | null = null;

beforeEach(() => {
  resetContentState();
  clearPreview();
  sessionState.ready = true;
  sessionState.authenticated = true;
  sessionState.username = 'admin';
  sessionState.setupRequired = false;
  sessionState.statusError = '';
  contentState.loaded = true;
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.documentElement.removeAttribute('style');
  delete document.documentElement.dataset.theme;
});

it('外观设置写入 documentElement，因此 :root 派生变量与 teleport 对话框都能生效', async () => {
  contentState.settings = {
    ...DEFAULT_SETTINGS,
    cardOpacity: 0.2,
    glassBlur: 2,
    overlayOpacity: 0.3,
    cardSize: 'compact',
    theme: 'light',
  };
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { template: '<div class="home-stub" />' } }],
  });
  await router.push('/');
  await router.isReady();
  wrapper = mount(App, { global: { plugins: [router] } });
  await flushPromises();

  const root = document.documentElement;
  expect(root.style.getPropertyValue('--card-opacity')).toBe('0.2');
  expect(root.style.getPropertyValue('--glass-blur')).toBe('2px');
  expect(root.style.getPropertyValue('--overlay-opacity')).toBe('0.3');
  expect(root.style.getPropertyValue('--card-min')).toBe('196px');
  expect(root.dataset.theme).toBe('light');
  expect(document.title).toBe(DEFAULT_SETTINGS.siteTitle);
});

it('未保存的草稿只影响预览，不污染已保存设置', async () => {
  contentState.settings = { ...DEFAULT_SETTINGS, siteTitle: '已保存标题' };
  await Promise.resolve();
  expect(effectiveSettings.value.siteTitle).toBe('已保存标题');

  setPreview({ ...contentState.settings, siteTitle: '预览标题' });
  expect(effectiveSettings.value.siteTitle).toBe('预览标题');
  expect(contentState.settings.siteTitle).toBe('已保存标题');
  expect(previewState.settings?.siteTitle).toBe('预览标题');

  clearPreview();
  expect(effectiveSettings.value.siteTitle).toBe('已保存标题');
  expect(previewState.settings).toBeNull();
});

it('服务端状态探测失败时展示可重试错误而不是伪装成未初始化', async () => {
  sessionState.ready = false;
  sessionState.authenticated = false;
  const fetchMock = async () =>
    new Response(JSON.stringify({ error: { code: 'internal_error', message: '服务器开小差了' } }), { status: 500 });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  try {
    const { bootstrapSession } = await import('../../src/stores/session');
    const status = await bootstrapSession();
    expect(status).toBeNull();
    expect(sessionState.ready).toBe(true);
    expect(sessionState.statusError).toContain('服务器开小差了');
    expect(sessionState.authenticated).toBe(false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
