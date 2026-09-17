<script setup lang="ts">
import { computed, ref } from 'vue';
import { hostOf } from '../shared/url';
import type { NavLink } from '../shared/types';
import IconView from './IconView.vue';

const props = defineProps<{
  link: NavLink;
  index: number;
  editing: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
}>();

const emit = defineEmits<{
  (event: 'edit'): void;
  (event: 'remove'): void;
  (event: 'move', offset: number): void;
  (event: 'dragstart', payload: DragEvent): void;
  (event: 'dragend'): void;
  (event: 'drop', index: number): void;
}>();

const dropSide = ref<'before' | 'after' | null>(null);
const host = computed(() => hostOf(props.link.url));
const description = computed(() => props.link.description || host.value);

function onDragOver(event: DragEvent): void {
  if (!props.editing) return;
  event.preventDefault();
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const ratio =
    rect.width >= rect.height
      ? (event.clientX - rect.left) / Math.max(rect.width, 1)
      : (event.clientY - rect.top) / Math.max(rect.height, 1);
  dropSide.value = ratio < 0.5 ? 'before' : 'after';
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
}

function onDrop(event: DragEvent): void {
  if (!props.editing) return;
  event.preventDefault();
  const side = dropSide.value ?? 'after';
  dropSide.value = null;
  emit('drop', side === 'before' ? props.index : props.index + 1);
}

function onDragLeave(): void {
  dropSide.value = null;
}
</script>

<template>
  <article
    class="link-card glass"
    :class="[`drop-${dropSide ?? 'none'}`, { 'is-editing': editing }]"
    :draggable="editing"
    @dragstart="emit('dragstart', $event)"
    @dragend="emit('dragend')"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <a
      v-if="!editing"
      class="link-main"
      :href="link.url"
      :target="link.target"
      :rel="link.target === '_blank' ? 'noopener noreferrer' : undefined"
      :title="link.description || link.url"
    >
      <IconView :name="link.name" :url="link.url" :icon-type="link.iconType" :icon-value="link.iconValue" />
      <span class="link-text">
        <span class="link-name">{{ link.name }}</span>
        <span class="link-desc">{{ description }}</span>
      </span>
    </a>

    <div v-else class="link-main">
      <span class="drag-handle" aria-hidden="true">⠿</span>
      <IconView :name="link.name" :url="link.url" :icon-type="link.iconType" :icon-value="link.iconValue" />
      <span class="link-text">
        <span class="link-name">{{ link.name }}</span>
        <span class="link-desc">{{ description }}</span>
      </span>
    </div>

    <div v-if="editing" class="link-actions">
      <button type="button" class="btn btn-ghost btn-icon" :disabled="!canMoveUp" :aria-label="`把「${link.name}」上移`" title="上移" @click="emit('move', -1)">
        ↑
      </button>
      <button
        type="button"
        class="btn btn-ghost btn-icon"
        :disabled="!canMoveDown"
        :aria-label="`把「${link.name}」下移`"
        title="下移"
        @click="emit('move', 1)"
      >
        ↓
      </button>
      <a
        class="btn btn-ghost btn-icon"
        :href="link.url"
        :target="link.target"
        :rel="link.target === '_blank' ? 'noopener noreferrer' : undefined"
        :aria-label="`打开「${link.name}」`"
        title="打开链接"
      >
        ↗
      </a>
      <button type="button" class="btn btn-ghost btn-icon" :aria-label="`编辑「${link.name}」`" title="编辑" @click="emit('edit')">
        ✎
      </button>
      <button
        type="button"
        class="btn btn-ghost btn-icon btn-danger-text"
        :aria-label="`删除「${link.name}」`"
        title="删除"
        @click="emit('remove')"
      >
        ✕
      </button>
    </div>
  </article>
</template>

<style scoped>
.link-card {
  position: relative;
  display: flex;
  align-items: stretch;
  border-radius: var(--radius-md);
  transition: transform 0.16s ease, border-color 0.16s ease, background 0.16s ease;
}

.link-card:hover {
  transform: translateY(-2px);
  border-color: var(--border-strong);
  background: var(--surface-hover);
}

.link-card.is-editing {
  cursor: grab;
  flex-direction: column;
  align-items: stretch;
}

.link-card.is-editing .link-main {
  padding-bottom: 6px;
}

.link-card.is-editing:active {
  cursor: grabbing;
}

.link-main {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
  padding: var(--card-pad, 16px);
}

.link-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.link-name {
  font-weight: 600;
  font-size: 0.98rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.link-desc {
  color: var(--text-muted);
  font-size: 0.82rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.drag-handle {
  color: var(--text-muted);
  cursor: grab;
  font-size: 1.1rem;
  line-height: 1;
}

.link-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  padding: 0 10px 10px;
}

.btn-danger-text {
  color: var(--danger);
}

.drop-before::after,
.drop-after::after {
  content: '';
  position: absolute;
  top: 6px;
  bottom: 6px;
  width: 3px;
  border-radius: 3px;
  background: var(--accent);
}

.drop-before::after {
  left: -7px;
}

.drop-after::after {
  right: -7px;
}

@media (max-width: 520px) {
  .link-actions {
    flex-wrap: wrap;
  }
}
</style>
