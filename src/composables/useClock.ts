import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue';

/** 实时时钟：仅在页面可见时运行，避免后台无意义刷新 */
export function useClock(showSeconds: Ref<boolean>): Ref<Date> {
  const now = ref(new Date());
  let timer: number | null = null;

  const tick = () => {
    now.value = new Date();
  };

  const stop = () => {
    if (timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
  };

  const start = () => {
    stop();
    tick();
    timer = window.setInterval(tick, showSeconds.value ? 1000 : 1000);
  };

  const onVisibility = () => {
    if (document.visibilityState === 'visible') start();
    else stop();
  };

  onMounted(() => {
    start();
    document.addEventListener('visibilitychange', onVisibility);
  });

  onBeforeUnmount(() => {
    stop();
    document.removeEventListener('visibilitychange', onVisibility);
  });

  return now;
}
