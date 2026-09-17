<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { errorText } from '../api/client';
import { validatePassword, validateUsername } from '../shared/policy';
import { loadContent } from '../stores/content';
import { setupRequest } from '../stores/session';
import { toastSuccess } from '../stores/ui';

const router = useRouter();

const initSecret = ref('');
const username = ref('');
const password = ref('');
const confirmPassword = ref('');
const error = ref('');
const busy = ref(false);

const passwordHint = computed(() => validatePassword(password.value, username.value));
const usernameHint = computed(() => (username.value ? validateUsername(username.value) : null));
const confirmHint = computed(() =>
  confirmPassword.value && confirmPassword.value !== password.value ? '两次输入的密码不一致' : null,
);

async function submit(): Promise<void> {
  if (busy.value) return;
  error.value = '';
  if (usernameHint.value) {
    error.value = usernameHint.value;
    return;
  }
  if (passwordHint.value) {
    error.value = passwordHint.value;
    return;
  }
  if (password.value !== confirmPassword.value) {
    error.value = '两次输入的密码不一致';
    return;
  }
  busy.value = true;
  try {
    await setupRequest(initSecret.value.trim(), username.value.trim(), password.value);
    await loadContent();
    toastSuccess('初始化完成，欢迎使用星屿导航');
    await router.replace('/');
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
          <h1>初始化星屿导航</h1>
          <p class="muted">该向导只能执行一次，请设置管理员账户</p>
        </div>
      </div>

      <form class="auth-form" @submit.prevent="submit">
        <label class="field">
          <span>部署初始化密钥（INIT_SECRET）</span>
          <input v-model="initSecret" class="input" type="password" autocomplete="off" required />
          <span class="field-hint">由部署者在 Cloudflare 控制台或 wrangler 中以加密变量配置。</span>
        </label>
        <label class="field">
          <span>管理员用户名</span>
          <input v-model="username" class="input" type="text" autocomplete="username" required />
          <span v-if="usernameHint" class="field-error">{{ usernameHint }}</span>
        </label>
        <label class="field">
          <span>密码</span>
          <input v-model="password" class="input" type="password" autocomplete="new-password" required />
          <span class="field-hint">至少 10 位，并包含大小写字母、数字、符号中的两类。</span>
          <span v-if="passwordHint && password" class="field-error">{{ passwordHint }}</span>
        </label>
        <label class="field">
          <span>确认密码</span>
          <input v-model="confirmPassword" class="input" type="password" autocomplete="new-password" required />
          <span v-if="confirmHint" class="field-error">{{ confirmHint }}</span>
        </label>

        <p v-if="error" class="form-error" role="alert">{{ error }}</p>

        <button type="submit" class="btn btn-primary auth-submit" :disabled="busy">
          {{ busy ? '初始化中…' : '完成初始化' }}
        </button>
      </form>

      <p class="auth-foot muted">初始化密钥只在服务端校验，绝不会进入前端构建产物。</p>
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
  width: min(460px, 100%);
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
  font-size: 1.18rem;
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

.field-error {
  color: var(--danger);
  font-size: 0.8rem;
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
