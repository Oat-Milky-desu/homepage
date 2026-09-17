<script setup lang="ts">
defineProps<{
  title: string;
  description?: string;
  actionLabel?: string;
}>();
const emit = defineEmits<{ (event: 'action'): void }>();
</script>

<template>
  <div class="empty glass">
    <div class="empty-icon" aria-hidden="true">✧</div>
    <h3>{{ title }}</h3>
    <p v-if="description" class="muted">{{ description }}</p>
    <button v-if="actionLabel" type="button" class="btn btn-primary" @click="emit('action')">
      {{ actionLabel }}
    </button>
  </div>
</template>

<style scoped>
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 48px 24px;
  text-align: center;
}

.empty h3 {
  margin: 0;
  font-size: 1.05rem;
}

.empty p {
  margin: 0;
  max-width: 420px;
}

.empty-icon {
  font-size: 2.2rem;
  color: var(--accent);
}
</style>
