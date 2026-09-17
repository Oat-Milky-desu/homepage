<script setup lang="ts">
import { ref, watch } from 'vue';
import BaseModal from './BaseModal.vue';
import { resolveConfirm, uiState } from '../stores/ui';

const checked = ref(true);

watch(
  () => uiState.confirm,
  (state) => {
    checked.value = !state?.checkboxLabel;
  },
  { immediate: true },
);

function confirmPrimary(): void {
  if (!checked.value) return;
  resolveConfirm('primary');
}
</script>

<template>
  <BaseModal
    :open="Boolean(uiState.confirm)"
    :title="uiState.confirm?.title ?? ''"
    @close="resolveConfirm('cancel')"
  >
    <p class="confirm-message">{{ uiState.confirm?.message }}</p>
    <label v-if="uiState.confirm?.checkboxLabel" class="checkbox-row confirm-check">
      <input v-model="checked" type="checkbox" />
      <span>{{ uiState.confirm?.checkboxLabel }}</span>
    </label>
    <template #footer>
      <button type="button" class="btn" @click="resolveConfirm('cancel')">
        {{ uiState.confirm?.cancelText ?? '取消' }}
      </button>
      <button
        v-if="uiState.confirm?.secondaryText"
        type="button"
        class="btn"
        :disabled="!checked"
        @click="resolveConfirm('secondary')"
      >
        {{ uiState.confirm.secondaryText }}
      </button>
      <button
        type="button"
        class="btn"
        :class="uiState.confirm?.danger ? 'btn-danger' : 'btn-primary'"
        :disabled="!checked"
        data-autofocus
        @click="confirmPrimary"
      >
        {{ uiState.confirm?.confirmText ?? '确认' }}
      </button>
    </template>
  </BaseModal>
</template>

<style scoped>
.confirm-message {
  margin: 0 0 12px;
  white-space: pre-line;
}

.confirm-check {
  margin-top: 4px;
}
</style>
