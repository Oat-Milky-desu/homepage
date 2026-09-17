<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { errorText } from '../api/client';
import { loadContent } from '../stores/content';
import { loginRequest } from '../stores/session';
import { toastSuccess } from '../stores/ui';

const router = useRouter();
const route = useRoute();

const username = ref('');
const password = ref('');
const error = ref('');
const busy = ref(false);

async function submit(): Promise<void> {
  if (busy.value) return;
  error.value = '';
  busy.value = true;
  try {
    await loginRequest(username.value.trim(), password.value);
    await loadContent();
    toastSuccess('欢迎回来');
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '';
    await router.replace(redirect.startsWith('/') && !redirect.startsWith('//') ? redirect : '/');
  } catch (submitError) {
    error.value = errorText(submitError);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <main class="auth-page">
    <div class="auth-card glass">
      <div class="auth-brand">
        <span class="brand-mark" aria-hidden="true">星</span>
        <div>
          <h1>星屿导航</h1>
          <p class="muted">私有导航站 · 仅管理员可访问</p>
        </div>
      </div>

      <form class="auth-form" @submit.prevent="submit">
        <label class="field">
          <span>用户名</span>
          <input v-model="username" class="input" type="text" autocomplete="username" required autofocus />
        </label>
        <label class="field">
          <span>密码</span>
          <input v-model="password" class="input" type="password" autocomplete="current-password" required />
        </label>

        <p v-if="error" class="form-error" role="alert">{{ error }}</p>

        <button type="submit" class="btn btn-primary auth-submit" :disabled="busy">
          {{ busy ? '登录中…' : '登录' }}
        </button>
      </form>

      <p class="auth-foot muted">站点没有注册功能；忘记密码需按 README 的重置步骤在服务端重新初始化管理员。</p>
    </div>
  </main>
</template>

<style scoped>
.auth-page {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  min-height: 100dvh;
  padding: 24px;
}

.auth-card {
  width: min(420px, 100%);
  padding: 28px;
  background: var(--surface-strong);
  box-shadow: var(--shadow-lg);
}

.auth-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 22px;
}

.auth-brand h1 {
  margin: 0;
  font-size: 1.2rem;
}

.auth-brand p {
  margin: 2px 0 0;
  font-size: 0.82rem;
}

.brand-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 14px;
  background: linear-gradient(135deg, var(--accent), #3b82f6);
  color: #04241b;
  font-weight: 700;
  font-size: 1.2rem;
}

.auth-submit {
  width: 100%;
  margin-top: 4px;
}

.auth-foot {
  margin: 18px 0 0;
  font-size: 0.8rem;
  text-align: center;
}
</style>
