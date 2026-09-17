import { reactive } from 'vue';

export type ToastType = 'success' | 'error' | 'info';

export interface Toast {
  id: number;
  type: ToastType;
  message: string;
}

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  /** 可选的第三个选项（例如“保存并离开”），未设置时只显示两个按钮 */
  secondaryText?: string;
  danger?: boolean;
  /** 需要用户额外勾选确认（例如级联删除） */
  checkboxLabel?: string;
}

export type ConfirmChoice = 'primary' | 'secondary' | 'cancel';

export interface ConfirmState extends ConfirmOptions {
  resolve: (choice: ConfirmChoice) => void;
}

export const uiState = reactive({
  toasts: [] as Toast[],
  confirm: null as ConfirmState | null,
});

let toastId = 0;

export function showToast(message: string, type: ToastType = 'info', durationMs = 4200): number {
  const id = ++toastId;
  uiState.toasts.push({ id, type, message });
  if (durationMs > 0) {
    window.setTimeout(() => dismissToast(id), durationMs);
  }
  return id;
}

export function toastSuccess(message: string): void {
  showToast(message, 'success');
}

export function toastError(message: string): void {
  showToast(message, 'error', 6000);
}

export function dismissToast(id: number): void {
  const index = uiState.toasts.findIndex((toast) => toast.id === id);
  if (index !== -1) uiState.toasts.splice(index, 1);
}

/** 打开确认框，返回用户实际选择的分支（支持可选的第三个选项） */
export function requestConfirm(options: ConfirmOptions): Promise<ConfirmChoice> {
  return new Promise<ConfirmChoice>((resolve) => {
    uiState.confirm = { ...options, resolve };
  });
}

export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  return requestConfirm(options).then((choice) => choice === 'primary');
}

export function resolveConfirm(choice: ConfirmChoice): void {
  const state = uiState.confirm;
  uiState.confirm = null;
  state?.resolve(choice);
}
