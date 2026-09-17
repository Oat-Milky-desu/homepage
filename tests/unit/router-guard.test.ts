import { beforeEach, describe, expect, it } from 'vitest';
import { router } from '../../src/router';
import { sessionState } from '../../src/stores/session';

/**
 * 路由守卫：保证未初始化 / 未登录的用户不会看到首页内容。
 * main.ts 会在安装路由之前完成状态探测，因此守卫总能拿到确定的会话状态。
 */
describe('路由守卫', () => {
  beforeEach(() => {
    sessionState.ready = false;
    sessionState.setupRequired = true;
    sessionState.authenticated = false;
    sessionState.username = '';
  });

  it('状态未就绪时不拦截', async () => {
    await router.push('/login');
    expect(router.currentRoute.value.name).toBe('login');
    await router.push('/');
    expect(router.currentRoute.value.name).toBe('home');
  });

  it('尚未初始化时强制进入初始化向导', async () => {
    await router.push('/login');
    sessionState.ready = true;
    await router.push('/admin');
    expect(router.currentRoute.value.name).toBe('setup');
  });

  it('未登录访问受保护页面会带上 redirect 参数跳转登录', async () => {
    await router.push('/');
    sessionState.ready = true;
    sessionState.setupRequired = false;
    await router.push('/admin');
    expect(router.currentRoute.value.name).toBe('login');
    expect(router.currentRoute.value.query.redirect).toBe('/admin');
  });

  it('已登录时访问登录页会回到首页', async () => {
    await router.push('/');
    sessionState.ready = true;
    sessionState.setupRequired = false;
    sessionState.authenticated = true;
    await router.push('/login');
    expect(router.currentRoute.value.name).toBe('home');
  });

  it('初始化完成后允许进入首页与管理页', async () => {
    await router.push('/login');
    sessionState.ready = true;
    sessionState.setupRequired = false;
    sessionState.authenticated = true;
    await router.push('/');
    expect(router.currentRoute.value.name).toBe('home');
    await router.push('/admin');
    expect(router.currentRoute.value.name).toBe('admin');
  });
});
