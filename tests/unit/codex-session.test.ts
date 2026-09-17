import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { bootstrapSession, loginRequest, logoutRequest, reportActivity, sessionState } from '../../src/stores/session';
import { getCsrfToken } from '../../src/api/client';
import { contentState, createGroup, resetContentState } from '../../src/stores/content';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';

beforeEach(() => {
  resetContentState();
  sessionState.authenticated = true;
  contentState.loaded = true;
  contentState.settings.siteTitle = 'Private title';
});
afterEach(() => vi.unstubAllGlobals());

it('a stale bootstrap completion must not invalidate a successful new login', async () => {
  let resolveStatus!: (response: Response) => void;
  vi.stubGlobal('fetch', vi.fn((url: string) => url === '/api/status'
    ? new Promise<Response>((resolve) => { resolveStatus = resolve; })
    : Promise.resolve(new Response(JSON.stringify({ setupRequired: false, authenticated: true, user: { username: 'fresh' }, csrfToken: 'fresh-csrf' })))));
  const oldBootstrap = bootstrapSession();
  await loginRequest('fresh', 'test-password');
  resolveStatus(new Response(JSON.stringify({ setupRequired: false, authenticated: false, csrfToken: 'old-csrf' })));
  await oldBootstrap;
  expect(sessionState.authenticated).toBe(true);
  expect(sessionState.username).toBe('fresh');
  expect(getCsrfToken()).toBe('fresh-csrf');
  expect(sessionState.statusError).toBe('');
});

it('activity rejection clears expired private state', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'session_expired', message: 'expired' } }), { status: 401 })));
  await reportActivity();
  expect(sessionState.authenticated).toBe(false);
  expect(contentState.loaded).toBe(false);
  expect(contentState.settings).toEqual(DEFAULT_SETTINGS);
});

it('restored unauthenticated status clears previously loaded settings', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ setupRequired: false, authenticated: false }))));
  await bootstrapSession();
  expect(contentState.loaded).toBe(false);
  expect(contentState.settings).toEqual(DEFAULT_SETTINGS);
});

it('inflight mutation cannot repopulate content after confirmed logout', async () => {
  let resolveGroup!: (response: Response) => void;
  vi.stubGlobal('fetch', vi.fn((url: string) => url === '/api/groups'
    ? new Promise<Response>((resolve) => { resolveGroup = resolve; })
    : Promise.resolve(new Response(JSON.stringify({ ok: true })))));
  const pending = createGroup('private group');
  const settled = pending.catch(() => undefined);
  await logoutRequest();
  resolveGroup(new Response(JSON.stringify({ revision: 2, group: { id: 'g_review', name: 'private group', position: 0, collapsed: false, createdAt: '', updatedAt: '', links: [] } })));
  await settled;
  expect(contentState.groups).toEqual([]);
  expect(contentState.revision).toBe(0);
});
