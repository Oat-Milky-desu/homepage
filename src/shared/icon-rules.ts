import type { IconType } from './types';
import { isBuiltinIconId } from './icons';

/** 校验图标类型与取值是否匹配；返回错误信息或 null */
export function validateIconValue(iconType: IconType, iconValue: string): string | null {
  switch (iconType) {
    case 'builtin':
      if (!iconValue) return '请选择内置图标';
      if (!isBuiltinIconId(iconValue)) return `未知的内置图标：${iconValue}`;
      return null;
    case 'image':
      if (!iconValue) return '请填写自定义图标地址';
      return checkIconUrl(iconValue);
    case 'favicon':
      if (!iconValue) return null;
      return checkIconUrl(iconValue);
    case 'auto':
    default:
      return null;
  }
}

function checkIconUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '图标地址仅支持 http(s)';
    return null;
  } catch {
    return '图标地址不是合法 URL';
  }
}
