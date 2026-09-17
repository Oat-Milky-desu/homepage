-- 内容体积守卫：executeMutation 在写入语句之后、版本号递增之前，
-- 校验「分组 + 链接 + 设置」的紧凑 JSON 总字节数是否超过 CONTENT_SERIALIZED_BUDGET_BYTES。
-- 超限时向该表插入守卫行，违反命名 CHECK 约束，整批事务回滚并返回 400。
-- 该表始终为空（守卫行只存在于失败事务中并随回滚消失）。

CREATE TABLE content_budget_guard (
  id INTEGER PRIMARY KEY CONSTRAINT guard_content_budget CHECK (id <= 0),
  note TEXT NOT NULL
);
