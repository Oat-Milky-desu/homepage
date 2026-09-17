<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';

const props = defineProps<{
  open: boolean;
  title: string;
  description?: string;
  wide?: boolean;
}>();

const emit = defineEmits<{ (event: 'close'): void }>();

const dialogRef = ref<HTMLElement | null>(null);
let previouslyFocused: HTMLElement | null = null;

watch(
  () => props.open,
  async (open) => {
    if (open) {
      previouslyFocused = (document.activeElement as HTMLElement | null) ?? null;
      await nextTick();
      const target =
        dialogRef.value?.querySelector<HTMLElement>('[data-autofocus]') ??
        dialogRef.value?.querySelector<HTMLElement>('input:not([type="hidden"]), select, textarea, button');
      target?.focus();
    } else {
      previouslyFocused?.focus?.();
      previouslyFocused = null;
    }
  },
);

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.stopPropagation();
    emit('close');
    return;
  }
  if (event.key !== 'Tab' || !dialogRef.value) return;
  const focusables = Array.from(
    dialogRef.value.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => element.offsetParent !== null);
  if (focusables.length === 0) return;
  const first = focusables[0]!;
  const last = focusables[focusables.length - 1]!;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

onBeforeUnmount(() => {
  previouslyFocused?.focus?.();
});
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="modal-backdrop" @mousedown.self="emit('close')" @keydown="onKeydown">
      <section ref="dialogRef" class="modal glass" :class="{ 'modal-wide': wide }" role="dialog" aria-modal="true" :aria-label="title">
        <header class="modal-head">
          <div>
            <h2>{{ title }}</h2>
            <p v-if="description" class="muted modal-desc">{{ description }}</p>
          </div>
          <button type="button" class="btn btn-ghost btn-icon" aria-label="关闭对话框" @click="emit('close')">×</button>
        </header>
        <div class="modal-body">
          <slot />
        </div>
        <footer v-if="$slots.footer" class="modal-foot">
          <slot name="footer" />
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: clamp(12px, 4vw, 32px);
  background: rgba(3, 8, 16, 0.62);
  backdrop-filter: blur(4px);
  overflow-y: auto;
}

.modal {
  width: min(520px, 100%);
  max-height: min(88vh, 900px);
  display: flex;
  flex-direction: column;
  background: var(--surface-strong);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  animation: modal-in 0.18s ease;
}

.modal-wide {
  width: min(760px, 100%);
}

.modal-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 20px 12px;
  border-bottom: 1px solid var(--border);
}

.modal-head h2 {
  margin: 0;
  font-size: 1.06rem;
}

.modal-desc {
  margin: 4px 0 0;
  font-size: 0.85rem;
}

.modal-body {
  padding: 18px 20px;
  overflow-y: auto;
}

.modal-foot {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 20px 18px;
  border-top: 1px solid var(--border);
}

@keyframes modal-in {
  from {
    opacity: 0;
    transform: translateY(10px) scale(0.99);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
</style>
