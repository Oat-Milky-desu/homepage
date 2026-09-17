import { beforeEach, describe, expect, it, vi } from 'vitest';
import { contentState, loadContent, moveGroupTo, moveLink, moveLinkByOffset, resetContentState } from '../../src/stores/content';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';
import type { ContentPayload, NavGroup } from '../../src/shared/types';

const NOW = '2026-03-01T08:00:00.000Z';

function makeLink(id: string, groupId: string, position: number) {
  return {
    id,
    groupId,
    name: id,
    url: `https://${id}.example.com`,
    description: '',
    iconType: 'auto' as const,
    iconValue: '',
    target: '_blank' as const,
    position,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function payload(): ContentPayload {
  const groupA: NavGroup = {
    id: 'g_a',
    name: 'A',
    position: 0,
    collapsed: false,
    createdAt: NOW,
    updatedAt: NOW,
    links: [makeLink('l1', 'g_a', 0), makeLink('l2', 'g_a', 1), makeLink('l3', 'g_a', 2)],
  };
  const groupB: NavGroup = {
    id: 'g_b',
    name: 'B',
    position: 1,
    collapsed: false,
    createdAt: NOW,
    updatedAt: NOW,
    links: [],
  };
  return { revision: 1, settings: { ...DEFAULT_SETTINGS }, groups: [groupA, groupB] };
}

function orderOf(groupId: string): string[] {
  return contentState.groups.find((group) => group.id === groupId)!.links.map((link) => link.id);
}

describe('排序状态逻辑', () => {
  let orderRequests: unknown[];

  beforeEach(async () => {
    resetContentState();
    orderRequests = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        const method = init?.method ?? 'GET';
        if (url === '/api/content' && method === 'GET') {
          return new Response(JSON.stringify(payload()), { status: 200 });
        }
        if (url === '/api/order' && method === 'PUT') {
          orderRequests.push(JSON.parse(String(init?.body)));
          return new Response(JSON.stringify({ revision: 2 }), { status: 200 });
        }
        return new Response(JSON.stringify({ error: { code: 'not_found', message: '未预期请求' } }), { status: 404 });
      }),
    );
    await loadContent();
  });

  it('同分组内下移一位', async () => {
    await moveLinkByOffset('l1', 1);
    expect(orderOf('g_a')).toEqual(['l2', 'l1', 'l3']);
    expect(contentState.revision).toBe(2);
    expect(contentState.groups[0]!.links.map((link) => link.position)).toEqual([0, 1, 2]);
  });

  it('同分组内上移一位', async () => {
    await moveLinkByOffset('l1', 1);
    await moveLinkByOffset('l1', -1);
    expect(orderOf('g_a')).toEqual(['l1', 'l2', 'l3']);
  });

  it('已在边界时不做任何请求', async () => {
    await moveLinkByOffset('l1', -1);
    await moveLinkByOffset('l3', 1);
    expect(orderRequests).toHaveLength(0);
    expect(orderOf('g_a')).toEqual(['l1', 'l2', 'l3']);
  });

  it('跨分组移动并发送完整顺序快照', async () => {
    await moveLink('l2', 'g_b', 0);
    expect(orderOf('g_a')).toEqual(['l1', 'l3']);
    expect(orderOf('g_b')).toEqual(['l2']);
    expect(contentState.groups.find((group) => group.id === 'g_b')!.links[0]!.groupId).toBe('g_b');

    const request = orderRequests.at(-1) as {
      revision: number;
      groups: string[];
      links: Record<string, string[]>;
    };
    expect(request.groups).toEqual(['g_a', 'g_b']);
    expect(request.links).toEqual({ g_a: ['l1', 'l3'], g_b: ['l2'] });
  });

  it('接口失败时回滚到服务端顺序', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        const method = init?.method ?? 'GET';
        if (url === '/api/content' && method === 'GET') return new Response(JSON.stringify(payload()), { status: 200 });
        if (url === '/api/order' && method === 'PUT') {
          return new Response(JSON.stringify({ error: { code: 'revision_conflict', message: '冲突' } }), { status: 409 });
        }
        return new Response('{}', { status: 404 });
      }),
    );
    await expect(moveLink('l2', 'g_b', 0)).rejects.toThrow();
    // 冲突后 store 会重新加载内容，顺序恢复为服务端状态
    expect(orderOf('g_a')).toEqual(['l1', 'l2', 'l3']);
    expect(orderOf('g_b')).toEqual([]);
  });

  it('分组拖拽排序发送完整顺序快照并更新本地状态', async () => {
    await moveGroupTo('g_b', 0);
    expect(contentState.groups.map((group) => group.id)).toEqual(['g_b', 'g_a']);
    const request = orderRequests.at(-1) as {
      revision: number;
      groups: string[];
      links: Record<string, string[]>;
    };
    expect(request.groups).toEqual(['g_b', 'g_a']);
    expect(request.links).toEqual({ g_b: [], g_a: ['l1', 'l2', 'l3'] });

    await moveGroupTo('g_a', 0);
    expect(contentState.groups.map((group) => group.id)).toEqual(['g_a', 'g_b']);
  });

  it('分组拖到原位置不发送请求', async () => {
    await moveGroupTo('g_a', 0);
    await moveGroupTo('g_b', 1);
    expect(orderRequests).toHaveLength(0);
    expect(contentState.groups.map((group) => group.id)).toEqual(['g_a', 'g_b']);
  });
});
