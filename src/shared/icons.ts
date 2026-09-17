/**
 * 内置图标库：全部为手写 SVG 几何路径（24 × 24 视图框，描边风格）。
 * 这些字符串是源码常量，不来自用户输入，因此可以安全地渲染。
 */

export interface BuiltinIcon {
  id: string;
  label: string;
  /** <svg> 内部标记 */
  body: string;
}

export const BUILTIN_ICONS: BuiltinIcon[] = [
  { id: 'star', label: '星标', body: '<path d="M12 3.6l2.5 5.1 5.6.8-4 3.9 1 5.6-5.1-2.7-5.1 2.7 1-5.6-4-3.9 5.6-.8z"/>' },
  { id: 'home', label: '主页', body: '<path d="M4 11.2 12 4l8 7.2V19a1 1 0 0 1-1 1h-4.5v-5h-5v5H5a1 1 0 0 1-1-1z"/>' },
  { id: 'code', label: '代码', body: '<path d="M9 6.5 4 12l5 5.5M15 6.5 20 12l-5 5.5"/>' },
  { id: 'cloud', label: '云端', body: '<path d="M7.2 18h9.6a4 4 0 0 0 .5-7.97A5.5 5.5 0 0 0 7 10.4 3.9 3.9 0 0 0 7.2 18z"/>' },
  { id: 'book', label: '文档', body: '<path d="M12 6.5c-1.8-1.4-3.8-2-6-2v13c2.2 0 4.2.6 6 2 1.8-1.4 3.8-2 6-2v-13c-2.2 0-4.2.6-6 2z"/><path d="M12 6.5v13"/>' },
  { id: 'music', label: '音乐', body: '<path d="M9 17.5V6.2l10-2v11.3"/><circle cx="6.5" cy="17.5" r="2.5"/><circle cx="16.5" cy="15.5" r="2.5"/>' },
  { id: 'video', label: '视频', body: '<rect x="4" y="6" width="11" height="12" rx="1.5"/><path d="M15 10.5 20 7.5v9l-5-3z"/>' },
  { id: 'image', label: '图库', body: '<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="M5 17l4.5-4.5 3 3L16 12l3.5 3.5"/>' },
  { id: 'mail', label: '邮件', body: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="m4 7 8 5.5L20 7"/>' },
  { id: 'chat', label: '聊天', body: '<path d="M4.5 5.5h15a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H10l-5 4v-4h-.5a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z"/>' },
  { id: 'cart', label: '购物', body: '<path d="M4 5h2l2.2 10.5h9.6L20 8H7"/><circle cx="9" cy="19" r="1.4"/><circle cx="17" cy="19" r="1.4"/>' },
  { id: 'folder', label: '文件夹', body: '<path d="M3.5 6.5h6l2 2.5h9v9a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z"/>' },
  { id: 'link', label: '外链', body: '<path d="M14 4h6v6M20 4l-8.5 8.5"/><path d="M18 14v5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 19V8a1.5 1.5 0 0 1 1.5-1.5H10"/>' },
  { id: 'user', label: '用户', body: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c1.2-3.2 3.7-5 7-5s5.8 1.8 7 5"/>' },
  { id: 'bell', label: '通知', body: '<path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 2h-14z"/><path d="M10 20.5h4"/>' },
  { id: 'camera', label: '相机', body: '<path d="M4 8.5h3l1.5-2h7L17 8.5h3a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>' },
  { id: 'calendar', label: '日历', body: '<rect x="4" y="6" width="16" height="14" rx="2"/><path d="M4 10.5h16M9 4v4M15 4v4"/>' },
  { id: 'clock', label: '时钟', body: '<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/>' },
  { id: 'download', label: '下载', body: '<path d="M12 4v10.5M8 11l4 4 4-4"/><path d="M5 19.5h14"/>' },
  { id: 'globe', label: '全球', body: '<circle cx="12" cy="12" r="8"/><path d="M4.5 9.5h15M4.5 14.5h15"/><path d="M12 4c2.2 2.4 3.3 5 3.3 8s-1.1 5.6-3.3 8c-2.2-2.4-3.3-5-3.3-8S9.8 6.4 12 4z"/>' },
  { id: 'heart', label: '收藏', body: '<path d="M12 19.5S4.5 15 4.5 9.8A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 7.5 2.8c0 5.2-7.5 9.7-7.5 9.7z"/>' },
  { id: 'lock', label: '加密', body: '<rect x="5.5" y="10.5" width="13" height="9" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>' },
  { id: 'pin', label: '位置', body: '<path d="M12 21s6-5.4 6-10a6 6 0 1 0-12 0c0 4.6 6 10 6 10z"/><circle cx="12" cy="11" r="2.3"/>' },
  { id: 'monitor', label: '显示器', body: '<rect x="3.5" y="5" width="17" height="11" rx="1.5"/><path d="M9 19.5h6M12 16v3.5"/>' },
  { id: 'moon', label: '夜间', body: '<path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z"/>' },
  { id: 'sun', label: '白天', body: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5V5M12 19v2.5M4.2 4.2 6 6M18 18l1.8 1.8M2.5 12H5M19 12h2.5M4.2 19.8 6 18M18 6l1.8-1.8"/>' },
  { id: 'phone', label: '手机', body: '<path d="M7.5 3.5h9A1.5 1.5 0 0 1 18 5v14a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19V5a1.5 1.5 0 0 1 1.5-1.5z"/><path d="M10.5 17.5h3"/>' },
  { id: 'play', label: '播放', body: '<circle cx="12" cy="12" r="8"/><path d="M10 8.8 15.5 12 10 15.2z"/>' },
  { id: 'search', label: '搜索', body: '<circle cx="11" cy="11" r="6"/><path d="m15.5 15.5 4 4"/>' },
  { id: 'shield', label: '安全', body: '<path d="M12 3.5 19 6v6c0 4.2-2.9 7.5-7 8.5-4.1-1-7-4.3-7-8.5V6z"/><path d="m9 12 2 2 4-4"/>' },
  { id: 'briefcase', label: '工作', body: '<rect x="4" y="7.5" width="16" height="11" rx="2"/><path d="M9 7.5V6a3 3 0 0 1 6 0v1.5M4 12h16"/>' },
  { id: 'zap', label: '快捷', body: '<path d="M13.5 3 6 13.5h5L10.5 21 18 10.5h-5z"/>' },
  { id: 'layers', label: '分层', body: '<path d="m12 4 8 4-8 4-8-4z"/><path d="m4 12 8 4 8-4"/>' },
  { id: 'package', label: '项目', body: '<path d="m12 3.5 8 4.5v8l-8 4.5-8-4.5v-8z"/><path d="M4 8l8 4.5L20 8M12 12.5v8"/>' },
  { id: 'server', label: '服务器', body: '<rect x="4" y="4.5" width="16" height="6" rx="1.5"/><rect x="4" y="13.5" width="16" height="6" rx="1.5"/><path d="M7.5 7.5h.01M7.5 16.5h.01"/>' },
  { id: 'tag', label: '标签', body: '<path d="M11 4H5.5A1.5 1.5 0 0 0 4 5.5V11l9 9 7-7z"/><circle cx="8" cy="8" r="1.3"/>' },
  { id: 'tool', label: '工具', body: '<path d="M14.5 4.5a4.5 4.5 0 0 0-5.6 5.6L4 15v5h5l4.9-4.9a4.5 4.5 0 0 0 5.6-5.6l-2.9 2.9-3.1-3.1z"/>' },
  { id: 'terminal', label: '终端', body: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="m7.5 10 2.5 2.5-2.5 2.5M12.5 15.5h4"/>' },
  { id: 'wifi', label: '网络', body: '<path d="M4 9.5a13 13 0 0 1 16 0M7 13a8.5 8.5 0 0 1 10 0"/><circle cx="12" cy="17" r="1.2"/>' },
  { id: 'coffee', label: '生活', body: '<path d="M5 8.5h11v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4z"/><path d="M16 10h1.5a2.5 2.5 0 0 1 0 5H16M4.5 21.5h13"/>' },
  { id: 'film', label: '影视', body: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M8 5v14M16 5v14M3.5 12h17"/>' },
];

const ICON_MAP = new Map(BUILTIN_ICONS.map((icon) => [icon.id, icon]));

export function builtinIcon(id: string): BuiltinIcon | undefined {
  return ICON_MAP.get(id);
}

export function isBuiltinIconId(id: string): boolean {
  return ICON_MAP.has(id);
}
