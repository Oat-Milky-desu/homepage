<script setup lang="ts">
import { computed } from 'vue';
import { BUILTIN_ICONS } from '../shared/icons';
import type { IconType } from '../shared/types';
import IconView from './IconView.vue';

const props = defineProps<{
  iconType: IconType;
  iconValue: string;
  name: string;
  url: string;
}>();

const emit = defineEmits<{
  (event: 'update:iconType', value: IconType): void;
  (event: 'update:iconValue', value: string): void;
}>();

const MODES: { value: IconType; label: string; hint: string }[] = [
  { value: 'auto', label: '自动', hint: '使用名称首字母生成占位图标' },
  { value: 'builtin', label: '内置图标', hint: '从内置图标库中选择' },
  { value: 'image', label: '图片地址', hint: '填写 http(s) 图片地址' },
  { value: 'favicon', label: '网站图标', hint: '读取该站点自己的 /favicon.ico' },
];

const activeMode = computed(() => MODES.find((mode) => mode.value === props.iconType) ?? MODES[0]!);

function selectMode(mode: IconType): void {
  emit('update:iconType', mode);
  emit('update:iconValue', '');
}
</script>

<template>
  <div class="icon-picker">
    <div class="icon-picker-head">
      <IconView :name="name" :url="url" :icon-type="iconType" :icon-value="iconValue" size="lg" />
      <div>
        <p class="picker-title">图标预览</p>
        <p class="muted picker-hint">{{ activeMode.hint }}</p>
      </div>
    </div>

    <div class="mode-row" role="group" aria-label="图标类型">
      <button
        v-for="mode in MODES"
        :key="mode.value"
        type="button"
        class="btn btn-sm"
        :class="{ 'mode-active': iconType === mode.value }"
        :aria-pressed="iconType === mode.value"
        @click="selectMode(mode.value)"
      >
        {{ mode.label }}
      </button>
    </div>

    <div v-if="iconType === 'builtin'" class="icon-grid" role="radiogroup" aria-label="内置图标">
      <button
        v-for="icon in BUILTIN_ICONS"
        :key="icon.id"
        type="button"
        class="icon-choice"
        :class="{ selected: iconValue === icon.id }"
        role="radio"
        :aria-checked="iconValue === icon.id"
        :title="icon.label"
        @click="emit('update:iconValue', icon.id)"
      >
        <!-- 图标内容来自 src/shared/icons.ts 的静态常量，且仅能按 ID 取用，不是用户数据 -->
        <!-- eslint-disable vue/no-v-html -->
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.7"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
          v-html="icon.body"
        ></svg>
        <!-- eslint-enable vue/no-v-html -->
        <span class="sr-only">{{ icon.label }}</span>
      </button>
    </div>

    <div v-else-if="iconType === 'image' || iconType === 'favicon'" class="field">
      <label class="field-label" for="icon-url">图标地址</label>
      <input
        id="icon-url"
        class="input"
        :value="iconValue"
        type="url"
        inputmode="url"
        :placeholder="iconType === 'favicon' ? '留空则自动读取站点 favicon' : 'https://example.com/logo.png'"
        @input="emit('update:iconValue', ($event.target as HTMLInputElement).value)"
      />
      <span class="field-hint">仅支持 http:// 或 https:// 地址，加载失败时会自动回退为首字母图标。</span>
    </div>
  </div>
</template>

<style scoped>
.icon-picker {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.icon-picker-head {
  display: flex;
  align-items: center;
  gap: 14px;
}

.picker-title {
  margin: 0;
  font-size: 0.9rem;
}

.picker-hint {
  margin: 2px 0 0;
  font-size: 0.8rem;
}

.mode-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.mode-active {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--text);
}

.icon-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(42px, 1fr));
  gap: 8px;
  max-height: 210px;
  overflow-y: auto;
  padding: 4px;
}

.icon-choice {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 1;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.04);
  cursor: pointer;
  color: var(--text-muted);
}

.icon-choice svg {
  width: 60%;
  height: 60%;
}

.icon-choice:hover {
  color: var(--text);
  border-color: var(--border-strong);
}

.icon-choice.selected {
  color: var(--accent);
  border-color: var(--accent);
  background: var(--accent-soft);
}
</style>
