/**
 * 轻量级、零依赖的输入校验工具。
 * 服务端用它校验所有请求体，客户端用它做同一套校验（例如恢复预览）。
 */

export interface ValidationIssue {
  path: string;
  message: string;
}

export class ValidationError extends Error {
  readonly issues: ValidationIssue[];

  constructor(issues: ValidationIssue[]) {
    const list = issues.length > 0 ? issues : [{ path: '', message: '输入无效' }];
    super(list.map((issue) => (issue.path ? `${issue.path}: ${issue.message}` : issue.message)).join('；'));
    this.name = 'ValidationError';
    this.issues = list;
  }

  get first(): ValidationIssue {
    return this.issues[0]!;
  }
}

export interface FieldContext {
  path: string;
  issues: ValidationIssue[];
  /** 已出现错误时跳过后续子字段，减少噪音 */
  failed: boolean;
}

export function newContext(path = ''): FieldContext {
  return { path, issues: [], failed: false };
}

export function describeField(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return '数组';
  switch (typeof value) {
    case 'string':
      return '字符串';
    case 'number':
      return '数字';
    case 'boolean':
      return '布尔值';
    case 'object':
      return '对象';
    default:
      return typeof value;
  }
}

export class Field<T> {
  /** 内部标记，仅用于类型推断的可读性 */
  declare readonly __type?: T;

  constructor(
    private readonly parser: (value: unknown, ctx: FieldContext) => T | undefined,
    /** 缺省时是否合法（undefined 直接通过） */
    readonly isOptional: boolean = false,
    private readonly kindLabel: string = '值',
    /** 缺省时也交给解析器（用于提供默认值） */
    private readonly allowsMissing: boolean = false,
  ) {}

  parse(value: unknown, ctx: FieldContext): T | undefined {
    if (value === undefined && !this.allowsMissing) {
      if (this.isOptional) return undefined;
      ctx.issues.push({ path: ctx.path, message: '不能为空' });
      ctx.failed = true;
      return undefined;
    }
    return this.parser(value, ctx);
  }

  /** 允许缺省（缺省时为 undefined） */
  optional(): Field<T | undefined> {
    return new Field<T | undefined>((value, ctx) => this.parse(value, ctx), true, this.kindLabel, false);
  }

  /** 允许缺省，缺省时使用默认值；结果类型仍为 T */
  withDefault(defaultValue: T): Field<T> {
    const inner = this.parser;
    return new Field<T>((value, ctx) => (value === undefined ? defaultValue : inner(value, ctx)), true, this.kindLabel, true);
  }

  describe(): string {
    return this.kindLabel;
  }
}

function fail(ctx: FieldContext, message: string): undefined {
  ctx.issues.push({ path: ctx.path, message });
  ctx.failed = true;
  return undefined;
}

/** 允许字段缺省（缺省时为 undefined） */
export function optional<T>(field: Field<T>): Field<T | undefined> {
  return field.optional();
}

export interface StringFieldOptions {
  min?: number;
  max?: number;
  /** 是否去除首尾空白并写入结果，默认 true */
  trim?: boolean;
  /** 正则表达式（必须整体匹配） */
  pattern?: RegExp;
  patternMessage?: string;
  label?: string;
}

export function str(options: StringFieldOptions = {}): Field<string> {
  const { min = 0, max = 5000, trim = true, pattern, patternMessage, label = '文本' } = options;
  return new Field<string>((value, ctx) => {
    if (typeof value !== 'string') return fail(ctx, `应为${label}，实际为${describeField(value)}`);
    const result = trim ? value.trim() : value;
    if (result.length < min) return fail(ctx, `长度不能少于 ${min} 个字符`);
    if (result.length > max) return fail(ctx, `长度不能超过 ${max} 个字符`);
    if (pattern && !pattern.test(result)) return fail(ctx, patternMessage ?? '格式不正确');
    return result;
  }, false, label);
}

export interface NumberFieldOptions {
  min?: number;
  max?: number;
  integer?: boolean;
  label?: string;
}

export function num(options: NumberFieldOptions = {}): Field<number> {
  const { min = -Number.MAX_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER, integer = false, label = '数字' } = options;
  return new Field<number>((value, ctx) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fail(ctx, `应为${label}`);
    if (integer && !Number.isInteger(value)) return fail(ctx, `${label}必须为整数`);
    if (value < min) return fail(ctx, `不能小于 ${min}`);
    if (value > max) return fail(ctx, `不能大于 ${max}`);
    return value;
  }, false, label);
}

export function bool(label = '布尔值'): Field<boolean> {  return new Field<boolean>((value, ctx) => {
    if (typeof value !== 'boolean') return fail(ctx, `应为${label}`);
    return value;
  }, false, label);
}

export function oneOf<T extends string>(values: readonly T[], label = '选项'): Field<T> {
  return new Field<T>((value, ctx) => {
    if (typeof value !== 'string' || !values.includes(value as T)) {
      return fail(ctx, `只能是：${values.join('、')}`);
    }
    return value as T;
  }, false, label);
}

/** HTTP/HTTPS 绝对地址；拒绝 javascript:、data: 等危险协议 */
export function httpUrl(options: { max?: number; allowEmpty?: boolean; label?: string } = {}): Field<string> {
  const { max = 2048, allowEmpty = false, label = '链接地址' } = options;
  return new Field<string>((value, ctx) => {
    if (typeof value !== 'string') return fail(ctx, `应为${label}`);
    const raw = value.trim();
    if (allowEmpty && raw === '') return '';
    if (raw.length > max) return fail(ctx, `长度不能超过 ${max} 个字符`);
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      return fail(ctx, `不是合法的地址（需以 http:// 或 https:// 开头）`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return fail(ctx, '仅支持 http:// 或 https:// 链接');
    }
    if (!parsed.hostname) return fail(ctx, '缺少主机名');
    return raw;
  }, false, label);
}

export function list<T>(itemField: Field<T>, options: { min?: number; max?: number; label?: string } = {}): Field<T[]> {
  const { min = 0, max = 5000, label = '列表' } = options;
  return new Field<T[]>((value, ctx) => {
    if (!Array.isArray(value)) return fail(ctx, `应为${label}`);
    if (value.length < min) return fail(ctx, `至少需要 ${min} 项`);
    if (value.length > max) return fail(ctx, `最多允许 ${max} 项`);
    const result: T[] = [];
    value.forEach((item, index) => {
      const itemPath = `${ctx.path}[${index}]`;
      const parsed = parseField(itemField, item, itemPath, ctx.issues, ctx.failed);
      if (parsed === undefined) {
        ctx.failed = true;
      } else {
        result.push(parsed);
      }
    });
    return result;
  }, false, label);
}

export function record<T>(valueField: Field<T>, options: { maxKeys?: number; label?: string } = {}): Field<Record<string, T>> {
  const { maxKeys = 500, label = '映射' } = options;
  return new Field<Record<string, T>>((value, ctx) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail(ctx, `应为${label}`);
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > maxKeys) return fail(ctx, `最多允许 ${maxKeys} 个键`);
    const result: Record<string, T> = {};
    for (const [key, item] of entries) {
      const itemPath = ctx.path ? `${ctx.path}.${key}` : key;
      const parsed = parseField(valueField, item, itemPath, ctx.issues, ctx.failed);
      if (parsed === undefined) {
        ctx.failed = true;
      } else {
        result[key] = parsed;
      }
    }
    return result;
  }, false, label);
}

type FieldValue<F> = F extends Field<infer T> ? T : never;
export type ShapeValue<S extends Record<string, Field<unknown>>> = { [K in keyof S]: FieldValue<S[K]> };

export function object<S extends Record<string, Field<unknown>>>(shape: S, options: { label?: string } = {}): Field<ShapeValue<S>> {
  const { label = '对象' } = options;
  const knownKeys = new Set(Object.keys(shape));
  return new Field<ShapeValue<S>>((value, ctx) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail(ctx, `应为${label}`);
    const input = value as Record<string, unknown>;
    const unknown = Object.keys(input).filter((key) => !knownKeys.has(key));
    if (unknown.length > 0) {
      ctx.issues.push({ path: ctx.path, message: `包含未知字段：${unknown.join('、')}` });
      ctx.failed = true;
    }
    const result: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(shape)) {
      const fieldPath = ctx.path ? `${ctx.path}.${key}` : key;
      const parsed = field.parse(input[key], { path: fieldPath, issues: ctx.issues, failed: ctx.failed });
      if (parsed === undefined && !field.isOptional) {
        ctx.failed = true;
      } else if (parsed !== undefined) {
        result[key] = parsed;
      }
    }
    return result as ShapeValue<S>;
  }, false, label);
}

function parseField<T>(field: Field<T>, value: unknown, path: string, issues: ValidationIssue[], failed: boolean): T | undefined {
  const ctx: FieldContext = { path, issues, failed };
  return field.parse(value, ctx);
}

/** 解析并收集全部问题，失败时抛出 ValidationError */
export function parseObject<S extends Record<string, Field<unknown>>>(shape: S, value: unknown): ShapeValue<S> {
  const ctx = newContext();
  const result = object(shape).parse(value, ctx);
  if (ctx.issues.length > 0 || result === undefined) throw new ValidationError(ctx.issues);
  return result;
}

/** 供测试与备份预览使用：返回问题列表而不是抛异常 */
export function collectIssues<T>(field: Field<T>, value: unknown, path = ''): { value: T | undefined; issues: ValidationIssue[] } {
  const ctx = newContext(path);
  const result = field.parse(value, ctx);
  return { value: ctx.failed ? undefined : result, issues: ctx.issues };
}
