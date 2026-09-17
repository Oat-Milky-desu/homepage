import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router';
import { bootstrapSession, reportActivity } from './stores/session';
import './styles/main.css';

async function start(): Promise<void> {
  const app = createApp(App);
  // 先确定初始化/登录状态，再安装路由：
  // 否则首次导航会在状态未知时通过守卫，把未登录用户留在首页。
  try {
    const status = await bootstrapSession();
    if (status?.authenticated) {
      // 已认证的页面访问显式上报活动，顺延七天会话（不使用定时器轮询）
      void reportActivity();
    }
  } catch {
    // bootstrapSession 内部已保存错误状态，App 会显示可重试的错误页
  }
  app.use(router);
  await router.isReady();
  app.mount('#app');
}

void start();
