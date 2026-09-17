/** URL 处理工具（浏览器 / Workers 通用，仅使用标准 URL API） */

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * 规范化 HTTP(S) 地址，用于去重与保存：
 * - 缺少协议时补全 https://
 * - 主机名小写、去掉默认端口
 * - 保留 hash 路由与页面锚点
 * - 只移除根路径的末尾斜杠，非根路径的斜杠可能有意义（例如目录地址）
 * 非法或不支持的协议返回 null。
 */
export function normalizeHttpUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!url.hostname) return null;
  const defaultPort = url.protocol === 'https:' ? '443' : '80';
  if (url.port === defaultPort) url.port = '';
  const rootPath = url.pathname === '/' || url.pathname === '';
  const serialized = url.toString();
  return rootPath ? serialized.replace(/\/$/, '') : serialized;
}

/** URL 去重键：大小写不敏感的主机 + 路径 + 查询串 + hash；仅根路径忽略末尾斜杠 */
export function dedupeKey(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === '/' ? '' : parsed.pathname;
    return `${parsed.protocol}//${parsed.host.toLowerCase()}${path}${parsed.search}${parsed.hash}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function originOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

/** 站点自带的 favicon 地址，不经过任何第三方代理 */
export function faviconUrlFor(url: string): string {
  const origin = originOf(url);
  return origin ? `${origin}/favicon.ico` : '';
}

const INITIAL_COLORS = [
  'linear-gradient(135deg, #34d399, #0ea5e9)',
  'linear-gradient(135deg, #f472b6, #a855f7)',
  'linear-gradient(135deg, #f59e0b, #ef4444)',
  'linear-gradient(135deg, #22d3ee, #3b82f6)',
  'linear-gradient(135deg, #a3e635, #14b8a6)',
  'linear-gradient(135deg, #fb7185, #f97316)',
];

export function initialOf(name: string): string {
  const chars = Array.from(name.trim());
  return chars.length > 0 ? chars[0]!.toUpperCase() : '#';
}

export function colorFromString(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return INITIAL_COLORS[hash % INITIAL_COLORS.length]!;
}

/** 生成短随机 ID（客户端创建、服务端校验格式） */
export function randomId(prefix = ''): string {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const token = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${prefix}${token}`;
}
