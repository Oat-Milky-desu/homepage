import { reactive } from 'vue';
import { ApiError, apiRequest, bumpSessionEpoch, errorText, getSessionEpoch, setCsrfToken, setSessionExpiredHandler } from '../api/client';
import type { PasswordChangeResponse, StatusResponse } from '../shared/types';
import { contentState, loadContent, resetContentState } from './content';
import { clearPreview } from './preview';
import { showToast } from './ui';

export const sessionState = reactive({
  /** 首次状态探测是否完成 */
  ready: false,
  /** 状态探测失败时的错误信息；非空时必须显示可重试的错误页，而不是假装未登录/未初始化 */
  statusError: '',
  setupRequired: true,
  authenticated: false,
  username: '',
  busy: false,
});

/** 统一清理所有私有状态；递增会话代际以丢弃在途响应 */
function clearPrivateState(): void {
  sessionState.authenticated = false;
  sessionState.username = '';
  setCsrfToken(null);
  clearPreview();
  resetContentState();
  bumpSessionEpoch();
}

setSessionExpiredHandler(() => {
  const wasAuthenticated = sessionState.authenticated;
  clearPrivateState();
  if (wasAuthenticated) {
    showToast('登录状态已过期，请重新登录', 'info');
  }
});

/** 探测初始化 / 登录状态；失败时返回 null 并保存错误信息 */
export async function bootstrapSession(): Promise<StatusResponse | null> {
  sessionState.statusError = '';
  try {
    const status = await apiRequest<StatusResponse>('/api/status', { silentSession: true });
    sessionState.setupRequired = status.setupRequired;
    sessionState.authenticated = status.authenticated;
    sessionState.username = status.user?.username ?? '';
    if (!status.authenticated) {
      // 服务端已明确未认证：清除可能残留的私有数据（标题 / 壁纸 / 分组）
      clearPrivateState();
    }
    return status;
  } catch (error) {
    // 旧代际的状态响应：新的登录 / 登出状态已经生效，不能用它清理或覆盖
    if (error instanceof ApiError && error.code === 'stale_response') return null;
    // 失败时失败关闭：不展示任何可能残留的私有内容，并给出重试入口
    clearPrivateState();
    sessionState.setupRequired = false;
    sessionState.statusError = errorText(error);
    return null;
  } finally {
    sessionState.ready = true;
  }
}

/** 重新探测状态，并在仍然登录时恢复私有内容（用于 bfcache / 标签恢复） */
export async function refreshSessionOnRestore(): Promise<void> {
  const previousEpoch = getSessionEpoch();
  const status = await bootstrapSession();
  if (previousEpoch !== getSessionEpoch() || !status) return;
  if (status.authenticated) {
    await reportActivity();
    if (!contentState.loaded) {
      await loadContent({ silent: true });
    }
  }
}

function applyAuth(status: StatusResponse): void {
  sessionState.statusError = '';
  sessionState.setupRequired = status.setupRequired;
  sessionState.authenticated = status.authenticated;
  sessionState.username = status.user?.username ?? '';
  // 登录 / 初始化成功后进入新的会话代际：
  // 使登录前发出的在途响应（旧状态里可能带有旧 CSRF 或 401）全部失效。
  bumpSessionEpoch();
}

export async function loginRequest(username: string, password: string): Promise<void> {
  sessionState.busy = true;
  try {
    const status = await apiRequest<StatusResponse>('/api/login', { body: { username, password } });
    applyAuth(status);
  } finally {
    sessionState.busy = false;
  }
}

export async function setupRequest(initSecret: string, username: string, password: string): Promise<void> {
  sessionState.busy = true;
  try {
    const status = await apiRequest<StatusResponse>('/api/setup', { body: { initSecret, username, password } });
    applyAuth(status);
  } finally {
    sessionState.busy = false;
  }
}

/**
 * 退出登录：只有服务端确认撤销（或明确返回 401 表示会话已失效）后才清理本地状态。
 * 网络错误 / 5xx 会抛出，由调用方提示用户重试，避免“看着已退出、其实 Cookie 还有效”。
 */
export async function logoutRequest(): Promise<void> {
  try {
    await apiRequest<{ ok: true }>('/api/logout', { method: 'POST', body: {} });
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 401)) {
      throw error;
    }
    // 401 说明服务端会话已经不存在，本地清理即可
  }
  clearPrivateState();
}

/** 修改密码：服务端会撤销包括当前设备在内的全部会话，本地清理后要求重新登录 */
export async function changePasswordRequest(currentPassword: string, newPassword: string): Promise<void> {
  await apiRequest<PasswordChangeResponse>('/api/password', { body: { currentPassword, newPassword } });
  clearPrivateState();
}

/** 显式活动上报：页面访问 / 前台交互触发；会话失效时立即清理私有状态 */
export async function reportActivity(): Promise<void> {
  if (!sessionState.authenticated) return;
  try {
    await apiRequest<{ expiresAt: number }>('/api/session/activity', { method: 'POST', body: {} });
  } catch {
    /* 网络失败时等待下一次用户操作；401 已由 sessionExpiredHandler 处理 */
  }
}
