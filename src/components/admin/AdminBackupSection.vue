<script setup lang="ts">
import { computed, ref } from 'vue';
import { errorText } from '../../api/client';
import { backupField } from '../../shared/backup';
import { RESTORE_BODY_LIMIT_BYTES } from '../../shared/limits';
import type { BackupFile } from '../../shared/types';
import { collectIssues } from '../../shared/validate';
import { contentState, exportBackup, linkCount, restoreBackup } from '../../stores/content';
import { confirmAction, toastSuccess } from '../../stores/ui';
import { backupFileName, formatDateTime, formatFileSize } from '../../utils/format';

const RESTORE_LIMIT = RESTORE_BODY_LIMIT_BYTES;

const exporting = ref(false);
const restoring = ref(false);
const preview = ref<BackupFile | null>(null);
const message = ref('');
const error = ref('');

const currentSummary = computed(() => `${contentState.groups.length} 个分组 · ${linkCount.value} 个链接`);

async function handleExport(): Promise<void> {
  exporting.value = true;
  error.value = '';
  message.value = '';
  try {
    const backup = await exportBackup();
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = backupFileName();
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    message.value = `已导出 ${backup.groups.length} 个分组、${backup.links.length} 个链接（不含密码与会话信息）。`;
    toastSuccess('备份已导出');
  } catch (exportError) {
    error.value = errorText(exportError);
  } finally {
    exporting.value = false;
  }
}

async function onFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  preview.value = null;
  message.value = '';
  error.value = '';
  if (!file) return;
  if (file.size > RESTORE_LIMIT) {
    error.value = `文件过大（${formatFileSize(file.size)}），最大支持 ${formatFileSize(RESTORE_LIMIT)}`;
    return;
  }
  const text = await file.text();
  let data: unknown;
  try {
    data = JSON.parse(text) as unknown;
  } catch {
    error.value = '文件不是合法的 JSON，请确认选择的是星屿导航导出的备份文件。';
    return;
  }
  const result = collectIssues(backupField, data);
  if (!result.value || result.issues.length > 0) {
    error.value = result.issues
      .slice(0, 4)
      .map((issue) => (issue.path ? `${issue.path}：${issue.message}` : issue.message))
      .join('；');
    return;
  }
  preview.value = result.value;
}

async function applyRestore(): Promise<void> {
  const backup = preview.value;
  if (!backup) return;
  const confirmed = await confirmAction({
    title: '恢复备份',
    message: `将用备份中的 ${backup.groups.length} 个分组、${backup.links.length} 个链接替换当前的全部内容（${currentSummary.value}）。此操作不可撤销。`,
    confirmText: '确认恢复',
    danger: true,
    checkboxLabel: '我了解当前内容会被完全替换',
  });
  if (!confirmed) return;
  restoring.value = true;
  error.value = '';
  try {
    await restoreBackup(backup);
    preview.value = null;
    message.value = '备份已恢复，页面内容已同步更新。';
    toastSuccess('备份已恢复');
  } catch (restoreError) {
    error.value = errorText(restoreError);
  } finally {
    restoring.value = false;
  }
}
</script>

<template>
  <div class="stack">
    <section class="card-surface inner">
      <div class="spread">
        <div>
          <h3>导出备份</h3>
          <p class="muted small">当前内容：{{ currentSummary }}。备份文件为纯 JSON，不包含密码、会话或初始化密钥。</p>
        </div>
        <button type="button" class="btn btn-primary" :disabled="exporting" @click="handleExport">
          {{ exporting ? '导出中…' : '下载备份' }}
        </button>
      </div>
    </section>

    <section class="card-surface inner">
      <h3>恢复备份</h3>
      <p class="muted small">
        选择之前导出的 JSON 文件，先校验并预览，确认后才会原子替换当前内容。恢复会保留递增的版本号，其它设备会看到最新数据。
      </p>
      <label class="file-row">
        <span class="btn btn-sm">选择备份文件</span>
        <input type="file" accept="application/json,.json" @change="onFileChange" />
      </label>

      <div v-if="preview" class="preview">
        <h4>备份预览</h4>
        <ul class="preview-list">
          <li>导出时间：{{ formatDateTime(preview.exportedAt) }}</li>
          <li>站点标题：{{ preview.settings.siteTitle }}</li>
          <li>分组数量：{{ preview.groups.length }}</li>
          <li>链接数量：{{ preview.links.length }}</li>
        </ul>
        <button type="button" class="btn btn-danger" :disabled="restoring" @click="applyRestore">
          {{ restoring ? '恢复中…' : '确认恢复此备份' }}
        </button>
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

.preview {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-sm);
}

.preview h4 {
  margin: 0;
  font-size: 0.95rem;
}

.preview-list {
  margin: 0;
  padding-left: 18px;
  font-size: 0.88rem;
  color: var(--text-muted);
}
</style>
