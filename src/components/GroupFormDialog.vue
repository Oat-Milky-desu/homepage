<script setup lang="ts">
import { ref, watch } from 'vue';
import type { NavGroup } from '../shared/types';
import BaseModal from './BaseModal.vue';

const props = defineProps<{
  open: boolean;
  group: NavGroup | null;
  saving: boolean;
  error: string | null;
}>();

const emit = defineEmits<{
  (event: 'close'): void;
  (event: 'submit', name: string): void;
}>();

const name = ref('');
const localError = ref('');

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    name.value = props.group?.name ?? '';
    localError.value = '';
  },
  { immediate: true },
);

function onSubmit(): void {
  const value = name.value.trim();
  if (!value) {
    localError.value = '分组名称不能为空';
    return;
  }
  if (value.length > 60) {
    localError.value = '分组名称不能超过 60 个字符';
    return;
  }
  localError.value = '';
  emit('submit', value);
}
</script>

<template>
  <BaseModal
    :open="open"
    :title="group ? '重命名分组' : '新建分组'"
    description="分组用于整理收藏的站点，可随时拖动排序。"
    @close="emit('close')"
  >
    <form id="group-form" @submit.prevent="onSubmit">
      <label class="field">
        <span>分组名称 *</span>
        <input v-model="name" class="input" type="text" maxlength="60" required :aria-invalid="Boolean(localError)" placeholder="例如：工作" />
        <span v-if="localError" class="field-error">{{ localError }}</span>
      </label>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    </form>
    <template #footer>
      <button type="button" class="btn" @click="emit('close')">取消</button>
      <button type="submit" form="group-form" class="btn btn-primary" :disabled="saving" data-autofocus>
        {{ saving ? '保存中…' : '保存' }}
      </button>
    </template>
  </BaseModal>
</template>

<style scoped>
.field-error {
  color: var(--danger);
  font-size: 0.8rem;
}
</style>
