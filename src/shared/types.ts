/**
 * 星屿导航 —— 前后端共享的类型定义。
 * 该文件必须保持环境无关（浏览器 / Cloudflare Workers 均可运行）。
 */

export type Theme = 'dark' | 'light';
export type CardSize = 'compact' | 'cozy' | 'comfortable';
export type SearchEngine = 'baidu' | 'google' | 'bing';
export type IconType = 'auto' | 'builtin' | 'image' | 'favicon';
export type LinkTarget = '_self' | '_blank';
export type GroupDeleteMode = 'migrate' | 'cascade';

export interface AppSettings {
  siteTitle: string;
  siteSubtitle: string;
  /** 自定义壁纸地址；为空时使用内置渐变壁纸 */
  wallpaperUrl: string;
  /** 壁纸遮罩不透明度 0 ~ 0.9 */
  overlayOpacity: number;
  /** 卡片背景不透明度 0.05 ~ 1 */
  cardOpacity: number;
  cardSize: CardSize;
  theme: Theme;
  searchEngine: SearchEngine;
  clockShowSeconds: boolean;
  /** 毛玻璃模糊强度（px） */
  glassBlur: number;
}

export interface NavLink {
  id: string;
  groupId: string;
  name: string;
  url: string;
  description: string;
  iconType: IconType;
  iconValue: string;
  target: LinkTarget;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface NavGroup {
  id: string;
  name: string;
  position: number;
  collapsed: boolean;
  createdAt: string;
  updatedAt: string;
  links: NavLink[];
}

export interface ContentPayload {
  revision: number;
  settings: AppSettings;
  groups: NavGroup[];
}

export interface BackupGroup {
  id: string;
  name: string;
  position: number;
  collapsed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BackupLink {
  id: string;
  groupId: string;
  name: string;
  url: string;
  description: string;
  iconType: IconType;
  iconValue: string;
  target: LinkTarget;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface BackupFile {
  format: 'xingyu-nav-backup';
  version: 1;
  exportedAt: string;
  settings: AppSettings;
  groups: BackupGroup[];
  links: BackupLink[];
}

export interface ImportLinkInput {
  name: string;
  url: string;
  description?: string;
  iconType?: IconType;
  iconValue?: string;
  target?: LinkTarget;
}

export interface ImportGroupInput {
  name: string;
  links: ImportLinkInput[];
}

export interface ImportRequest {
  revision: number;
  groups: ImportGroupInput[];
  /** 默认 true：跳过已存在（按规范化 URL 去重）的书签 */
  skipDuplicateUrls?: boolean;
}

export interface ImportSkipped {
  url: string;
  name: string;
  reason: 'duplicate' | 'invalid';
}

export interface ImportResult {
  revision: number;
  createdGroups: number;
  createdLinks: number;
  skipped: ImportSkipped[];
}

/* ---------------------------------- API ---------------------------------- */

export interface AdminUser {
  username: string;
}

export interface StatusResponse {
  setupRequired: boolean;
  authenticated: boolean;
  user?: AdminUser;
  csrfToken?: string;
  revision?: number;
}

export interface ApiErrorIssue {
  path: string;
  message: string;
}

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    issues?: ApiErrorIssue[];
    retryAfterSeconds?: number;
    /** 冲突时的服务端最新版本号，便于客户端刷新 */
    revision?: number;
  };
}

export type ApiErrorCode =
  | 'validation_error'
  | 'unauthorized'
  | 'session_expired'
  | 'stale_response'
  | 'invalid_credentials'
  | 'forbidden'
  | 'csrf_error'
  | 'origin_rejected'
  | 'not_found'
  | 'method_not_allowed'
  | 'revision_conflict'
  | 'group_not_empty'
  | 'already_setup'
  | 'rate_limited'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'server_misconfigured'
  | 'internal_error';

export interface MutationResponse {
  revision: number;
}

export interface GroupCreateResponse extends MutationResponse {
  group: NavGroup;
}

export interface LinkCreateResponse extends MutationResponse {
  link: NavLink;
}

export interface PasswordChangeResponse extends MutationResponse {
  /** 密码修改会撤销包括当前设备在内的全部会话，客户端随后需要重新登录 */
  sessionsRevoked: true;
}
