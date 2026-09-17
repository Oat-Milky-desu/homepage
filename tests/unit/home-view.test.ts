import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HomeView from '../../src/views/HomeView.vue';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';
import { contentState, resetContentState } from '../../src/stores/content';
import { clearPreview, previewState } from '../../src/stores/preview';
import { sessionState } from '../../src/stores/session';
import { uiState } from '../../src/stores/ui';
import type { AppSettings, ContentPayload, NavLink } from '../../src/shared/types';

const NOW = '2026-03-01T08:00:00.000Z';

function contentPayload(): ContentPayload {
  return {
    revision: 3,
    settings: { ...DEFAULT_SETTINGS, siteTitle: '测试站点', siteSubtitle: '副标题' },
    groups: [
      {
        id: 'g_work',
        name: '工作',
        position: 0,
        collapsed: false,
        createdAt: NOW,
        updatedAt: NOW,
        links: [
          {
            id: 'l_gh',
            groupId: 'g_work',
            name: 'GitHub',
            url: 'https://github.com',
            description: '代码托管',
            iconType: 'builtin',
            iconValue: 'code',
            target: '_blank',
            position: 0,
            createdAt: NOW,
            updatedAt: NOW,
          },
          {
            id: 'l_docs',
            groupId: 'g_work',
            name: '文档中心',
            url: 'https://docs.example.com',
            description: '',
            iconType: 'auto',
            iconValue: '',
            target: '_blank',
            position: 1,
            createdAt: NOW,
            updatedAt: NOW,
          },
        ],
      },
      {
        id: 'g_life',
        name: '生活',
        position: 1,
        collapsed: false,
        createdAt: NOW,
        updatedAt: NOW,
        links: [],
      },
    ],
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** 模拟后端：覆盖首页会用到的接口 */
function createFetchMock(options: { failFirstContent?: boolean; failSettings?: boolean } = {}) {
  const payload = contentPayload();
  const state = {
    revision: payload.revision,
    contentCalls: 0,
    settingsBodies: [] as { revision: number; settings: AppSettings }[],
  };
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';
    const body: Record<string, unknown> = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};

    if (url === '/api/content' && method === 'GET') {
      state.contentCalls += 1;
      if (options.failFirstContent && state.contentCalls === 1) {
        return jsonResponse({ error: { code: 'internal_error', message: '服务器开小差了' } }, 500);
      }
      return jsonResponse({ ...payload, revision: state.revision });
    }
    if (url === '/api/settings' && method === 'PUT') {
      const settings = body.settings as AppSettings;
      state.settingsBodies.push({ revision: Number(body.revision), settings });
      if (options.failSettings) {
        return jsonResponse({ error: { code: 'internal_error', message: '设置保存失败' } }, 500);
      }
      state.revision += 1;
      return jsonResponse({ revision: state.revision, settings });
    }
    if (url.startsWith('/api/groups/') && method === 'PATCH') {
      const group = payload.groups.find((item) => url.endsWith(item.id));
      if (!group) return jsonResponse({ error: { code: 'not_found', message: '分组不存在' } }, 404);
      state.revision += 1;
      return jsonResponse({
        revision: state.revision,
        group: {
          id: group.id,
          name: typeof body.name === 'string' ? body.name : group.name,
          position: group.position,
          collapsed: typeof body.collapsed === 'boolean' ? body.collapsed : group.collapsed,
          createdAt: group.createdAt,
          updatedAt: NOW,
          links: group.links,
        },
      });
    }
    if (url === '/api/links' && method === 'POST') {
      const link: NavLink = {
        id: 'l_new',
        groupId: String(body.groupId),
        name: String(body.name),
        url: String(body.url),
        description: typeof body.description === 'string' ? body.description : '',
        iconType: 'auto',
        iconValue: '',
        target: '_blank',
        position: 2,
        createdAt: NOW,
        updatedAt: NOW,
      };
      state.revision += 1;
      return jsonResponse({ revision: state.revision, link }, 201);
    }
    if (url === '/api/order' && method === 'PUT') {
      state.revision += 1;
      return jsonResponse({ revision: state.revision });
    }
    return jsonResponse({ error: { code: 'not_found', message: `未预期请求：${method} ${url}` } }, 404);
  });
  return { mock, state };
}

function createTestRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: HomeView },
      { path: '/admin', component: { template: '<div>admin</div>' } },
      { path: '/login', component: { template: '<div>login</div>' } },
    ],
  });
}

async function mountHome(): Promise<VueWrapper> {
  const router = createTestRouter();
  await router.push('/');
  await router.isReady();
  const wrapper = mount(HomeView, { global: { plugins: [router] } });
  await flushPromises();
  return wrapper;
}

function findButton(wrapper: VueWrapper, text: string) {
  return wrapper.findAll('button').find((button) => button.text().includes(text));
}

let wrappers: VueWrapper[] = [];

beforeEach(() => {
  resetContentState();
  clearPreview();
  uiState.toasts = [];
  sessionState.authenticated = true;
  sessionState.username = 'admin';
  sessionState.setupRequired = false;
  sessionState.ready = true;
});

afterEach(() => {
  wrappers.forEach((wrapper) => wrapper.unmount());
  wrappers = [];
  clearPreview();
  vi.unstubAllGlobals();
});

describe('首页渲染与交互', () => {
  it('渲染站点信息、分组与链接卡片', async () => {
    vi.stubGlobal('fetch', createFetchMock().mock);
    const wrapper = await mountHome();
    wrappers.push(wrapper);

    const text = wrapper.text();
    expect(text).toContain('测试站点');
    expect(text).toContain('工作');
    expect(text).toContain('GitHub');
    expect(text).toContain('生活');

    const links = wrapper.findAll('a.link-main');
    expect(links).toHaveLength(2);
    expect(links[0]!.attributes('href')).toBe('https://github.com');
    expect(links[0]!.attributes('rel')).toContain('noopener');
  });

  it('分组折叠会隐藏对应卡片', async () => {
    vi.stubGlobal('fetch', createFetchMock().mock);
    const wrapper = await mountHome();
    wrappers.push(wrapper);

    expect(wrapper.find('#group-body-g_work').isVisible()).toBe(true);
    await wrapper.find('button.group-toggle').trigger('click');
    await flushPromises();
    expect(wrapper.find('#group-body-g_work').attributes('style')).toContain('display: none');
    expect(contentState.groups[0]!.collapsed).toBe(true);

    await wrapper.find('button.group-toggle').trigger('click');
    await flushPromises();
    expect(wrapper.find('#group-body-g_work').isVisible()).toBe(true);
  });

  it('站内搜索过滤链接并显示结果数量', async () => {
    vi.stubGlobal('fetch', createFetchMock().mock);
    const wrapper = await mountHome();
    wrappers.push(wrapper);

    const input = wrapper.find('input[type="search"]');
    await input.setValue('github');
    await flushPromises();

    const results = wrapper.find('.search-results');
    expect(results.exists()).toBe(true);
    expect(results.text()).toContain('GitHub');
    expect(results.text()).not.toContain('文档中心');
    expect(wrapper.text()).toContain('站内找到 1 个结果');

    await input.setValue('不存在的关键词');
    await flushPromises();
    expect(wrapper.find('.search-results').text()).toContain('没有找到匹配的站点');
  });

  it('编辑模式提供可访问的排序按钮与分组操作', async () => {
    vi.stubGlobal('fetch', createFetchMock().mock);
    const wrapper = await mountHome();
    wrappers.push(wrapper);

    expect(wrapper.find('[aria-label="把「GitHub」上移"]').exists()).toBe(false);
    await findButton(wrapper, '编辑模式')!.trigger('click');
    await flushPromises();

    expect(wrapper.find('[aria-label="把「GitHub」上移"]').attributes('disabled')).toBeDefined();
    expect(wrapper.find('[aria-label="把「GitHub」下移"]').attributes('disabled')).toBeUndefined();
    expect(wrapper.find('.group-actions').exists()).toBe(true);
    expect(wrapper.find('[aria-label="把分组「工作」上移"]').attributes('disabled')).toBeDefined();
    expect(wrapper.find('[aria-label="把分组「工作」下移"]').attributes('disabled')).toBeUndefined();
  });

  it('空内容时显示引导性的空状态', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ revision: 0, settings: DEFAULT_SETTINGS, groups: [] })),
    );
    const wrapper = await mountHome();
    wrappers.push(wrapper);
    expect(wrapper.text()).toContain('还没有任何分组');
    expect(wrapper.find('.empty').exists()).toBe(true);
  });

  it('加载失败时显示错误状态并可重试', async () => {
    const { mock } = createFetchMock({ failFirstContent: true });
    vi.stubGlobal('fetch', mock);
    const wrapper = await mountHome();
    wrappers.push(wrapper);

    expect(wrapper.find('.error-panel').exists()).toBe(true);
    expect(wrapper.text()).toContain('服务器开小差了');

    await wrapper.find('.error-panel button').trigger('click');
    await flushPromises();
    expect(wrapper.find('.error-panel').exists()).toBe(false);
    expect(wrapper.text()).toContain('GitHub');
    expect(contentState.revision).toBe(3);
  });

  it('新增链接会调用接口并把卡片加入列表', async () => {
    const { mock } = createFetchMock();
    vi.stubGlobal('fetch', mock);
    const wrapper = await mountHome();
    wrappers.push(wrapper);

    await findButton(wrapper, '编辑模式')!.trigger('click');
    await flushPromises();

    const addButtons = wrapper.findAll('button').filter((button) => button.text().includes('+ 链接'));
    expect(addButtons.length).toBeGreaterThan(0);
    await addButtons[0]!.trigger('click');
    await flushPromises();

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    const nameInput = dialog!.querySelector<HTMLInputElement>('input[type="text"]')!;
    const urlInput = dialog!.querySelector<HTMLInputElement>('input[type="url"]')!;
    nameInput.value = '新站点';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    urlInput.value = 'https://new.example.com';
    urlInput.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();

    document.querySelector<HTMLFormElement>('#link-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushPromises();

    expect(mock).toHaveBeenCalledWith('/api/links', expect.objectContaining({ method: 'POST' }));
    expect(wrapper.text()).toContain('新站点');
    expect(contentState.groups[0]!.links.map((link) => link.name)).toContain('新站点');
  });

  it('页眉主题按钮可双向切换，保存最新版本与完整设置', async () => {
    const { mock, state } = createFetchMock();
    vi.stubGlobal('fetch', mock);
    const wrapper = await mountHome();
    wrappers.push(wrapper);

    const darkButton = findButton(wrapper, '切换到日间模式');
    expect(darkButton).toBeTruthy();
    expect(darkButton!.attributes('title')).toBe('切换到日间模式');

    await darkButton!.trigger('click');
    await flushPromises();

    expect(mock).toHaveBeenCalledWith('/api/settings', expect.objectContaining({ method: 'PUT' }));
    expect(state.settingsBodies).toHaveLength(1);
    expect(state.settingsBodies[0]!.revision).toBe(3);
    expect(state.settingsBodies[0]!.settings).toEqual({
      ...DEFAULT_SETTINGS,
      siteTitle: '测试站点',
      siteSubtitle: '副标题',
      theme: 'light',
    });
    expect(contentState.settings.theme).toBe('light');
    expect(previewState.settings).toBeNull();
    expect(uiState.toasts.some((toast) => toast.message.includes('已切换到日间模式'))).toBe(true);

    const lightButton = findButton(wrapper, '切换到夜间模式');
    expect(lightButton).toBeTruthy();
    await lightButton!.trigger('click');
    await flushPromises();

    expect(state.settingsBodies).toHaveLength(2);
    expect(state.settingsBodies[1]!.revision).toBe(4);
    expect(state.settingsBodies[1]!.settings.theme).toBe('dark');
    expect(state.settingsBodies[1]!.settings.siteTitle).toBe('测试站点');
    expect(contentState.settings.theme).toBe('dark');
    expect(uiState.toasts.some((toast) => toast.message.includes('已切换到夜间模式'))).toBe(true);
  });

  it('内容未加载时主题按钮禁用且不会发起保存请求', async () => {
    const pending = new Promise<Response>(() => {});
    const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';
      if (url === '/api/content' && method === 'GET') return pending;
      return jsonResponse({ error: { code: 'not_found', message: `未预期请求：${method} ${url}` } }, 404);
    });
    vi.stubGlobal('fetch', mock);
    const wrapper = await mountHome();
    wrappers.push(wrapper);

    const button = findButton(wrapper, '切换到日间模式')!;
    expect(button.attributes('disabled')).toBeDefined();
    await button.trigger('click');
    await flushPromises();
    expect(mock).toHaveBeenCalledTimes(1);
    expect(contentState.settings.theme).toBe('dark');
  });

  it('保存进行中主题按钮显示保存中并阻止重复提交', async () => {
    let releaseSettings: (() => void) | null = null;
    const payload = contentPayload();
    const settingsCalls: string[] = [];
    const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';
      if (url === '/api/content' && method === 'GET') return jsonResponse(payload);
      if (url === '/api/settings' && method === 'PUT') {
        settingsCalls.push(url);
        await new Promise<void>((resolve) => {
          releaseSettings = resolve;
        });
        const body = JSON.parse(String(init?.body)) as { settings: AppSettings };
        return jsonResponse({ revision: 4, settings: body.settings });
      }
      return jsonResponse({ error: { code: 'not_found', message: `未预期请求：${method} ${url}` } }, 404);
    });
    vi.stubGlobal('fetch', mock);
    const wrapper = await mountHome();
    wrappers.push(wrapper);

    await findButton(wrapper, '切换到日间模式')!.trigger('click');
    await flushPromises();

    const savingButton = findButton(wrapper, '保存中');
    expect(savingButton).toBeTruthy();
    expect(savingButton!.attributes('disabled')).toBeDefined();
    await savingButton!.trigger('click');
    await flushPromises();
    expect(settingsCalls).toHaveLength(1);

    releaseSettings!();
    await flushPromises();
    expect(contentState.settings.theme).toBe('light');
    expect(findButton(wrapper, '切换到夜间模式')).toBeTruthy();
  });

  it('保存失败时保留已保存主题、给出错误反馈且按钮恢复可用', async () => {
    const { mock, state } = createFetchMock({ failSettings: true });
    vi.stubGlobal('fetch', mock);
    const wrapper = await mountHome();
    wrappers.push(wrapper);

    await findButton(wrapper, '切换到日间模式')!.trigger('click');
    await flushPromises();

    expect(state.settingsBodies).toHaveLength(1);
    expect(contentState.settings.theme).toBe('dark');
    const retryButton = findButton(wrapper, '切换到日间模式');
    expect(retryButton).toBeTruthy();
    expect(retryButton!.attributes('disabled')).toBeUndefined();
    expect(
      uiState.toasts.some((toast) => toast.type === 'error' && toast.message.includes('主题切换失败')),
    ).toBe(true);
  });
});
