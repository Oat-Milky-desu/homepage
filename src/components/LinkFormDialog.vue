<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { collectIssues, httpUrl, str } from '../shared/validate';
import { validateIconValue } from '../shared/icon-rules';
import type { IconType, LinkTarget, NavGroup, NavLink } from '../shared/types';
import BaseModal from './BaseModal.vue';
import IconPicker from './IconPicker.vue';

const props = defineProps<{
  open: boolean;
  link: NavLink | null;
  defaultGroupId: string;
  groups: NavGroup[];
  saving: boolean;
  error: string | null;
}>();

const emit = defineEmits<{
  (event: 'close'): void;
  (event: 'submit', payload: {
    groupId: string;
    name: string;
    url: string;
    description: string;
    iconType: IconType;
    iconValue: string;
    target: LinkTarget;
  }): void;
}>();

const nameField = str({ min: 1, max: 120, label: '链接名称' });
const urlField = httpUrl({ max: 2048 });
const descriptionField = str({ min: 0, max: 500, label: '描述' });

interface FormState {
  groupId: string;
  name: string;
  url: string;
  description: string;
  iconType: IconType;
  iconValue: string;
  target: LinkTarget;
}

const form = ref<FormState>(emptyForm());
const fieldErrors = ref<Record<string, string>>({});

function emptyForm(): FormState {
  return {
    groupId: props.defaultGroupId,
    name: '',
    url: '',
    description: '',
    iconType: 'auto',
    iconValue: '',
    target: '_blank',
  };
}

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    fieldErrors.value = {};
    if (props.link) {
      form.value = {
        groupId: props.link.groupId,
        name: props.link.name,
        url: props.link.url,
        description: props.link.description,
        iconType: props.link.iconType,
        iconValue: props.link.iconValue,
        target: props.link.target,
      };
    } else {
      form.value = emptyForm();
    }
  },
  { immediate: true },
);

const isEditing = computed(() => Boolean(props.link));

function firstIssueMessage(field: Parameters<typeof collectIssues>[0], value: unknown, path: string): string | null {
  const result = collectIssues(field, value, path);
  return result.issues[0]?.message ?? null;
}

function validate(): boolean {
  const errors: Record<string, string> = {};
  const nameError = firstIssueMessage(nameField, form.value.name, '链接名称');
  if (nameError) errors.name = nameError;
  const urlError = firstIssueMessage(urlField, form.value.url, '链接地址');
  if (urlError) errors.url = urlError;
  const descriptionError = firstIssueMessage(descriptionField, form.value.description, '描述');
  if (descriptionError) errors.description = descriptionError;
  const iconError = validateIconValue(form.value.iconType, form.value.iconValue);
  if (iconError) errors.icon = iconError;
  if (!props.groups.some((group) => group.id === form.value.groupId)) errors.groupId = '请选择所属分组';
  fieldErrors.value = errors;
  return Object.keys(errors).length === 0;
}

function onSubmit(): void {
  if (!validate()) return;
  emit('submit', { ...form.value });
}
</script>

<template>
  <BaseModal
    :open="open"
    :title="isEditing ? '编辑链接' : '添加链接'"
    description="名称与地址为必填项，图标可以稍后再调整。"
    wide
    @close="emit('close')"
  >
    <form id="link-form" class="link-form" @submit.prevent="onSubmit">
      <div class="grid-two">
        <label class="field">
          <span>链接名称 *</span>
          <input
            v-model="form.name"
            class="input"
            type="text"
            maxlength="120"
            required
            :aria-invalid="Boolean(fieldErrors.name)"
            placeholder="例如：GitHub"
          />
          <span v-if="fieldErrors.name" class="field-error">{{ fieldErrors.name }}</span>
        </label>
        <label class="field">
          <span>所属分组 *</span>
          <select v-model="form.groupId" class="select" :aria-invalid="Boolean(fieldErrors.groupId)">
            <option v-for="group in groups" :key="group.id" :value="group.id">{{ group.name }}</option>
          </select>
          <span v-if="fieldErrors.groupId" class="field-error">{{ fieldErrors.groupId }}</span>
        </label>
      </div>

      <label class="field">
        <span>链接地址 *</span>
        <input
          v-model="form.url"
          class="input"
          type="url"
          inputmode="url"
          maxlength="2048"
          required
          :aria-invalid="Boolean(fieldErrors.url)"
          placeholder="https://example.com"
        />
        <span v-if="fieldErrors.url" class="field-error">{{ fieldErrors.url }}</span>
      </label>

      <label class="field">
        <span>描述</span>
        <textarea v-model="form.description" class="textarea" maxlength="500" placeholder="可选，用于说明这个站点"></textarea>
        <span v-if="fieldErrors.description" class="field-error">{{ fieldErrors.description }}</span>
      </label>

      <div class="field">
        <span>图标</span>
        <IconPicker
          v-model:icon-type="form.iconType"
          v-model:icon-value="form.iconValue"
          :name="form.name"
          :url="form.url"
        />
        <span v-if="fieldErrors.icon" class="field-error">{{ fieldErrors.icon }}</span>
      </div>

      <fieldset class="target-group">
        <legend>打开方式</legend>
        <label class="checkbox-row">
          <input v-model="form.target" type="radio" value="_blank" />
          <span>新标签页打开</span>
        </label>
        <label class="checkbox-row">
          <input v-model="form.target" type="radio" value="_self" />
          <span>当前标签页打开</span>
        </label>
      </fieldset>

      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    </form>

    <template #footer>
      <button type="button" class="btn" @click="emit('close')">取消</button>
      <button type="submit" form="link-form" class="btn btn-primary" :disabled="saving" data-autofocus>
        {{ saving ? '保存中…' : '保存' }}
      </button>
    </template>
  </BaseModal>
</template>

<style scoped>
.link-form {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.grid-two {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.field-error {
  color: var(--danger);
  font-size: 0.8rem;
}

.target-group {
  margin: 4px 0 0;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  display: flex;
  gap: 18px;
  flex-wrap: wrap;
}

.target-group legend {
  padding: 0 6px;
  font-size: 0.85rem;
  color: var(--text-muted);
}

@media (max-width: 640px) {
  .grid-two {
    grid-template-columns: 1fr;
  }
}
</style>
