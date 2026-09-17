<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { builtinIcon } from '../shared/icons';
import { colorFromString, faviconUrlFor, initialOf } from '../shared/url';
import type { IconType } from '../shared/types';

const props = defineProps<{
  name: string;
  url: string;
  iconType: IconType;
  iconValue: string;
  size?: 'sm' | 'md' | 'lg';
}>();

const failed = ref(false);

watch(
  () => [props.iconType, props.iconValue, props.url].join('|'),
  () => {
    failed.value = false;
  },
);

const builtin = computed(() => (props.iconType === 'builtin' ? builtinIcon(props.iconValue) : undefined));

const imageSrc = computed(() => {
  if (failed.value) return '';
  if (props.iconType === 'image') return props.iconValue;
  if (props.iconType === 'favicon') return props.iconValue || faviconUrlFor(props.url);
  return '';
});

const initial = computed(() => initialOf(props.name || props.url));
const gradient = computed(() => colorFromString(props.name || props.url));
</script>

<template>
  <span class="icon-view" :class="`icon-${size ?? 'md'}`" aria-hidden="true">
    <img v-if="imageSrc" :src="imageSrc" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" @error="failed = true" />
    <!-- 图标内容来自 src/shared/icons.ts 的静态常量，且仅能按 ID 取用，不是用户数据 -->
    <!-- eslint-disable vue/no-v-html -->
    <svg
      v-else-if="builtin"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      v-html="builtin.body"
    ></svg>
    <!-- eslint-enable vue/no-v-html -->
    <span v-else class="icon-initial" :style="{ background: gradient }">{{ initial }}</span>
  </span>
</template>

<style scoped>
.icon-view {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--icon-size, 42px);
  height: var(--icon-size, 42px);
  flex: 0 0 auto;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--border);
  overflow: hidden;
  color: var(--accent);
}

.icon-sm {
  --icon-size: 30px;
  border-radius: 9px;
}

.icon-lg {
  --icon-size: 58px;
  border-radius: 16px;
}

.icon-view img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.icon-view svg {
  width: 62%;
  height: 62%;
}

.icon-initial {
  width: 100%;
  height: 100%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  color: #04241b;
}
</style>
