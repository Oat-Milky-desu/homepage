<script setup lang="ts">
import { dismissToast, uiState } from '../stores/ui';
</script>

<template>
  <ul class="toast-host" aria-live="polite" aria-atomic="false">
    <li v-for="toast in uiState.toasts" :key="toast.id" class="toast glass" :class="`toast-${toast.type}`">
      <span class="toast-message">{{ toast.message }}</span>
      <button type="button" class="btn btn-ghost btn-icon" aria-label="关闭提示" @click="dismissToast(toast.id)">×</button>
    </li>
  </ul>
</template>

<style scoped>
.toast-host {
  position: fixed;
  right: clamp(12px, 3vw, 28px);
  bottom: clamp(12px, 3vw, 28px);
  z-index: 60;
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
  max-width: min(420px, calc(100vw - 32px));
}

.toast {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 14px;
  border-radius: var(--radius-md);
  background: var(--surface-strong);
  box-shadow: var(--shadow-lg);
  animation: toast-in 0.22s ease;
}

.toast-message {
  flex: 1;
  font-size: 0.9rem;
}

.toast-success {
  border-color: rgba(78, 224, 181, 0.5);
}

.toast-error {
  border-color: rgba(255, 128, 128, 0.55);
}

@keyframes toast-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@media (max-width: 640px) {
  .toast-host {
    left: 12px;
    right: 12px;
    max-width: none;
  }
}
</style>
