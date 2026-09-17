import { describe, expect, it } from 'vitest';
import { colorFromString, dedupeKey, faviconUrlFor, hostOf, initialOf, normalizeHttpUrl } from '../../src/shared/url';
import { DEFAULT_SETTINGS, coerceSettings, parseSettings } from '../../src/shared/settings';
import { BACKUP_FORMAT, parseBackup } from '../../src/shared/backup';
import type { BackupFile } from '../../src/shared/types';

describe('URL 工具', () => {
  it('规范化地址用于去重与保存', () => {
    expect(normalizeHttpUrl('example.com')).toBe('https://example.com');
    expect(normalizeHttpUrl('https://Example.COM/')).toBe('https://example.com');
    expect(normalizeHttpUrl('https://example.com:443/a#hash')).toBe('https://example.com/a#hash');
    expect(normalizeHttpUrl('https://example.com/folder/')).toBe('https://example.com/folder/');
    expect(normalizeHttpUrl('http://example.com:80/')).toBe('http://example.com');
    expect(normalizeHttpUrl('  https://example.com/a?b=1  ')).toBe('https://example.com/a?b=1');
    expect(normalizeHttpUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeHttpUrl('data:text/plain,hi')).toBeNull();
    expect(normalizeHttpUrl('')).toBeNull();
  });

  it('去重键忽略大小写主机与结尾斜杠', () => {
    expect(dedupeKey('https://Example.com/')).toBe(dedupeKey('https://example.com'));
    expect(dedupeKey('https://example.com/a')).toBe(dedupeKey('https://example.com/a'));
    expect(dedupeKey('https://example.com/a?x=1')).not.toBe(dedupeKey('https://example.com/a'));
  });

  it('favicon 与首字母回退', () => {
    expect(faviconUrlFor('https://sub.example.com/a/b')).toBe('https://sub.example.com/favicon.ico');
    expect(faviconUrlFor('not a url')).toBe('');
    expect(hostOf('https://example.com:8443/x')).toBe('example.com:8443');
    expect(initialOf('星屿导航')).toBe('星');
    expect(initialOf('   ')).toBe('#');
    expect(initialOf('🚀 火箭')).toBe('🚀');
    expect(colorFromString('abc')).toBe(colorFromString('abc'));
    expect(colorFromString('abc')).not.toBe(colorFromString('xyz'));
  });
});

describe('站点设置', () => {
  it('严格校验完整设置', () => {
    expect(parseSettings(DEFAULT_SETTINGS).siteTitle).toBe('星屿导航');
    expect(() => parseSettings({ ...DEFAULT_SETTINGS, overlayOpacity: 2 })).toThrowError(/不能大于/);
    expect(() => parseSettings({ ...DEFAULT_SETTINGS, injected: true })).toThrowError(/未知字段/);
    expect(() => parseSettings({ ...DEFAULT_SETTINGS, wallpaperUrl: 'javascript:alert(1)' })).toThrowError();
  });

  it('读取历史数据时回退默认值', () => {
    const coerced = coerceSettings({ siteTitle: '自定义' });
    expect(coerced.siteTitle).toBe('自定义');
    expect(coerced.cardSize).toBe(DEFAULT_SETTINGS.cardSize);
    expect(coerceSettings({ cardSize: '不存在' }).cardSize).toBe(DEFAULT_SETTINGS.cardSize);
    expect(coerceSettings(null)).toEqual(DEFAULT_SETTINGS);
  });
});

function makeBackup(overrides: Partial<BackupFile> = {}): unknown {
  const base: BackupFile = {
    format: BACKUP_FORMAT,
    version: 1,
    exportedAt: '2026-03-01T00:00:00.000Z',
    settings: { ...DEFAULT_SETTINGS },
    groups: [
      { id: 'g_one', name: '分组一', position: 0, collapsed: false, createdAt: '2026-03-01T00:00:00.000Z', updatedAt: '2026-03-01T00:00:00.000Z' },
    ],
    links: [
      {
        id: 'l_one',
        groupId: 'g_one',
        name: '链接',
        url: 'https://example.com',
        description: '',
        iconType: 'builtin',
        iconValue: 'star',
        target: '_blank',
        position: 0,
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-01T00:00:00.000Z',
      },
    ],
  };
  return { ...base, ...overrides };
}

describe('备份文件校验', () => {
  it('接受合法备份文件', () => {
    const parsed = parseBackup(makeBackup());
    expect(parsed.groups).toHaveLength(1);
    expect(parsed.links[0]!.iconValue).toBe('star');
  });

  it('拒绝悬空引用、重复 ID 与未知图标', () => {
    expect(() => parseBackup(makeBackup({ links: [{ ...(makeBackup() as BackupFile).links[0]!, groupId: 'g_missing' }] }))).toThrowError(
      /不存在的分组/,
    );
    const link = (makeBackup() as BackupFile).links[0]!;
    expect(() => parseBackup(makeBackup({ links: [link, link] }))).toThrowError(/重复/);
    expect(() => parseBackup(makeBackup({ links: [{ ...link, iconValue: 'nope' }] }))).toThrowError(/未知的内置图标/);
  });

  it('拒绝错误格式、版本与危险协议', () => {
    expect(() => parseBackup(makeBackup({ format: 'other' as BackupFile['format'] }))).toThrow();
    expect(() => parseBackup(makeBackup({ version: 2 as 1 }))).toThrow();
    const link = (makeBackup() as BackupFile).links[0]!;
    expect(() => parseBackup(makeBackup({ links: [{ ...link, url: 'javascript:alert(1)' }] }))).toThrow();
  });
});
