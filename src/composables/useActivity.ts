import { loadContent } from '../stores/content';
import { reportActivity, sessionState } from '../stores/session';

/** 同一设备上两次活动上报的最小间隔 */
const ACTIVITY_THROTTLE_MS = 5 * 60 * 1000;
/** 重新可见时，内容超过该时长则刷新（多设备同步）；内容刷新本身不会续期会话 */
const CONTENT_REFRESH_MS = 60 * 1000;

/**
 * 会话续期只由真实的用户操作触发（点击 / 键盘 / 页面重新可见），
 * 不使用定时器轮询；初始页面访问的续期由 main.ts 在探测到已登录后触发。
 */
export function setupActivityTracking(): void {
  let lastActivity = 0;
  let lastContentLoad = Date.now();

  const sendActivity = () => {
    if (!sessionState.authenticated || document.visibilityState !== 'visible') return;
    const now = Date.now();
    if (now - lastActivity < ACTIVITY_THROTTLE_MS) return;
    lastActivity = now;
    void reportActivity();
  };

  const onPointerDown = () => sendActivity();
  const onKeyDown = () => sendActivity();

  const onVisibility = () => {
    if (document.visibilityState !== 'visible') return;
    sendActivity();
    if (Date.now() - lastContentLoad > CONTENT_REFRESH_MS && sessionState.authenticated) {
      lastContentLoad = Date.now();
      void loadContent({ silent: true });
    }
  };

  window.addEventListener('pointerdown', onPointerDown, { passive: true });
  window.addEventListener('keydown', onKeyDown);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('focus', onVisibility);
}
