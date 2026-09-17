import { describe, expect, it } from 'vitest';
import {
  ValidationError,
  bool,
  collectIssues,
  httpUrl,
  list,
  num,
  object,
  oneOf,
  optional,
  parseObject,
  record,
  str,
} from '../../src/shared/validate';
import { validatePassword, validateUsername } from '../../src/shared/policy';

describe('输入校验工具', () => {
  it('字符串会去除首尾空白并检查长度', () => {
    const result = parseObject({ name: str({ min: 2, max: 5 }) }, { name: '  星屿  ' });
    expect(result.name).toBe('星屿');
    expect(() => parseObject({ name: str({ min: 2 }) }, { name: ' a ' })).toThrow(ValidationError);
  });

  it('拒绝未知字段并给出结构化问题', () => {
    const shape = { name: str({ min: 1 }) };
    const result = collectIssues(object(shape), { name: 'ok', role: 'admin' });
    expect(result.issues[0]?.message).toContain('未知字段');
    expect(() => parseObject(shape, { name: 'ok', extra: 1 })).toThrowError(/未知字段/);
  });

  it('optional 与 withDefault 的缺省语义不同', () => {
    const shape = {
      required: str({ min: 1 }),
      maybe: optional(str({ min: 1 })),
      fallback: str({ min: 0 }).withDefault('默认值'),
    };
    const result = parseObject(shape, { required: 'x' });
    expect(result.maybe).toBeUndefined();
    expect(result.fallback).toBe('默认值');

    const provided = parseObject(shape, { required: 'x', maybe: 'y', fallback: 'z' });
    expect(provided.maybe).toBe('y');
    expect(provided.fallback).toBe('z');
  });

  it('列表与映射逐项校验', () => {
    const shape = {
      items: list(str({ min: 1, max: 10 }), { max: 2 }),
      map: record(num({ min: 0, integer: true }), { maxKeys: 2 }),
    };
    expect(parseObject(shape, { items: ['a', 'b'], map: { x: 1 } })).toEqual({ items: ['a', 'b'], map: { x: 1 } });
    expect(() => parseObject(shape, { items: ['a', 'b', 'c'], map: {} })).toThrowError(/最多允许 2 项/);
    expect(() => parseObject(shape, { items: ['a'], map: { x: 1.5 } })).toThrowError(/整数/);
  });

  it('URL 校验只接受 http(s)', () => {
    const field = httpUrl();
    for (const valid of ['https://example.com/a?b=1', 'http://192.168.1.10:8080', 'http://localhost:5173/x', 'https://例子.中国']) {
      expect(collectIssues(field, valid).issues).toHaveLength(0);
    }
    for (const invalid of ['javascript:alert(1)', 'data:text/html,<b>x</b>', 'ftp://example.com', 'example.com', '/relative', 'https://']) {
      expect(collectIssues(field, invalid).issues.length, invalid).toBeGreaterThan(0);
    }
    const optionalUrl = httpUrl({ allowEmpty: true });
    expect(collectIssues(optionalUrl, '').issues).toHaveLength(0);
  });

  it('枚举与布尔值校验', () => {
    const shape = { theme: oneOf(['dark', 'light'] as const), enabled: bool() };
    expect(parseObject(shape, { theme: 'dark', enabled: true })).toEqual({ theme: 'dark', enabled: true });
    expect(() => parseObject(shape, { theme: 'blue', enabled: true })).toThrowError(/只能是/);
    expect(() => parseObject(shape, { theme: 'dark', enabled: 'yes' })).toThrowError(/布尔值/);
  });
});

describe('账户与口令策略', () => {
  it('用户名校验', () => {
    expect(validateUsername('admin')).toBeNull();
    expect(validateUsername('a.b_c-1')).toBeNull();
    expect(validateUsername('ab')).not.toBeNull();
    expect(validateUsername('a b')).not.toBeNull();
  });

  it('密码强度校验', () => {
    expect(validatePassword('Str0ng-Pass!2026')).toBeNull();
    expect(validatePassword('short')).not.toBeNull();
    expect(validatePassword('1234567890')).not.toBeNull();
    expect(validatePassword('password123')).not.toBeNull();
    expect(validatePassword('aaaaaaaaaaaaaaa1', 'aaaa')).not.toBeNull();
    expect(validatePassword('onlylowercaseletters')).not.toBeNull();
  });
});
