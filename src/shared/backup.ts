import type { BackupFile, BackupGroup, BackupLink } from './types';
import { validateIconValue } from './icon-rules';
import { settingsField } from './settings';
import { MAX_GROUPS, MAX_LINKS } from './limits';
import { parseObject, bool, list, num, object, oneOf, str, httpUrl, ValidationError, Field, type ValidationIssue } from './validate';

export const BACKUP_FORMAT = 'xingyu-nav-backup';
export const BACKUP_VERSION = 1;
export const MAX_BACKUP_GROUPS = MAX_GROUPS;
export const MAX_BACKUP_LINKS = MAX_LINKS;

const idField = str({ min: 1, max: 40, pattern: /^[A-Za-z0-9_-]+$/, patternMessage: '只允许字母、数字、- 和 _', label: 'ID' });
const timeField = str({ min: 1, max: 40, label: '时间' });
const groupShape = {
  id: idField,
  name: str({ min: 1, max: 60, label: '分组名称' }),
  position: num({ min: 0, max: Number.MAX_SAFE_INTEGER, integer: true, label: '排序位置' }),
  collapsed: bool('折叠状态').withDefault(false),
  createdAt: timeField,
  updatedAt: timeField,
};
const linkShape = {
  id: idField,
  groupId: idField,
  name: str({ min: 1, max: 120, label: '链接名称' }),
  url: httpUrl({ max: 2048, label: '链接地址' }),
  description: str({ min: 0, max: 500, label: '描述' }),
  iconType: oneOf(['auto', 'builtin', 'image', 'favicon'] as const, '图标类型'),
  iconValue: str({ min: 0, max: 500, label: '图标值' }),
  target: oneOf(['_self', '_blank'] as const, '打开方式'),
  position: num({ min: 0, max: Number.MAX_SAFE_INTEGER, integer: true, label: '排序位置' }),
  createdAt: timeField,
  updatedAt: timeField,
};

const groupField = object(groupShape);
const linkField = object(linkShape);
const backupShape = {
  format: oneOf([BACKUP_FORMAT] as const, '备份格式'),
  version: num({ min: 1, max: BACKUP_VERSION, integer: true, label: '备份版本' }),
  exportedAt: timeField,
  settings: settingsField,
  groups: list(groupField as Field<unknown>, { max: MAX_BACKUP_GROUPS, label: '分组列表' }),
  links: list(linkField as Field<unknown>, { max: MAX_BACKUP_LINKS, label: '链接列表' }),
};

export const backupField: Field<BackupFile> = new Field<BackupFile>((value, ctx) => {
  const issuesBefore = ctx.issues.length;
  const parsed = object(backupShape, { label: '备份文件' }).parse(value, ctx);
  // 结构本身不合法时不再做关系校验，避免在部分字段缺失时抛出运行时异常
  if (parsed === undefined || ctx.issues.length > issuesBefore) return undefined;
  const relationIssues = validateBackupRelations(parsed as unknown as BackupFile);
  if (relationIssues.length > 0) {
    ctx.issues.push(...relationIssues);
    ctx.failed = true;
    return undefined;
  }
  return parsed as unknown as BackupFile;
});

/** 语义校验：ID 唯一、分组引用有效、图标值合法 */
export function validateBackupRelations(data: BackupFile): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const groups = Array.isArray(data.groups) ? data.groups : [];
  const links = Array.isArray(data.links) ? data.links : [];
  const groupIds = new Set<string>();
  groups.forEach((group, index) => {
    if (groupIds.has(group.id)) issues.push({ path: `groups[${index}].id`, message: `分组 ID 重复：${group.id}` });
    groupIds.add(group.id);
  });
  const linkIds = new Set<string>();
  links.forEach((link, index) => {
    if (linkIds.has(link.id)) issues.push({ path: `links[${index}].id`, message: `链接 ID 重复：${link.id}` });
    linkIds.add(link.id);
    if (!groupIds.has(link.groupId)) {
      issues.push({ path: `links[${index}].groupId`, message: `引用了不存在的分组：${link.groupId}` });
    }
    const iconIssue = validateIcon(link);
    if (iconIssue) issues.push({ path: `links[${index}].iconValue`, message: iconIssue });
  });
  return issues;
}

function validateIcon(link: { iconType: string; iconValue: string }): string | null {
  return validateIconValue(link.iconType as BackupLink['iconType'], link.iconValue);
}

export function parseBackup(value: unknown): BackupFile {
  const data = parseObject(backupShape, value) as unknown as BackupFile;
  const issues = validateBackupRelations(data);
  if (issues.length > 0) throw new ValidationError(issues);
  return data;
}


export type { BackupFile, BackupGroup, BackupLink };
