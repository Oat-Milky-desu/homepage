<script setup lang="ts">
import { SEARCH_ENGINES } from '../../shared/search-engines';
import type { AppSettings, SearchEngine } from '../../shared/types';

defineProps<{ settings: AppSettings }>();

const emit = defineEmits<{ (event: 'update', patch: Partial<AppSettings>): void }>();

function text(event: Event): string {
  return (event.target as HTMLInputElement).value;
}
</script>

<template>
  <div class="stack">
    <label class="field">
      <span>站点标题</span>
      <input class="input" type="text" maxlength="40" :value="settings.siteTitle" @input="emit('update', { siteTitle: text($event) })" />
      <span class="field-hint">显示在首页顶部和浏览器标签上。</span>
    </label>

    <label class="field">
      <span>副标题</span>
      <input
        class="input"
        type="text"
        maxlength="80"
        :value="settings.siteSubtitle"
        placeholder="例如：我的私人导航站"
        @input="emit('update', { siteSubtitle: text($event) })"
      />
    </label>

    <div class="field">
      <span>默认搜索引擎</span>
      <div class="row" role="radiogroup" aria-label="默认搜索引擎">
        <label v-for="engine in SEARCH_ENGINES" :key="engine.value" class="option-chip">
          <input
            type="radio"
            name="search-engine"
            :value="engine.value"
            :checked="settings.searchEngine === engine.value"
            @change="emit('update', { searchEngine: engine.value as SearchEngine })"
          />
          <span>{{ engine.label }}</span>
        </label>
      </div>
      <span class="field-hint">首页搜索框优先使用该引擎打开外部搜索。</span>
    </div>

    <label class="checkbox-row">
      <input
        type="checkbox"
        :checked="settings.clockShowSeconds"
        @change="emit('update', { clockShowSeconds: ($event.target as HTMLInputElement).checked })"
      />
      <span>时钟显示秒数</span>
    </label>
  </div>
</template>

<style scoped>
.option-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  border: 1px solid var(--border);
  border-radius: 999px;
  cursor: pointer;
  font-size: 0.88rem;
}

.option-chip:has(input:checked) {
  border-color: var(--accent);
  background: var(--accent-soft);
}
</style>
