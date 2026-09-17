import { expect, it } from 'vitest';
import { dedupeKey, normalizeHttpUrl } from '../../src/shared/url';

it('review: 导航网址必须保留 hash 路由和页面锚点', () => {
  expect(normalizeHttpUrl('https://example.com/#/dashboard')).toBe('https://example.com/#/dashboard');
  expect(normalizeHttpUrl('https://example.com/docs/#install')).toBe('https://example.com/docs/#install');
});

it('review: 不同 hash 路由不能作为重复书签丢弃', () => {
  expect(dedupeKey('https://example.com/#/one')).not.toBe(dedupeKey('https://example.com/#/two'));
});

it('review: 有意义的非根路径末尾斜杠不得擅自删除', () => {
  expect(normalizeHttpUrl('https://example.com/folder/')).toBe('https://example.com/folder/');
});
