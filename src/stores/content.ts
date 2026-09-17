import { computed, reactive } from 'vue';
import { ApiError, apiRequest, errorText, getSessionEpoch } from '../api/client';
import { DEFAULT_SETTINGS } from '../shared/settings';
import type {
  AppSettings,
  BackupFile,
  ContentPayload,
  GroupDeleteMode,
  ImportGroupInput,
  ImportResult,
  NavGroup,
  NavLink,
} from '../shared/types';
import { showToast } from './ui';

export const contentState = reactive({
  loaded: false,
  loading: false,
  error: '',
  revision: 0,
  settings: { ...DEFAULT_SETTINGS } as AppSettings,
  groups: [] as NavGroup[],
});

export const linkCount = computed(() => contentState.groups.reduce((sum, group) => sum + group.links.length, 0));

function applyContent(payload: ContentPayload): void {
  contentState.revision = payload.revision;
  contentState.settings = { ...payload.settings };
  contentState.groups = payload.groups.map((group) => ({ ...group, links: group.links.map((link) => ({ ...link })) }));
  contentState.groups.sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt));
  contentState.loaded = true;
  contentState.error = '';
}

function normalizePositions(): void {
  contentState.groups.forEach((group, groupIndex) => {
    group.position = groupIndex;
    group.links.forEach((link, linkIndex) => {
      link.position = linkIndex;
      link.groupId = group.id;
    });
  });
}

/** 加载内容；返回是否成功（错误信息保存在 state 中） */
export async function loadContent(options: { silent?: boolean } = {}): Promise<boolean> {
  const epoch = getSessionEpoch();
  if (!options.silent) {
    contentState.loading = true;
    contentState.error = '';
  }
  try {
    const payload = await apiRequest<ContentPayload>('/api/content');
    // 会话在请求期间失效（登出 / 过期 / 重新登录）时丢弃响应，避免私有内容回流
    if (epoch !== getSessionEpoch()) return false;
    applyContent(payload);
    return true;
  } catch (error) {
    if (epoch === getSessionEpoch()) {
      contentState.error = errorText(error);
    }
    return false;
  } finally {
    if (epoch === getSessionEpoch()) {
      contentState.loading = false;
    }
  }
}

/** 会话失效后在途响应被丢弃时抛出；调用方无需展示具体细节 */
export class StaleSessionError extends Error {
  constructor() {
    super('登录状态已变更，操作结果已忽略');
    this.name = 'StaleSessionError';
  }
}

/** 统一处理版本冲突：刷新内容并提示用户 */
async function mutate<T>(request: () => Promise<T>): Promise<T> {
  const epoch = getSessionEpoch();
  try {
    const result = await request();
    // 请求期间发生登出 / 会话过期 / 重新登录：丢弃结果，避免私有数据回流
    if (epoch !== getSessionEpoch()) throw new StaleSessionError();
    return result;
  } catch (error) {
    if (error instanceof ApiError && error.code === 'stale_response') throw new StaleSessionError();
    if (error instanceof ApiError && error.isConflict) {
      await loadContent({ silent: true });
      showToast('内容已在其它设备上更新，已为你刷新最新数据，请重试刚才的操作', 'info');
    }
    throw error;
  }
}

async function persistOrder(): Promise<void> {
  const body = {
    revision: contentState.revision,
    groups: contentState.groups.map((group) => group.id),
    links: Object.fromEntries(contentState.groups.map((group) => [group.id, group.links.map((link) => link.id)])),
  };
  const result = await mutate(() => apiRequest<{ revision: number }>('/api/order', { method: 'PUT', body }));
  contentState.revision = result.revision;
  normalizePositions();
}

/** 本地先改顺序，失败时回滚到服务端状态 */
async function withOrderRollback(action: () => void): Promise<void> {
  action();
  try {
    await persistOrder();
  } catch (error) {
    await loadContent({ silent: true });
    throw error;
  }
}

/* --------------------------------- 分组 --------------------------------- */

export async function createGroup(name: string): Promise<NavGroup> {
  const result = await mutate(() =>
    apiRequest<{ revision: number; group: NavGroup }>('/api/groups', {
      body: { revision: contentState.revision, name },
    }),
  );
  contentState.revision = result.revision;
  const group: NavGroup = { ...result.group, links: [] };
  contentState.groups.push(group);
  return group;
}

export async function updateGroup(id: string, patch: { name?: string; collapsed?: boolean }): Promise<void> {
  const result = await mutate(() =>
    apiRequest<{ revision: number; group: NavGroup }>(`/api/groups/${id}`, {
      method: 'PATCH',
      body: { revision: contentState.revision, ...patch },
    }),
  );
  contentState.revision = result.revision;
  const group = contentState.groups.find((item) => item.id === id);
  if (group) {
    group.name = result.group.name;
    group.collapsed = result.group.collapsed;
    group.updatedAt = result.group.updatedAt;
  }
}

export async function setGroupCollapsed(id: string, collapsed: boolean): Promise<void> {
  const group = contentState.groups.find((item) => item.id === id);
  if (!group || group.collapsed === collapsed) return;
  const previous = group.collapsed;
  group.collapsed = collapsed;
  try {
    await updateGroup(id, { collapsed });
  } catch (error) {
    group.collapsed = previous;
    throw error;
  }
}

export interface DeleteGroupOptions {
  mode?: GroupDeleteMode;
  targetGroupId?: string;
  confirm?: boolean;
}

export async function deleteGroup(id: string, options: DeleteGroupOptions = {}): Promise<void> {
  const result = await mutate(() =>
    apiRequest<{ revision: number; deletedGroupId: string; migratedTo: string | null }>(`/api/groups/${id}`, {
      method: 'DELETE',
      body: { revision: contentState.revision, ...options },
    }),
  );
  contentState.revision = result.revision;
  contentState.groups = contentState.groups.filter((group) => group.id !== id);
  if (result.migratedTo) {
    await loadContent({ silent: true });
  } else {
    normalizePositions();
  }
}

export async function moveGroup(id: string, delta: number): Promise<void> {
  const index = contentState.groups.findIndex((group) => group.id === id);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= contentState.groups.length) return;
  await withOrderRollback(() => {
    const [moved] = contentState.groups.splice(index, 1);
    if (moved) contentState.groups.splice(target, 0, moved);
  });
}

/** 拖拽排序：把分组移动到目标下标（拖放后位置） */
export async function moveGroupTo(id: string, targetIndex: number): Promise<void> {
  const from = contentState.groups.findIndex((group) => group.id === id);
  if (from < 0) return;
  const clamped = Math.max(0, Math.min(targetIndex, contentState.groups.length - 1));
  const effective = from < clamped ? clamped - 1 : clamped;
  if (effective === from) return;
  await withOrderRollback(() => {
    const [moved] = contentState.groups.splice(from, 1);
    if (moved) contentState.groups.splice(effective, 0, moved);
  });
}

/* --------------------------------- 链接 --------------------------------- */

export interface LinkInput {
  groupId: string;
  name: string;
  url: string;
  description?: string;
  iconType?: NavLink['iconType'];
  iconValue?: string;
  target?: NavLink['target'];
}

export async function createLink(input: LinkInput): Promise<NavLink> {
  const result = await mutate(() =>
    apiRequest<{ revision: number; link: NavLink }>('/api/links', {
      body: { revision: contentState.revision, ...input },
    }),
  );
  contentState.revision = result.revision;
  const group = contentState.groups.find((item) => item.id === result.link.groupId);
  group?.links.push(result.link);
  return result.link;
}

export type LinkPatch = Partial<LinkInput>;

export async function updateLink(id: string, patch: LinkPatch): Promise<void> {
  const result = await mutate(() =>
    apiRequest<{ revision: number; link: NavLink }>(`/api/links/${id}`, {
      method: 'PATCH',
      body: { revision: contentState.revision, ...patch },
    }),
  );
  contentState.revision = result.revision;
  const link = result.link;
  for (const group of contentState.groups) {
    const index = group.links.findIndex((item) => item.id === id);
    if (index !== -1) group.links.splice(index, 1);
  }
  const targetGroup = contentState.groups.find((group) => group.id === link.groupId);
  targetGroup?.links.push(link);
  if (targetGroup) {
    targetGroup.links.sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt));
  }
}

export async function deleteLink(id: string): Promise<void> {
  const result = await mutate(() =>
    apiRequest<{ revision: number; deletedLinkId: string }>(`/api/links/${id}`, {
      method: 'DELETE',
      body: { revision: contentState.revision },
    }),
  );
  contentState.revision = result.revision;
  for (const group of contentState.groups) {
    const index = group.links.findIndex((item) => item.id === id);
    if (index !== -1) group.links.splice(index, 1);
  }
}

/** 拖拽 / 按钮排序：把链接移动到目标分组的指定位置 */
export async function moveLink(linkId: string, targetGroupId: string, targetIndex: number): Promise<void> {
  let sourceGroup: NavGroup | null = null;
  let sourceIndex = -1;
  for (const group of contentState.groups) {
    const index = group.links.findIndex((item) => item.id === linkId);
    if (index !== -1) {
      sourceGroup = group;
      sourceIndex = index;
      break;
    }
  }
  const targetGroup = contentState.groups.find((group) => group.id === targetGroupId);
  if (!sourceGroup || !targetGroup || sourceIndex === -1) return;

  await withOrderRollback(() => {
    const [link] = sourceGroup!.links.splice(sourceIndex, 1);
    if (!link) return;
    link.groupId = targetGroup!.id;
    let insertAt = targetIndex;
    if (sourceGroup!.id === targetGroup!.id && sourceIndex < targetIndex) insertAt -= 1;
    insertAt = Math.max(0, Math.min(insertAt, targetGroup!.links.length));
    targetGroup!.links.splice(insertAt, 0, link);
  });
}

export async function moveLinkByOffset(linkId: string, offset: number): Promise<void> {
  for (const group of contentState.groups) {
    const index = group.links.findIndex((item) => item.id === linkId);
    if (index === -1) continue;
    const target = index + offset;
    if (target < 0 || target >= group.links.length) return;
    await moveLink(linkId, group.id, offset > 0 ? target + 1 : target);
    return;
  }
}

/* --------------------------------- 设置 --------------------------------- */

export async function saveSettings(settings: AppSettings, revision: number): Promise<void> {
  const result = await mutate(() =>
    apiRequest<{ revision: number; settings: AppSettings }>('/api/settings', {
      method: 'PUT',
      body: { revision, settings },
    }),
  );
  contentState.revision = result.revision;
  contentState.settings = { ...result.settings };
}

/* --------------------------- 备份 / 恢复 / 导入 --------------------------- */

export async function exportBackup(): Promise<BackupFile> {
  return apiRequest<BackupFile>('/api/backup');
}

export async function restoreBackup(backup: BackupFile): Promise<void> {
  const result = await mutate(() =>
    apiRequest<{ revision: number }>('/api/restore', {
      body: { revision: contentState.revision, backup },
    }),
  );
  contentState.revision = result.revision;
  await loadContent({ silent: true });
}

export async function importBookmarks(
  groups: ImportGroupInput[],
  options: { skipDuplicateUrls?: boolean } = {},
): Promise<ImportResult> {
  const result = await mutate(() =>
    apiRequest<ImportResult>('/api/import', {
      body: { revision: contentState.revision, groups, skipDuplicateUrls: options.skipDuplicateUrls !== false },
    }),
  );
  contentState.revision = result.revision;
  await loadContent({ silent: true });
  return result;
}

export function resetContentState(): void {
  contentState.loaded = false;
  contentState.loading = false;
  contentState.error = '';
  contentState.revision = 0;
  contentState.settings = { ...DEFAULT_SETTINGS };
  contentState.groups = [];
}

/* --------------------------------- 拖拽 --------------------------------- */

export const dragState = reactive({
  linkId: null as string | null,
  fromGroupId: null as string | null,
  groupId: null as string | null,
});

export function beginDrag(link: NavLink): void {
  dragState.linkId = link.id;
  dragState.fromGroupId = link.groupId;
  dragState.groupId = null;
}

export function endDrag(): void {
  dragState.linkId = null;
  dragState.fromGroupId = null;
}

export function beginGroupDrag(groupId: string): void {
  dragState.groupId = groupId;
  dragState.linkId = null;
  dragState.fromGroupId = null;
}

export function endGroupDrag(): void {
  dragState.groupId = null;
}
