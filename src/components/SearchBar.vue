<script setup lang="ts">
import { ref } from 'vue';
import { SEARCH_ENGINES, searchEngineOf } from '../shared/search-engines';
import type { SearchEngine } from '../shared/types';

const props = defineProps<{
  modelValue: string;
  resultCount: number | null;
  engine: SearchEngine;
}>();

const emit = defineEmits<{
  (event: 'update:modelValue', value: string): void;
  (event: 'search'): void;
  (event: 'engine', engine: SearchEngine): void;
}>();

const inputRef = ref<HTMLInputElement | null>(null);

function onSubmit(): void {
  emit('search');
}

function clear(): void {
  emit('update:modelValue', '');
  inputRef.value?.focus();
}

function openEngine(engine: SearchEngine): void {
  const query = props.modelValue.trim();
  if (!query) {
    inputRef.value?.focus();
    return;
  }
  window.open(searchEngineOf(engine).buildUrl(query), '_blank', 'noopener,noreferrer');
  emit('engine', engine);
}
</script>

<template>
  <div class="search">
    <form class="search-box glass" role="search" @submit.prevent="onSubmit">
      <span class="search-icon" aria-hidden="true">⌕</span>
      <label class="sr-only" for="site-search">站内搜索</label>
      <input
        id="site-search"
        ref="inputRef"
        :value="modelValue"
        class="search-input"
        type="search"
        placeholder="搜索收藏、站点或分组，回车查看站内结果"
        autocomplete="off"
        enterkeyhint="search"
        @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      />
      <button v-if="modelValue" type="button" class="btn btn-ghost btn-icon" aria-label="清空搜索" @click="clear">×</button>
    </form>

    <div class="search-engines">
      <span class="muted engines-label">外部搜索</span>
      <button
        v-for="option in SEARCH_ENGINES"
        :key="option.value"
        type="button"
        class="btn btn-sm"
        :aria-label="`使用${option.label}搜索当前关键词`"
        @click="openEngine(option.value)"
      >
        {{ option.label }}
      </button>
      <span v-if="resultCount !== null" class="badge" role="status">
        站内找到 {{ resultCount }} 个结果
      </span>
    </div>
  </div>
</template>

<style scoped>
.search {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.search-box {
  display: flex;
  align-items: center;
  gap: 10px;
  width: min(620px, 100%);
  padding: 6px 8px 6px 16px;
  border-radius: 999px;
}

.search-icon {
  color: var(--text-muted);
  font-size: 1.1rem;
}

.search-input {
  flex: 1;
  min-width: 0;
  padding: 8px 0;
  border: none;
  background: transparent;
  font-size: 1rem;
}

.search-input:focus {
  outline: none;
}

.search-input::-webkit-search-cancel-button {
  appearance: none;
}

.search-engines {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: center;
}

.engines-label {
  font-size: 0.8rem;
}
</style>
