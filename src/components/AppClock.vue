<script setup lang="ts">
import { toRef } from 'vue';
import { useClock } from '../composables/useClock';
import { formatDate, formatTime, formatWeekday, greetingOf } from '../utils/format';

const props = defineProps<{ showSeconds: boolean }>();

const now = useClock(toRef(props, 'showSeconds'));
</script>

<template>
  <div class="clock">
    <p class="clock-greeting">{{ greetingOf(now) }}</p>
    <p class="clock-time">{{ formatTime(now, showSeconds) }}</p>
    <p class="clock-date">{{ formatDate(now) }} · {{ formatWeekday(now) }}</p>
  </div>
</template>

<style scoped>
.clock {
  text-align: center;
}

.clock-greeting {
  margin: 0 0 2px;
  color: var(--text-muted);
  font-size: 0.92rem;
  letter-spacing: 0.08em;
}

.clock-time {
  margin: 0;
  font-size: clamp(2.6rem, 7vw, 4.4rem);
  font-weight: 300;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.04em;
  line-height: 1.05;
  text-shadow: 0 10px 32px rgba(0, 0, 0, 0.35);
}

.clock-date {
  margin: 6px 0 0;
  color: var(--text-muted);
  font-size: 0.95rem;
}
</style>
