<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { GroupDeleteMode, NavGroup } from '../shared/types';
import BaseModal from './BaseModal.vue';

const props = defineProps<{
  open: boolean;
  group: NavGroup | null;
  groups: NavGroup[];
  saving: boolean;
  error: string | null;
}>();

const emit = defineEmits<{
  (event: 'close'): void;
  (event: 'submit', payload: { mode?: GroupDeleteMode; targetGroupId?: string; confirm?: boolean }): void;
}>();

const mode = ref<GroupDeleteMode>('migrate');
const targetGroupId = ref('');
const confirmed = ref(false);
const localError = ref('');

const candidates = computed(() => props.groups.filter((group) => group.id !== props.group?.id));
const linkCount = computed(() => props.group?.links.length ?? 0);
const hasLinks = computed(() => linkCount.value > 0);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    mode.value = 'migrate';
    targetGroupId.value = candidates.value[0]?.id ?? '';
    confirmed.value = false;
    localError.value = '';
  },
  { immediate: true },
);

function onSubmit(): void {
  if (!hasLinks.value) {
    emit('submit', {});
    return;
  }
  if (mode.value === 'migrate') {
    if (!targetGroupId.value) {
      localError.value = '请选择迁移目标分组';
      return;
    }
    emit('submit', { mode: 'migrate', targetGroupId: targetGroupId.value });
    return;
  }
  if (!confirmed.value) {
    localError.value = '请勾选确认后再执行级联删除';
    return;
  }
  emit('submit', { mode: 'cascade', confirm: true });
}
</script>

<template>
  <BaseModal
    :open="open"
    title="删除分组"
    :description="`即将删除分组「${group?.name ?? ''}」。`"
    @close="emit('close')"
  >
    <div v-if="hasLinks" class="stack">
      <p class="muted delete-note">
        该分组包含 {{ linkCount }} 个链接，请选择处理方式。删除操作不可撤销，但可以通过备份恢复。
      </p>

      <label class="option" :class="{ selected: mode === 'migrate' }">
        <input v-model="mode" type="radio" value="migrate" />
        <span>
          <strong>迁移到其它分组</strong>
          <span class="muted option-hint">链接会追加到目标分组的末尾</span>
        </span>
      </label>
      <select v-if="mode === 'migrate'" v-model="targetGroupId" class="select" aria-label="迁移目标分组">
        <option v-for="candidate in candidates" :key="candidate.id" :value="candidate.id">{{ candidate.name }}</option>
      </select>
      <p v-if="mode === 'migrate' && candidates.length === 0" class="form-error">没有其它分组可以接收这些链接。</p>

      <label class="option" :class="{ selected: mode === 'cascade' }">
        <input v-model="mode" type="radio" value="cascade" />
        <span>
          <strong>级联删除链接</strong>
          <span class="muted option-hint">分组内的 {{ linkCount }} 个链接会一并删除</span>
        </span>
      </label>
      <label v-if="mode === 'cascade'" class="checkbox-row">
        <input v-model="confirmed" type="checkbox" />
        <span>我确认要删除该分组内的全部链接</span>
      </label>
    </div>

    <p v-else class="muted">该分组为空，删除后不会影响任何链接。</p>

    <p v-if="localError || error" class="form-error" role="alert">{{ localError || error }}</p>

    <template #footer>
      <button type="button" class="btn" @click="emit('close')">取消</button>
      <button type="button" class="btn btn-danger" :disabled="saving" @click="onSubmit">
        {{ saving ? '处理中…' : '确认删除' }}
      </button>
    </template>
  </BaseModal>
</template>

<style scoped>
.delete-note {
  margin: 0;
  font-size: 0.88rem;
}

.option {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.option.selected {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.option strong {
  display: block;
  font-size: 0.92rem;
}

.option-hint {
  display: block;
  font-size: 0.8rem;
}
</style>
