import type { AppSettings, CardSize, SearchEngine, Theme } from './types';
import { bool, num, object, oneOf, parseObject, str, httpUrl, type Field } from './validate';
import { CARD_SIZE_VALUES, SEARCH_ENGINE_VALUES, THEME_VALUES } from './search-engines';

export const DEFAULT_SETTINGS: AppSettings = {
  siteTitle: '星屿导航',
  siteSubtitle: '我的私人导航站',
  wallpaperUrl: '',
  overlayOpacity: 0.45,
  cardOpacity: 0.6,
  cardSize: 'cozy',
  theme: 'dark',
  searchEngine: 'baidu',
  clockShowSeconds: true,
  glassBlur: 14,
};

const settingsShape = {
  siteTitle: str({ min: 1, max: 40, label: '站点标题' }),
  siteSubtitle: str({ min: 0, max: 80, label: '站点副标题' }),
  wallpaperUrl: httpUrl({ allowEmpty: true, label: '壁纸地址' }),
  overlayOpacity: num({ min: 0, max: 0.9, label: '遮罩不透明度' }),
  cardOpacity: num({ min: 0.05, max: 1, label: '卡片不透明度' }),
  cardSize: oneOf<CardSize>(CARD_SIZE_VALUES, '卡片尺寸'),
  theme: oneOf<Theme>(THEME_VALUES, '主题'),
  searchEngine: oneOf<SearchEngine>(SEARCH_ENGINE_VALUES, '默认搜索引擎'),
  clockShowSeconds: bool('时钟秒数开关'),
  glassBlur: num({ min: 0, max: 30, label: '模糊强度' }),
} satisfies Record<keyof AppSettings, Field<unknown>>;

export const settingsField: Field<AppSettings> = object(settingsShape, { label: '站点设置' }) as Field<AppSettings>;

/** 严格校验用户提交的设置（拒绝未知字段） */
export function parseSettings(value: unknown): AppSettings {
  return parseObject(settingsShape, value) as AppSettings;
}

/**
 * 宽松合并：仅取已知字段，缺失字段回退默认值。
 * 用于读取数据库中的历史设置，避免旧版本数据导致页面崩溃。
 */
export function coerceSettings(value: unknown): AppSettings {
  const source = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(settingsShape) as (keyof AppSettings)[]) {
    if (source[key] !== undefined) merged[key] = source[key];
  }
  try {
    return parseSettings(merged);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
