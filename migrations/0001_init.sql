-- 星屿导航 · 初始架构
-- 所有内容表均为单管理员私有站点设计，通过外键保证引用完整性。

-- 全局版本号：每次内容变更 +1，用于乐观并发控制
CREATE TABLE app_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

INSERT INTO app_meta (id, revision, updated_at) VALUES (1, 0, datetime('now'));

-- 管理员（单例：id 恒为 1）
CREATE TABLE admin_users (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 会话：仅存储令牌的 SHA-256 摘要，绝不存储明文令牌
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);
CREATE INDEX sessions_user_id_idx ON sessions (user_id);

-- 登录/初始化尝试次数，用于频率限制
CREATE TABLE login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL,
  identifier TEXT NOT NULL,
  attempted_at INTEGER NOT NULL
);

CREATE INDEX login_attempts_lookup_idx ON login_attempts (scope, identifier, attempted_at);

-- 分组
CREATE TABLE groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  collapsed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX groups_position_idx ON groups (position);

-- 链接
CREATE TABLE links (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon_type TEXT NOT NULL DEFAULT 'auto',
  icon_value TEXT NOT NULL DEFAULT '',
  target TEXT NOT NULL DEFAULT '_self',
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX links_group_position_idx ON links (group_id, position);

-- 站点设置（JSON 单行存储）
CREATE TABLE settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  settings_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO settings (id, settings_json, updated_at) VALUES (1, '{}', datetime('now'));

-- 并发守卫：任何插入都会违反 CHECK 约束，借此让整个事务回滚
CREATE TABLE revision_guard (
  id INTEGER PRIMARY KEY CHECK (id <= 0),
  expected_revision INTEGER NOT NULL
);

CREATE TABLE existence_guard (
  id INTEGER PRIMARY KEY CHECK (id <= 0),
  note TEXT NOT NULL
);
