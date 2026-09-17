import type { CardSize, SearchEngine, Theme } from './types';

export interface SearchEngineOption {
  value: SearchEngine;
  label: string;
  buildUrl: (query: string) => string;
}

export const SEARCH_ENGINES: SearchEngineOption[] = [
  { value: 'baidu', label: '百度', buildUrl: (query) => `https://www.baidu.com/s?wd=${encodeURIComponent(query)}` },
  { value: 'google', label: 'Google', buildUrl: (query) => `https://www.google.com/search?q=${encodeURIComponent(query)}` },
  { value: 'bing', label: 'Bing', buildUrl: (query) => `https://www.bing.com/search?q=${encodeURIComponent(query)}` },
];

export function searchEngineOf(value: SearchEngine): SearchEngineOption {
  return SEARCH_ENGINES.find((engine) => engine.value === value) ?? SEARCH_ENGINES[0]!;
}

export interface ChoiceOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

export const CARD_SIZES: ChoiceOption<CardSize>[] = [
  { value: 'compact', label: '紧凑', hint: '更多卡片，适合大屏' },
  { value: 'cozy', label: '标准', hint: '默认密度' },
  { value: 'comfortable', label: '宽松', hint: '更大的图标与间距' },
];

export const THEMES: ChoiceOption<Theme>[] = [
  { value: 'dark', label: '深色' },
  { value: 'light', label: '浅色' },
];

export const CARD_SIZE_VALUES: readonly CardSize[] = ['compact', 'cozy', 'comfortable'];
export const THEME_VALUES: readonly Theme[] = ['dark', 'light'];
export const SEARCH_ENGINE_VALUES: readonly SearchEngine[] = ['baidu', 'google', 'bing'];
