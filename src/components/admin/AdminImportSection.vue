<script setup lang="ts">
import { computed, ref } from 'vue';
import { errorText } from '../../api/client';
import { parseBookmarksHtml, planImport } from '../../utils/bookmarks';
import { dedupeKey } from '../../shared/url';
import { BOOKMARK_FILE_LIMIT_BYTES, MAX_GROUPS, MAX_LINKS } from '../../shared/limits';
import { contentState, importBookmarks, linkCount } from '../../stores/content';
import { confirmAction, toastSuccess } from '../../stores/ui';

const IMPORT_LIMIT = BOOKMARK_FILE_LIMIT_BYTES;

const fileInput = ref<HTMLInputElement | null>(null);
const parsed = ref<ReturnType<typeof parseBookmarksHtml> | null>(null);
const fileName = ref('');
const mode = ref<'folders' | 'single'>('folders');
const singleGroupName = ref('导入的书签');
const skipDuplicates = ref(true);
const importing = ref(false);
const error = ref('');
const message = ref('');

const existingKeys = computed(() => {
  const keys = new Set<string>();
  for (const group of contentState.groups) {
    for (const link of group.links) keys.add(dedupeKey(link.url));
  }
  return keys;
});

const plan = computed(() => {
  if (!parsed.value) return null;
  return planImport(parsed.value, {
    mode: mode.value,
    singleGroupName: singleGroupName.value,
    existingUrlKeys: skipDuplicates.value ? existingKeys.value : [],
    // 与服务端相同的总容量上限：既有内容 + 本次导入不能超过 300 分组 / 5000 链接
    maxGroups: Math.max(0, MAX_GROUPS - contentState.groups.length),
    maxLinks: Math.max(0, MAX_LINKS - linkCount.value),
  });
});

function reset(): void {
  parsed.value = null;
  fileName.value = '';
  error.value = '';
  message.value = '';
  if (fileInput.value) fileInput.value.value = '';
}

async function onFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  error.value = '';
  message.value = '';
  parsed.value = null;
  fileName.value = '';
  if (!file) return;
  if (file.size > IMPORT_LIMIT) {
    error.value = '文件过大，浏览器书签文件一般不超过 2 MB，请确认选择了正确的文件。';
    input.value = '';
    return;
  }
  const text = await file.text();
  if (!/<a\s/i.test(text) || !/<dl/i.test(text)) {
    error.value = '没有在文件中找到书签结构，请确认导出的是「书签 HTML」文件。';
    input.value = '';
    return;
  }
  const result = parseBookmarksHtml(text, { maxLinks: 5000 });
  if (result.total === 0) {
    error.value = '文件解析成功，但没有找到任何书签链接。';
    input.value = '';
    return;
  }
  parsed.value = result;
  fileName.value = file.name;
  input.value = '';
}

async function applyImport(): Promise<void> {
  const currentPlan = plan.value;
  if (!currentPlan || currentPlan.groups.length === 0) return;
  const confirmed = await confirmAction({
    title: '导入书签',
    message: `将创建 ${currentPlan.groups.length} 个分组、${currentPlan.totalLinks} 个链接，跳过 ${currentPlan.skipped.length} 条无效或重复记录。`,
    confirmText: '开始导入',
  });
  if (!confirmed) return;
  importing.value = true;
  error.value = '';
  try {
    const result = await importBookmarks(currentPlan.groups, { skipDuplicateUrls: skipDuplicates.value });
    message.value = `导入完成：新增 ${result.createdGroups} 个分组、${result.createdLinks} 个链接，跳过 ${result.skipped.length} 条。`;
    toastSuccess('书签导入完成');
    reset();
  } catch (importError) {
    error.value = errorText(importError);
  } finally {
    importing.value = false;
  }
}
</script>

<template>
  <div class="stack">
    <section class="card-surface inner">
      <h3>从浏览器导入书签</h3>
      <p class="muted small">
        支持 Chrome、Edge、Firefox、Safari 等浏览器导出的「书签 HTML」文件。文件在浏览器本地解析（不会执行脚本），确认预览后再提交到服务器。
      </p>
      <label class="file-row">
        <span class="btn btn-sm">选择书签 HTML 文件</span>
        <input ref="fileInput" type="file" accept=".html,.htm,text/html" @change="onFileChange" />
      </label>
      <p v-if="fileName" class="muted small">已解析：{{ fileName }}</p>
    </section>

    <section v-if="parsed && plan" class="card-surface inner">
      <h3>导入预览</h3>
      <ul class="preview-list">
        <li>解析到 {{ parsed.total }} 条链接，其中 {{ plan.totalLinks }} 条将被导入</li>
        <li>将创建 {{ plan.groups.length }} 个分组</li>
        <li>跳过 {{ plan.skipped.length }} 条（{{ plan.skipped.filter((item) => item.reason === 'duplicate').length }} 条重复、{{ plan.skipped.filter((item) => item.reason === 'invalid').length }} 条无效）</li>
      </ul>

      <div class="options">
        <div class="field">
          <span>导入方式</span>
          <div class="row" role="radiogroup" aria-label="导入方式">
            <label class="option-chip">
              <input v-model="mode" type="radio" value="folders" />
              <span>按文件夹创建分组</span>
            </label>
            <label class="option-chip">
              <input v-model="mode" type="radio" value="single" />
              <span>全部导入到一个分组</span>
            </label>
          </div>
        </div>

        <label v-if="mode === 'single'" class="field">
          <span>目标分组名称</span>
          <input v-model="singleGroupName" class="input" type="text" maxlength="60" />
        </label>

        <label class="checkbox-row">
          <input v-model="skipDuplicates" type="checkbox" />
          <span>跳过站点中已存在的链接（文件内部的重复会自动合并）</span>
        </label>
      </div>

      <details class="details">
        <summary>查看分组明细</summary>
        <ul class="preview-list detail-list">
          <li v-for="group in plan.groups" :key="group.name">
            {{ group.name }} —— {{ group.links.length }} 条
          </li>
        </ul>
      </details>

      <div class="row">
        <button type="button" class="btn btn-primary" :disabled="importing || plan.groups.length === 0" @click="applyImport">
          {{ importing ? '导入中…' : '确认导入' }}
        </button>
        <button type="button" class="btn" :disabled="importing" @click="reset">重新选择文件</button>
      </div>
    </section>

    <p v-if="message" class="form-success" role="status">{{ message }}</p>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.inner {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.inner h3 {
  margin: 0;
  font-size: 1rem;
}

.small {
  font-size: 0.86rem;
  margin: 4px 0 0;
}

.file-row {
  display: inline-flex;
  align-items: center;
  gap: 12px;
}

.file-row input[type='file'] {
  max-width: 100%;
  font-size: 0.85rem;
}

.preview-list {
  margin: 0;
  padding-left: 18px;
  font-size: 0.88rem;
  color: var(--text-muted);
}

.detail-list {
  max-height: 200px;
  overflow-y: auto;
}

.options {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.option-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  border: 1px solid var(--border);
  border-radius: 999px;
  cursor: pointer;
  font-size: 0.88rem;
}

.option-chip:has(input:checked) {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.details summary {
  cursor: pointer;
  font-size: 0.88rem;
  color: var(--text-muted);
}
</style>
