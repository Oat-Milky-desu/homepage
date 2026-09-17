import { createRouter, createWebHistory } from 'vue-router';
import { sessionState } from './stores/session';
import HomeView from './views/HomeView.vue';
import LoginView from './views/LoginView.vue';
import SetupView from './views/SetupView.vue';
import AdminView from './views/AdminView.vue';
import NotFoundView from './views/NotFoundView.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: HomeView, meta: { requiresAuth: true } },
    { path: '/admin', name: 'admin', component: AdminView, meta: { requiresAuth: true } },
    { path: '/login', name: 'login', component: LoginView },
    { path: '/setup', name: 'setup', component: SetupView },
    { path: '/:pathMatch(.*)*', name: 'not-found', component: NotFoundView },
  ],
  scrollBehavior: () => ({ top: 0 }),
});

router.beforeEach((to) => {
  if (!sessionState.ready) return true;
  if (sessionState.setupRequired) {
    return to.name === 'setup' ? true : { name: 'setup' };
  }
  if (to.name === 'setup') {
    return { name: sessionState.authenticated ? 'home' : 'login' };
  }
  if (to.meta.requiresAuth && !sessionState.authenticated) {
    return { name: 'login', query: to.fullPath === '/' ? {} : { redirect: to.fullPath } };
  }
  if (to.name === 'login' && sessionState.authenticated) {
    return { name: 'home' };
  }
  return true;
});
