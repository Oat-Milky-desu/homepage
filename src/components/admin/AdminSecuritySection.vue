<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { errorText } from '../../api/client';
import { validatePassword } from '../../shared/policy';
import { changePasswordRequest } from '../../stores/session';
import { toastSuccess } from '../../stores/ui';

const router = useRouter();
const currentPassword = ref('');
const newPassword = ref('');
const confirmPassword = ref('');
const error = ref('');
const success = ref('');
const busy = ref(false);

const policyHint = computed(() => (newPassword.value ? validatePassword(newPassword.value) : null));

async function submit(): Promise<void> {
  error.value = '';
  success.value = '';
  if (policyHint.value) {
    error.value = policyHint.value;
    return;
  }
  if (newPassword.value !== confirmPassword.value) {
    error.value = '两次输入的新密码不一致';
    return;
  }
  if (newPassword.value === currentPassword.value) {
    error.value = '新密码不能与当前密码相同';
    return;
  }
  busy.value = true;
  try {
    await changePasswordRequest(currentPassword.value, newPassword.value);
    currentPassword.value = '';
    newPassword.value = '';
    confirmPassword.value = '';
    success.value = '密码已更新，所有会话（含当前设备）均已撤销，请重新登录。';
    toastSuccess('密码已更新，请重新登录');
    await router.replace({ name: 'login' });
  } catch (submitError) {
    error.value = errorText(submitError);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="stack">
    <p class="muted section-note">
      修改密码后，包括当前设备在内的全部登录会话都会立即失效，需要使用新密码重新登录。密码使用 PBKDF2-SHA256 加盐哈希后存储。
    </p>

    <form class="stack" @submit.prevent="submit">
      <label class="field">
        <span>当前密码</span>
        <input v-model="currentPassword" class="input" type="password" autocomplete="current-password" required />
      </label>
      <label class="field">
        <span>新密码</span>
        <input v-model="newPassword" class="input" type="password" autocomplete="new-password" required />
        <span class="field-hint">至少 10 位，包含大小写字母、数字、符号中的至少两类。</span>
        <span v-if="policyHint" class="field-error">{{ policyHint }}</span>
      </label>
      <label class="field">
        <span>确认新密码</span>
        <input v-model="confirmPassword" class="input" type="password" autocomplete="new-password" required />
      </label>

      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <p v-if="success" class="form-success" role="status">{{ success }}</p>

      <div class="row">
        <button type="submit" class="btn btn-primary" :disabled="busy">{{ busy ? '提交中…' : '更新密码' }}</button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.section-note {
  margin: 0;
  font-size: 0.88rem;
}

.field-error {
  color: var(--danger);
  font-size: 0.8rem;
}
</style>
