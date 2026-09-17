import type { ImportGroupInput, ImportLinkInput, ImportSkipped } from '../shared/types';
import { dedupeKey, normalizeHttpUrl } from '../shared/url';

/**
 * 浏览器书签 HTML（Netscape 格式）解析。
 * 使用 DOMParser 以惰性方式解析：不会执行脚本、不会加载任何外部资源。
 */

export interface ParsedBookmark {
  name: string;
  url: string;
  description: string;
}

export interface ParsedFolder {
  /** 从顶层到当前文件夹的名称路径 */
  path: string[];
  name: string;
  links: ParsedBookmark[];
}

export interface ParsedBookmarks {
  folders: ParsedFolder[];
  /** 解析到的链接总数（含被跳过项） */
  total: number;
  skipped: ImportSkipped[];
}

export interface ParseOptions {
  maxLinks?: number;
}

function tagOf(element: Element): string {
  return element.tagName.toUpperCase();
}

/** 展平 <p> 包裹层后的元素顺序（Chrome 导出会在 <DL> 中插入未闭合的 <p>） */
function flattenChildren(element: Element): Element[] {
  const result: Element[] = [];
  const push = (node: Element) => {
    for (const child of Array.from(node.children)) {
      if (tagOf(child) === 'P') {
        push(child);
      } else {
        result.push(child);
      }
    }
  };
  push(element);
  return result;
}

function findDescendant(element: Element, tag: string): Element | null {
  for (const child of flattenChildren(element)) {
    if (tagOf(child) === tag) return child;
    const nested = findDescendant(child, tag);
    if (nested) return nested;
  }
  return null;
}

function textOf(element: Element | null): string {
  return (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function parseDocument(html: string): Document | null {
  try {
    if (typeof DOMParser === 'undefined') return null;
    return new DOMParser().parseFromString(html, 'text/html');
  } catch {
    return null;
  }
}

export function parseBookmarksHtml(html: string, options: ParseOptions = {}): ParsedBookmarks {
  const maxLinks = options.maxLinks ?? 5000;
  const folders: ParsedFolder[] = [];
  const skipped: ImportSkipped[] = [];
  const seen = new Set<string>();
  let total = 0;
  let overflow = false;

  const ensureFolder = (path: string[]): ParsedFolder => {
    const name = path.length > 0 ? path[path.length - 1]! : '';
    const key = path.join('/');
    let folder = folders.find((item) => item.path.join('/') === key);
    if (!folder) {
      folder = { path: [...path], name, links: [] };
      folders.push(folder);
    }
    return folder;
  };

  const addLink = (anchor: Element, path: string[], description: string) => {
    const rawUrl = anchor.getAttribute('href') ?? '';
    const name = textOf(anchor) || rawUrl || '未命名书签';
    total += 1;
    if (total > maxLinks) {
      if (!overflow) {
        overflow = true;
        skipped.push({ url: rawUrl, name, reason: 'invalid' });
      }
      return;
    }
    const url = normalizeHttpUrl(rawUrl);
    if (!url) {
      skipped.push({ url: rawUrl, name, reason: 'invalid' });
      return;
    }
    const key = dedupeKey(url);
    if (seen.has(key)) {
      skipped.push({ url, name, reason: 'duplicate' });
      return;
    }
    seen.add(key);
    ensureFolder(path).links.push({ name, url, description: description.slice(0, 500) });
  };

  const doc = parseDocument(html);
  if (!doc) return { folders, total, skipped };
  const root = doc.querySelector('dl');
  if (!root) return { folders, total, skipped };

  const visit = (list: Element, path: string[]) => {
    const nodes = flattenChildren(list);
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index]!;
      if (tagOf(node) !== 'DT') continue;
      const heading = findDescendant(node, 'H3');
      const anchor = findDescendant(node, 'A');
      if (heading) {
        const folderName = textOf(heading) || '未命名文件夹';
        const folderPath = [...path, folderName.slice(0, 60)];
        const nested = findDescendant(node, 'DL') ?? (nodes[index + 1] && tagOf(nodes[index + 1]!) === 'DL' ? nodes[index + 1]! : null);
        if (nested) {
          ensureFolder(folderPath);
          visit(nested, folderPath);
          if (nested !== nodes[index + 1]) {
            // 嵌套在 DT 内部，正常消费
          } else {
            index += 1;
          }
        } else {
          ensureFolder(folderPath);
        }
        continue;
      }
      if (anchor) {
        let description = anchor.getAttribute('description') ?? anchor.getAttribute('tags') ?? '';
        const next = nodes[index + 1];
        if (!description && next && tagOf(next) === 'DD') {
          description = textOf(next);
        }
        addLink(anchor, path, description);
      }
    }
  };

  visit(root, []);
  return { folders, total, skipped };
}

export interface ImportPlanOptions {
  mode: 'folders' | 'single';
  /** single 模式下使用的目标分组名 */
  singleGroupName?: string;
  /** 已存在的 URL（规范化后的去重键），用于预览时标记重复 */
  existingUrlKeys?: Iterable<string>;
  maxGroups?: number;
  maxLinks?: number;
}

export interface ImportPlan {
  groups: ImportGroupInput[];
  totalLinks: number;
  skipped: ImportSkipped[];
  skippedExisting: number;
}

/** 将解析结果整理为导入计划：合并同名文件夹、去重、限制数量 */
export function planImport(parsed: ParsedBookmarks, options: ImportPlanOptions): ImportPlan {
  const maxGroups = options.maxGroups ?? 200;
  const maxLinks = options.maxLinks ?? 5000;
  const existing = new Set(options.existingUrlKeys ?? []);
  const skipped: ImportSkipped[] = [...parsed.skipped];
  let skippedExisting = 0;
  const groups: ImportGroupInput[] = [];
  const groupByName = new Map<string, ImportGroupInput>();
  let accepted = 0;
  let groupOverflow = false;

  const targetName = (folder: ParsedFolder): string => {
    if (options.mode === 'single') return (options.singleGroupName ?? '导入的书签').slice(0, 60);
    const name = folder.path.length > 0 ? folder.path.join(' / ') : folder.name;
    return (name || '未分组').slice(0, 60);
  };

  for (const folder of parsed.folders) {
    for (const link of folder.links) {
      if (accepted >= maxLinks) {
        skipped.push({ url: link.url, name: link.name, reason: 'invalid' });
        continue;
      }
      const key = dedupeKey(link.url);
      if (existing.has(key)) {
        skippedExisting += 1;
        skipped.push({ url: link.url, name: link.name, reason: 'duplicate' });
        continue;
      }
      const name = targetName(folder);
      let group = groupByName.get(name);
      if (!group) {
        if (groups.length >= maxGroups) {
          if (!groupOverflow) {
            groupOverflow = true;
            skipped.push({ url: link.url, name: link.name, reason: 'invalid' });
          }
          continue;
        }
        group = { name, links: [] };
        groupByName.set(name, group);
        groups.push(group);
      }
      const item: ImportLinkInput = {
        name: link.name.slice(0, 120),
        url: link.url,
        description: link.description,
      };
      group.links.push(item);
      accepted += 1;
    }
  }

  return { groups, totalLinks: accepted, skipped, skippedExisting };
}
