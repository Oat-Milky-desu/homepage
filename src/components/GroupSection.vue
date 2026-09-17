<script setup lang="ts">
import { ref } from 'vue';
import type { NavGroup, NavLink } from '../shared/types';
import { beginDrag, beginGroupDrag, dragState, endDrag, endGroupDrag } from '../stores/content';
import LinkCard from './LinkCard.vue';

const props = defineProps<{
  group: NavGroup;
  index: number;
  total: number;
  editing: boolean;
}>();

const emit = defineEmits<{
  (event: 'toggle', collapsed: boolean): void;
  (event: 'moveGroup', offset: number): void;
  (event: 'dropGroup', groupId: string, targetIndex: number): void;
  (event: 'rename'): void;
  (event: 'remove'): void;
  (event: 'addLink'): void;
  (event: 'editLink', link: NavLink): void;
  (event: 'removeLink', link: NavLink): void;
  (event: 'moveLink', linkId: string, offset: number): void;
  (event: 'dropLink', linkId: string, index: number): void;
}>();

const containerActive = ref(false);
const groupDropSide = ref<'before' | 'after' | null>(null);

function onCardDrop(index: number): void {
  const linkId = dragState.linkId;
  endDrag();
  if (linkId) emit('dropLink', linkId, index);
}

function onContainerDragOver(event: DragEvent): void {
  if (!props.editing || !dragState.linkId) return;
  event.preventDefault();
  containerActive.value = true;
}

function onContainerDrop(event: DragEvent): void {
  if (!props.editing || !dragState.linkId) return;
  event.preventDefault();
  containerActive.value = false;
  const linkId = dragState.linkId;
  endDrag();
  emit('dropLink', linkId, props.group.links.length);
}

function onContainerDragLeave(event: DragEvent): void {
  const related = event.relatedTarget as Node | null;
  if (related && (event.currentTarget as HTMLElement).contains(related)) return;
  containerActive.value = false;
}

function onDragStart(event: DragEvent, link: NavLink): void {
  beginDrag(link);
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', link.id);
  }
}

/* --------------------------- 分组拖拽排序 --------------------------- */

function onGroupDragStart(event: DragEvent): void {
  beginGroupDrag(props.group.id);
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', props.group.id);
  }
}

function onGroupDragOver(event: DragEvent): void {
  if (!props.editing || !dragState.groupId || dragState.groupId === props.group.id) return;
  event.preventDefault();
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  groupDropSide.value = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
}

function onGroupDrop(event: DragEvent): void {
  if (!props.editing || !dragState.groupId || dragState.groupId === props.group.id) return;
  event.preventDefault();
  const from = dragState.groupId;
  const side = groupDropSide.value ?? 'after';
  groupDropSide.value = null;
  endGroupDrag();
  emit('dropGroup', from, side === 'before' ? props.index : props.index + 1);
}

function onGroupDragEnd(): void {
  groupDropSide.value = null;
  endGroupDrag();
}
</script>

<template>
  <section
    :id="`group-${group.id}`"
    class="group"
    :class="{
      'group-drop-before': groupDropSide === 'before',
      'group-drop-after': groupDropSide === 'after',
      'group-dragging': dragState.groupId === group.id,
    }"
    :aria-labelledby="`group-title-${group.id}`"
    @dragover="onGroupDragOver"
    @drop="onGroupDrop"
  >
    <header class="group-head">
      <div class="group-heading">
        <span
          v-if="editing"
          class="group-drag-handle"
          draggable="true"
          title="按住拖动以调整分组顺序（也可使用右侧上移 / 下移按钮）"
          aria-hidden="true"
          @dragstart="onGroupDragStart"
          @dragend="onGroupDragEnd"
        >
          ⠿
        </span>
        <button
          type="button"
          class="group-toggle"
          :aria-expanded="!group.collapsed"
          :aria-controls="`group-body-${group.id}`"
          @click="emit('toggle', !group.collapsed)"
        >
          <span class="chevron" :class="{ collapsed: group.collapsed }" aria-hidden="true">▾</span>
          <h2 :id="`group-title-${group.id}`">{{ group.name }}</h2>
          <span class="badge">{{ group.links.length }} 个链接</span>
        </button>
      </div>

      <div v-if="editing" class="group-actions">
        <button
          type="button"
          class="btn btn-ghost btn-icon"
          :disabled="index === 0"
          :aria-label="`把分组「${group.name}」上移`"
          title="分组上移"
          @click="emit('moveGroup', -1)"
        >
          ↑
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-icon"
          :disabled="index === total - 1"
          :aria-label="`把分组「${group.name}」下移`"
          title="分组下移"
          @click="emit('moveGroup', 1)"
        >
          ↓
        </button>
        <button type="button" class="btn btn-sm" @click="emit('addLink')">+ 链接</button>
        <button type="button" class="btn btn-sm" @click="emit('rename')">重命名</button>
        <button type="button" class="btn btn-sm btn-danger" @click="emit('remove')">删除</button>
      </div>
    </header>

    <div
      v-show="!group.collapsed"
      :id="`group-body-${group.id}`"
      class="card-grid"
      :class="{ 'drop-active': containerActive }"
      @dragover="onContainerDragOver"
      @drop="onContainerDrop"
      @dragleave="onContainerDragLeave"
    >
      <LinkCard
        v-for="(link, linkIndex) in group.links"
        :key="link.id"
        :link="link"
        :index="linkIndex"
        :editing="editing"
        :can-move-up="linkIndex > 0"
        :can-move-down="linkIndex < group.links.length - 1"
        @edit="emit('editLink', link)"
        @remove="emit('removeLink', link)"
        @move="(offset) => emit('moveLink', link.id, offset)"
        @dragstart="onDragStart($event, link)"
        @dragend="endDrag()"
        @drop="onCardDrop"
      />

      <button v-if="editing" type="button" class="add-card" @click="emit('addLink')">
        <span aria-hidden="true">＋</span>
        <span>添加链接</span>
      </button>

      <p v-if="group.links.length === 0 && !editing" class="group-empty muted">这个分组还没有链接。</p>
    </div>
  </section>
</template>

<style scoped>
.group {
  position: relative;
  margin-bottom: 30px;
  scroll-margin-top: 96px;
  border-radius: var(--radius-md);
}

.group.group-dragging {
  opacity: 0.55;
}

.group-drop-before::before,
.group-drop-after::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  height: 3px;
  border-radius: 3px;
  background: var(--accent);
}

.group-drop-before::before {
  top: -14px;
}

.group-drop-after::after {
  bottom: -14px;
}

.group-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.group-heading {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.group-drag-handle {
  color: var(--text-muted);
  cursor: grab;
  font-size: 1.1rem;
  padding: 4px 2px;
  user-select: none;
}

.group-drag-handle:active {
  cursor: grabbing;
}

.group-toggle {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px 6px 6px;
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  text-align: left;
}

.group-toggle:hover {
  background: rgba(255, 255, 255, 0.05);
}

.group-toggle h2 {
  margin: 0;
  font-size: 1.08rem;
  font-weight: 600;
}

.chevron {
  display: inline-block;
  color: var(--text-muted);
  transition: transform 0.18s ease;
}

.chevron.collapsed {
  transform: rotate(-90deg);
}

.group-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(var(--card-min, 250px), 1fr));
  gap: 12px;
  border-radius: var(--radius-md);
  transition: background 0.16s ease, box-shadow 0.16s ease;
}

.card-grid.drop-active {
  background: var(--accent-soft);
  box-shadow: inset 0 0 0 1px var(--accent);
}

.group-empty {
  margin: 4px 0;
  font-size: 0.9rem;
}

.add-card {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 76px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.add-card:hover {
  color: var(--text);
  border-color: var(--accent);
  background: var(--accent-soft);
}
</style>
