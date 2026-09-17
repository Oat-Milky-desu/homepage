<script setup lang="ts">
import { CARD_SIZES, THEMES } from '../../shared/search-engines';
import type { AppSettings } from '../../shared/types';

defineProps<{ settings: AppSettings }>();

const emit = defineEmits<{ (event: 'update', patch: Partial<AppSettings>): void }>();

function text(event: Event): string {
  return (event.target as HTMLInputElement).value;
}

function number(event: Event): number {
  return Number((event.target as HTMLInputElement).value);
}
</script>

<template>
  <div class="stack">
    <div class="field">
      <span>主题</span>
      <div class="row" role="radiogroup" aria-label="主题">
        <label v-for="theme in THEMES" :key="theme.value" class="option-chip">
          <input
            type="radio"
            name="theme"
            :value="theme.value"
            :checked="settings.theme === theme.value"
            @change="emit('update', { theme: theme.value })"
          />
          <span>{{ theme.label }}</span>
        </label>
      </div>
    </div>

    <label class="field">
      <span>壁纸地址（可选）</span>
      <input
        class="input"
        type="url"
        inputmode="url"
        maxlength="2048"
        :value="settings.wallpaperUrl"
        placeholder="https://example.com/wallpaper.jpg（留空使用内置渐变背景）"
        @input="emit('update', { wallpaperUrl: text($event) })"
      />
      <span class="field-hint">支持任意 http(s) 图片地址，不会上传或代理任何文件。</span>
    </label>

    <label class="field">
      <span>壁纸遮罩不透明度：{{ Math.round(settings.overlayOpacity * 100) }}%</span>
      <input
        type="range"
        min="0"
        max="0.9"
        step="0.05"
        :value="settings.overlayOpacity"
        @input="emit('update', { overlayOpacity: number($event) })"
      />
      <span class="field-hint">数值越大，壁纸越暗、文字越清晰。</span>
    </label>

    <label class="field">
      <span>卡片不透明度：{{ Math.round(settings.cardOpacity * 100) }}%</span>
      <input
        type="range"
        min="0.05"
        max="1"
        step="0.05"
        :value="settings.cardOpacity"
        @input="emit('update', { cardOpacity: number($event) })"
      />
    </label>

    <label class="field">
      <span>毛玻璃模糊：{{ settings.glassBlur }}px</span>
      <input
        type="range"
        min="0"
        max="30"
        step="1"
        :value="settings.glassBlur"
        @input="emit('update', { glassBlur: number($event) })"
      />
    </label>

    <label class="field">
      <span>卡片尺寸</span>
      <select class="select" :value="settings.cardSize" @change="emit('update', { cardSize: ($event.target as HTMLSelectElement).value as AppSettings['cardSize'] })">
        <option v-for="size in CARD_SIZES" :key="size.value" :value="size.value">
          {{ size.label }}{{ size.hint ? ` — ${size.hint}` : '' }}
        </option>
      </select>
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
