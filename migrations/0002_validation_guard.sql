-- 通用业务校验守卫：向该表插入任意行都会违反 CHECK 约束，
-- 用于在同一条 db.batch() 事务内原子地检查“数量上限”等业务规则：
-- 校验失败时整个事务回滚，避免先读后写产生竞态。

CREATE TABLE validation_guard (
  id INTEGER PRIMARY KEY CHECK (id <= 0),
  note TEXT NOT NULL
);
