import { computed, reactive } from 'vue';
import type { AppSettings } from '../shared/types';
import { contentState } from './content';

/**
 * 外观“预览”状态与已保存状态严格分离：
 * - 已保存的设置始终保存在 contentState.settings 中；
 * - 管理页草稿只写入 previewState，用于即时预览；
 * - 页面渲染统一读取 effectiveSettings，取消 / 离开管理页时清除预览，
 *   因此未保存的修改绝不会污染全局状态或在其它页面显示。
 */
export const previewState = reactive<{ settings: AppSettings | null }>({
  settings: null,
});

export const effectiveSettings = computed<AppSettings>(() => previewState.settings ?? contentState.settings);

export function setPreview(settings: AppSettings): void {
  previewState.settings = { ...settings };
}

export function clearPreview(): void {
  previewState.settings = null;
}
