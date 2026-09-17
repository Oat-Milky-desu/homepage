<script setup lang="ts">
import { computed } from 'vue';
import { effectiveSettings } from '../stores/preview';
import { isHttpUrl } from '../shared/url';

const imageUrl = computed(() => {
  const url = effectiveSettings.value.wallpaperUrl.trim();
  return url && isHttpUrl(url) ? url : '';
});
</script>

<template>
  <div class="wallpaper" aria-hidden="true">
    <div class="wallpaper-glow"></div>
    <div v-if="imageUrl" class="wallpaper-image" :style="{ backgroundImage: `url(${imageUrl})` }"></div>
    <div class="wallpaper-overlay"></div>
  </div>
</template>

<style scoped>
.wallpaper {
  position: fixed;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  background:
    radial-gradient(1100px 720px at 10% 4%, rgba(78, 224, 181, 0.22), transparent 62%),
    radial-gradient(900px 640px at 92% 10%, rgba(64, 140, 255, 0.24), transparent 64%),
    radial-gradient(760px 620px at 70% 92%, rgba(129, 91, 255, 0.16), transparent 66%),
    linear-gradient(158deg, var(--bg-deep) 0%, var(--bg-mid) 52%, var(--bg-deep) 100%);
}

.wallpaper-glow {
  position: absolute;
  inset: 0;
  background: radial-gradient(60% 50% at 50% 0%, rgba(255, 255, 255, 0.06), transparent 70%);
}

.wallpaper-image {
  position: absolute;
  inset: 0;
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
}

.wallpaper-overlay {
  position: absolute;
  inset: 0;
  background: var(--bg-deep);
  opacity: var(--overlay-opacity, 0.45);
  transition: opacity 0.3s ease;
}
</style>
