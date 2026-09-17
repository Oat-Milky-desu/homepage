<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { errorText } from '../api/client';
import AppClock from '../components/AppClock.vue';
import DeleteGroupDialog from '../components/DeleteGroupDialog.vue';
import EmptyState from '../components/EmptyState.vue';
import GroupFormDialog from '../components/GroupFormDialog.vue';
import GroupSection from '../components/GroupSection.vue';
import LinkCard from '../components/LinkCard.vue';
import LinkFormDialog from '../components/LinkFormDialog.vue';
import SearchBar from '../components/SearchBar.vue';
import type { IconType, LinkTarget, NavGroup, NavLink, Theme } from '../shared/types';
import {
  contentState,
  createGroup,
  createLink,
  deleteGroup,
  deleteLink,
  loadContent,
  moveGroup,
  moveGroupTo,
  moveLink,
  moveLinkByOffset,
  saveSettings,
  setGroupCollapsed,
  updateGroup,
  updateLink,
  type DeleteGroupOptions,
} from '../stores/content';
import { effectiveSettings } from '../stores/preview';
import { logoutRequest, sessionState } from '../stores/session';
import { confirmAction, toastError, toastSuccess } from '../stores/ui';

const router = useRouter();

const editing = ref(false);
const query = ref('');
const resultsRef = ref<HTMLElement | null>(null);

const linkDialog = ref({ open: false, groupId: '', link: null as NavLink | null });
const linkSaving = ref(false);
const linkError = ref<string | null>(null);

const groupDialog = ref({ open: false, group: null as NavGroup | null });
const groupSaving = ref(false);
const groupError = ref<string | null>(null);

const deleteDialog = ref({ open: false, group: null as NavGroup | null });
const deleteSaving = ref(false);
const deleteError = ref<string | null>(null);

const normalizedQuery = computed(() => query.value.trim().toLowerCase());
const searchActive = computed(() => normalizedQuery.value.length > 0);

/* ------------------------------- 主题快捷切换 ------------------------------- */

const themeSaving = ref(false);
const isDarkTheme = computed(() => contentState.settings.theme === 'dark');
const themeToggleLabel = computed(() => (isDarkTheme.value ? '切换到日间模式' : '切换到夜间模式'));
const themeToggleIcon = computed(() => (isDarkTheme.value ? '☀' : '☾'));
const themeToggleDisabled = computed(() => themeSaving.value || !contentState.loaded || contentState.loading);

const results = computed(() => {
  if (!searchActive.value) return [] as { group: NavGroup; link: NavLink }[];
  const needle = normalizedQuery.value;
  const output: { group: NavGroup; link: NavLink }[] = [];
  for (const group of contentState.groups) {
    for (const link of group.links) {
      const haystack = `${link.name} ${link.url} ${link.description} ${group.name}`.toLowerCase();
      if (haystack.includes(needle)) output.push({ group, link });
    }
  }
  return output;
});

onMounted(async () => {
  if (!contentState.loaded) {
    await loadContent();
  }
});

function toggleEditing(): void {
  editing.value = !editing.value;
}

function clearSearch(): void {
  query.value = '';
}

function scrollToGroup(groupId: string): void {
  document.getElementById(`group-${groupId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function run(action: () => Promise<void>, successMessage: string): Promise<void> {
  try {
    await action();
    toastSuccess(successMessage);
  } catch (error) {
    toastError(errorText(error));
  }
}

/* --------------------------------- 链接 --------------------------------- */

function openCreateLink(groupId: string): void {
  linkError.value = null;
  linkDialog.value = { open: true, groupId, link: null };
}

function openEditLink(link: NavLink): void {
  linkError.value = null;
  linkDialog.value = { open: true, groupId: link.groupId, link };
}

async function submitLink(payload: {
  groupId: string;
  name: string;
  url: string;
  description: string;
  iconType: IconType;
  iconValue: string;
  target: LinkTarget;
}): Promise<void> {
  linkSaving.value = true;
  linkError.value = null;
  try {
    if (linkDialog.value.link) {
      await updateLink(linkDialog.value.link.id, payload);
      toastSuccess('链接已更新');
    } else {
      await createLink(payload);
      toastSuccess('链接已添加');
    }
    linkDialog.value.open = false;
  } catch (error) {
    linkError.value = errorText(error);
  } finally {
    linkSaving.value = false;
  }
}

async function handleRemoveLink(link: NavLink): Promise<void> {
  const confirmed = await confirmAction({
    title: '删除链接',
    message: `确定要删除「${link.name}」吗？此操作不可撤销。`,
    confirmText: '删除',
    danger: true,
  });
  if (!confirmed) return;
  await run(() => deleteLink(link.id), '链接已删除');
}

async function handleMoveLink(linkId: string, offset: number): Promise<void> {
  await run(() => moveLinkByOffset(linkId, offset), '顺序已更新');
}

async function handleDropLink(linkId: string, groupId: string, index: number): Promise<void> {
  await run(() => moveLink(linkId, groupId, index), '顺序已更新');
}

/* --------------------------------- 分组 --------------------------------- */

function openCreateGroup(): void {
  groupError.value = null;
  groupDialog.value = { open: true, group: null };
}

function openRenameGroup(group: NavGroup): void {
  groupError.value = null;
  groupDialog.value = { open: true, group };
}

async function submitGroup(name: string): Promise<void> {
  groupSaving.value = true;
  groupError.value = null;
  try {
    if (groupDialog.value.group) {
      await updateGroup(groupDialog.value.group.id, { name });
      toastSuccess('分组已重命名');
    } else {
      await createGroup(name);
      toastSuccess('分组已创建');
      editing.value = true;
    }
    groupDialog.value.open = false;
  } catch (error) {
    groupError.value = errorText(error);
  } finally {
    groupSaving.value = false;
  }
}

function openDeleteGroup(group: NavGroup): void {
  deleteError.value = null;
  deleteDialog.value = { open: true, group };
}

async function submitDeleteGroup(options: DeleteGroupOptions): Promise<void> {
  const group = deleteDialog.value.group;
  if (!group) return;
  deleteSaving.value = true;
  deleteError.value = null;
  try {
    await deleteGroup(group.id, options);
    toastSuccess('分组已删除');
    deleteDialog.value.open = false;
  } catch (error) {
    deleteError.value = errorText(error);
  } finally {
    deleteSaving.value = false;
  }
}

async function handleToggleGroup(groupId: string, collapsed: boolean): Promise<void> {
  try {
    await setGroupCollapsed(groupId, collapsed);
  } catch (error) {
    toastError(errorText(error));
  }
}

async function handleMoveGroup(groupId: string, offset: number): Promise<void> {
  await run(() => moveGroup(groupId, offset), '分组顺序已更新');
}

async function handleDropGroup(groupId: string, targetIndex: number): Promise<void> {
  await run(() => moveGroupTo(groupId, targetIndex), '分组顺序已更新');
}

/* --------------------------------- 其它 --------------------------------- */

async function handleLogout(): Promise<void> {
  const confirmed = await confirmAction({
    title: '退出登录',
    message: '退出后需要重新输入密码才能访问导航内容。',
    confirmText: '退出',
  });
  if (!confirmed) return;
  try {
    await logoutRequest();
    toastSuccess('已退出登录');
    await router.replace({ name: 'login' });
  } catch (error) {
    // 服务端撤销失败时保留登录状态，提示用户重试，避免“假退出”
    toastError(`退出登录失败：${errorText(error)}`);
  }
}

function goAdmin(): void {
  void router.push({ name: 'admin' });
}

function onSearch(): void {
  resultsRef.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * 日间 / 夜间快捷切换：快照当前已保存设置与版本号，交给 saveSettings 做乐观并发检查，
 * 只有服务端确认成功后才用返回值更新全局设置（不会写入未保存的预览状态）。
 * 失败时 contentState.settings 保持服务端已保存值，界面主题不会被错误地改动。
 */
async function toggleTheme(): Promise<void> {
  if (themeToggleDisabled.value) return;
  const nextTheme: Theme = isDarkTheme.value ? 'light' : 'dark';
  themeSaving.value = true;
  try {
    await saveSettings({ ...contentState.settings, theme: nextTheme }, contentState.revision);
    toastSuccess(nextTheme === 'light' ? '已切换到日间模式' : '已切换到夜间模式');
  } catch (error) {
    toastError(`主题切换失败：${errorText(error)}`);
  } finally {
    themeSaving.value = false;
  }
}
</script>

<template>
  <div class="page home">
    <header class="topbar glass">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true">星</span>
        <div class="brand-text">
          <h1>{{ effectiveSettings.siteTitle }}</h1>
          <p class="muted brand-sub">{{ effectiveSettings.siteSubtitle }}</p>
        </div>
      </div>
      <div class="topbar-actions">
        <button
          type="button"
          class="btn btn-sm theme-toggle"
          :disabled="themeToggleDisabled"
          :aria-busy="themeSaving"
          :title="themeToggleLabel"
          @click="toggleTheme"
        >
          <span class="theme-toggle-icon" aria-hidden="true">{{ themeToggleIcon }}</span>
          <span>{{ themeSaving ? '保存中…' : themeToggleLabel }}</span>
        </button>
        <span class="badge user-chip">{{ sessionState.username || '管理员' }}</span>
        <button type="button" class="btn btn-sm" :aria-pressed="editing" @click="toggleEditing">
          {{ editing ? '完成编辑' : '编辑模式' }}
        </button>
        <button type="button" class="btn btn-sm" @click="goAdmin">设置</button>
        <button type="button" class="btn btn-sm btn-ghost" @click="handleLogout">退出</button>
      </div>
    </header>

    <section id="main-content" class="hero">
      <AppClock :show-seconds="effectiveSettings.clockShowSeconds" />
      <SearchBar
        v-model="query"
        :result-count="searchActive ? results.length : null"
        :engine="effectiveSettings.searchEngine"
        @search="onSearch"
      />
    </section>

    <div v-if="contentState.loading && !contentState.loaded" class="skeleton-grid" aria-hidden="true">
      <div v-for="index in 6" :key="index" class="skeleton skeleton-card"></div>
    </div>

    <div v-else-if="contentState.error && !contentState.loaded" class="card-surface error-panel" role="alert">
      <h2>内容加载失败</h2>
      <p class="muted">{{ contentState.error }}</p>
      <button type="button" class="btn btn-primary" @click="loadContent()">重新加载</button>
    </div>

    <template v-else>
      <nav v-if="!searchActive && contentState.groups.length > 1" class="group-nav glass" aria-label="分组快速跳转">
        <button
          v-for="group in contentState.groups"
          :key="group.id"
          type="button"
          class="group-nav-item"
          @click="scrollToGroup(group.id)"
        >
          {{ group.name }}
          <span class="group-nav-count">{{ group.links.length }}</span>
        </button>
      </nav>

      <section v-if="searchActive" ref="resultsRef" class="search-results">
        <div class="section-title">
          <h2>站内搜索结果</h2>
          <button type="button" class="btn btn-sm" @click="clearSearch">清除搜索</button>
        </div>
        <p v-if="results.length === 0" class="card-surface muted">
          没有找到匹配的站点，可以在上方选择百度 / Google / Bing 进行外部搜索。
        </p>
        <div v-else class="card-grid">
          <div v-for="item in results" :key="item.link.id" class="result-item">
            <span class="badge result-group">{{ item.group.name }}</span>
            <LinkCard :link="item.link" :index="0" :editing="false" :can-move-up="false" :can-move-down="false" />
          </div>
        </div>
      </section>

      <template v-else>
        <p v-if="editing" class="edit-hint card-surface">
          编辑模式已开启：拖动卡片可以排序或移动到其它分组，也可以使用卡片上的按钮进行调整。
        </p>

        <GroupSection
          v-for="(group, index) in contentState.groups"
          :key="group.id"
          :group="group"
          :index="index"
          :total="contentState.groups.length"
          :editing="editing"
          @toggle="(collapsed) => handleToggleGroup(group.id, collapsed)"
          @move-group="(offset) => handleMoveGroup(group.id, offset)"
          @drop-group="(groupId, targetIndex) => handleDropGroup(groupId, targetIndex)"
          @rename="openRenameGroup(group)"
          @remove="openDeleteGroup(group)"
          @add-link="openCreateLink(group.id)"
          @edit-link="openEditLink"
          @remove-link="handleRemoveLink"
          @move-link="handleMoveLink"
          @drop-link="(linkId, dropIndex) => handleDropLink(linkId, group.id, dropIndex)"
        />

        <EmptyState
          v-if="contentState.groups.length === 0"
          title="还没有任何分组"
          description="先创建一个分组（例如「工作」「常用工具」），然后往里面添加你想收藏的站点。"
          action-label="新建第一个分组"
          @action="openCreateGroup"
        />

        <button v-else type="button" class="btn add-group-btn" @click="openCreateGroup">＋ 新建分组</button>
      </template>
    </template>

    <LinkFormDialog
      :open="linkDialog.open"
      :link="linkDialog.link"
      :default-group-id="linkDialog.groupId"
      :groups="contentState.groups"
      :saving="linkSaving"
      :error="linkError"
      @close="linkDialog.open = false"
      @submit="submitLink"
    />

    <GroupFormDialog
      :open="groupDialog.open"
      :group="groupDialog.group"
      :saving="groupSaving"
      :error="groupError"
      @close="groupDialog.open = false"
      @submit="submitGroup"
    />

    <DeleteGroupDialog
      :open="deleteDialog.open"
      :group="deleteDialog.group"
      :groups="contentState.groups"
      :saving="deleteSaving"
      :error="deleteError"
      @close="deleteDialog.open = false"
      @submit="submitDeleteGroup"
    />
  </div>
</template>

<style scoped>
.home {
  display: flex;
  flex-direction: column;
}

.topbar {
  position: sticky;
  top: 12px;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 12px 18px;
  margin-bottom: 26px;
  flex-wrap: wrap;
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
}

.brand-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 13px;
  background: linear-gradient(135deg, var(--accent), #3b82f6);
  color: #04241b;
  font-weight: 700;
  font-size: 1.1rem;
}

.brand-text h1 {
  margin: 0;
  font-size: 1.12rem;
  line-height: 1.25;
}

.brand-sub {
  margin: 0;
  font-size: 0.82rem;
}

.topbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.user-chip {
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.theme-toggle-icon {
  font-size: 0.92rem;
  line-height: 1;
}

.hero {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 26px 0 34px;
}

.group-nav {
  display: flex;
  gap: 8px;
  padding: 8px;
  margin-bottom: 22px;
  overflow-x: auto;
}

.group-nav-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  white-space: nowrap;
}

.group-nav-item:hover {
  color: var(--text);
  background: rgba(255, 255, 255, 0.06);
  border-color: var(--border);
}

.group-nav-count {
  font-size: 0.76rem;
  opacity: 0.75;
}

.edit-hint {
  margin: 0 0 20px;
  padding: 12px 16px;
  font-size: 0.88rem;
  color: var(--text-muted);
}

.search-results {
  margin-bottom: 24px;
}

.result-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.result-group {
  align-self: flex-start;
}

.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(var(--card-min, 250px), 1fr));
  gap: 12px;
}

.skeleton-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(var(--card-min, 250px), 1fr));
  gap: 12px;
}

.skeleton-card {
  height: 92px;
}

.error-panel {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
}

.error-panel h2 {
  margin: 0;
  font-size: 1.05rem;
}

.add-group-btn {
  align-self: center;
  margin-top: 8px;
}

@media (max-width: 640px) {
  .topbar {
    position: static;
  }

  .brand-sub {
    display: none;
  }
}
</style>
