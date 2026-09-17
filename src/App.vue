<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, watch } from 'vue';
import { RouterView, useRoute, useRouter } from 'vue-router';
import ConfirmDialog from './components/ConfirmDialog.vue';
import ToastHost from './components/ToastHost.vue';
import WallpaperLayer from './components/WallpaperLayer.vue';
import { setupActivityTracking } from './composables/useActivity';
import { bootstrapSession, refreshSessionOnRestore, sessionState } from './stores/session';
import { effectiveSettings } from './stores/preview';

const route = useRoute();
const router = useRouter();

const CARD_SIZE_VARS = {
  compact: { min: '196px', pad: '12px', icon: '32px' },
  cozy: { min: '248px', pad: '16px', icon: '42px' },
  comfortable: { min: '318px', pad: '20px', icon: '52px' },
} as const;

const retrying = computed(() => !sessionState.ready || sessionState.busy);

/**
 * 外观变量写入 document.documentElement：
 * 这样 --surface / --blur 等派生变量在 :root 层就能解析，teleport 到 body 的对话框同样生效。
 */
function applyAppearance(): void {
  const settings = effectiveSettings.value;
  const root = document.documentElement;
  const size = CARD_SIZE_VARS[settings.cardSize] ?? CARD_SIZE_VARS.cozy;
  root.dataset.theme = settings.theme;
  root.style.setProperty('--card-min', size.min);
  root.style.setProperty('--card-pad', size.pad);
  root.style.setProperty('--icon-size', size.icon);
  root.style.setProperty('--overlay-opacity', String(settings.overlayOpacity));
  root.style.setProperty('--card-opacity', String(settings.cardOpacity));
  root.style.setProperty('--glass-blur', `${settings.glassBlur}px`);
  document.title = settings.siteTitle || '星屿导航';
}

watch(effectiveSettings, applyAppearance, { immediate: true, deep: true });

watch(
  () => [sessionState.authenticated, sessionState.setupRequired, sessionState.ready, sessionState.statusError] as const,
  () => {
    if (!sessionState.ready || sessionState.statusError) return;
    if (sessionState.setupRequired && route.name !== 'setup') {
      void router.replace({ name: 'setup' });
      return;
    }
    if (!sessionState.setupRequired && route.name === 'setup' && !sessionState.authenticated) {
      void router.replace({ name: 'login' });
      return;
    }
    if (!sessionState.authenticated && route.meta.requiresAuth) {
      void router.replace({ name: 'login', query: route.fullPath === '/' ? {} : { redirect: route.fullPath } });
    }
  },
);

async function retryBootstrap(): Promise<void> {
  const status = await bootstrapSession();
  if (!status) return;
  // 重新运行路由守卫，把用户带到正确的页面
  await router.replace(route.fullPath).catch(() => undefined);
}

function onPageShow(event: PageTransitionEvent): void {
  if (!event.persisted) return;
  void refreshSessionOnRestore();
}

onMounted(() => {
  setupActivityTracking();
  window.addEventListener('pageshow', onPageShow);
});

onBeforeUnmount(() => {
  window.removeEventListener('pageshow', onPageShow);
});
</script>

<template>
  <div class="app-shell">
    <a class="skip-link" href="#main-content">跳到主要内容</a>
    <WallpaperLayer />
    <div class="app-main">
      <div v-if="!sessionState.ready" class="boot-state" role="status">
        <div class="boot-card glass">
          <h1>正在连接服务器…</h1>
          <p class="muted">首次加载会探测登录状态。</p>
        </div>
      </div>
      <div v-else-if="sessionState.statusError" class="boot-state" role="alert">
        <div class="boot-card glass">
          <h1>无法连接服务器</h1>
          <p class="muted">{{ sessionState.statusError }}</p>
          <p class="muted boot-hint">请检查网络或稍后重试；你的内容不会因此丢失。</p>
          <button type="button" class="btn btn-primary" :disabled="retrying" @click="retryBootstrap">
            {{ retrying ? '重试中…' : '重新连接' }}
          </button>
        </div>
      </div>
      <RouterView v-else />
    </div>
    <ToastHost />
    <ConfirmDialog />
  </div>
</template>

<style scoped>
.boot-state {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 80vh;
  padding: 24px;
}

.boot-card {
  width: min(440px, 100%);
  padding: 28px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
  background: var(--surface-strong);
}

.boot-card h1 {
  margin: 0;
  font-size: 1.15rem;
}

.boot-card p {
  margin: 0;
}

.boot-hint {
  font-size: 0.85rem;
}

.boot-card .btn {
  margin-top: 6px;
}

/* 确保错误信息可读 */
</style>
