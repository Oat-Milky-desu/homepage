-- 守卫表重建：为 CHECK 约束命名。
-- workerd/SQLite 的错误信息会包含约束名（例如“CHECK constraint failed: guard_existence”），
-- 从而可以把守卫失败精确映射为 400 / 404 / 409，而不依赖表达式文本。
-- 这些守卫表始终为空，重建是安全的（守卫行只在失败事务中短暂出现并随回滚消失）。

DROP TABLE IF EXISTS revision_guard;
DROP TABLE IF EXISTS existence_guard;
DROP TABLE IF EXISTS validation_guard;

CREATE TABLE revision_guard (
  id INTEGER PRIMARY KEY CONSTRAINT guard_revision CHECK (id <= 0),
  expected_revision INTEGER NOT NULL
);

CREATE TABLE existence_guard (
  id INTEGER PRIMARY KEY CONSTRAINT guard_existence CHECK (id <= 0),
  note TEXT NOT NULL
);

CREATE TABLE validation_guard (
  id INTEGER PRIMARY KEY CONSTRAINT guard_validation CHECK (id <= 0),
  note TEXT NOT NULL
);
