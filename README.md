# 星屿导航（Xingyu Nav）

一个**纯私有**的个人导航主页：Vue 3 + TypeScript + Vite 前端，Cloudflare Pages Functions 提供 API，Cloudflare D1 负责持久化。
整体视觉参考 Sun-Panel 的壁纸 + 毛玻璃卡片风格，但代码与样式均为原创实现；没有注册功能，整站只有一位管理员。

- 首页：实时日期/时钟、站内搜索 + 百度 / Google / Bing 外部搜索、分组快捷跳转、分组折叠、响应式卡片网格；页眉提供「日间 / 夜间」一键快捷切换（与 `/admin` 外观设置同源，保存到云端并在多设备同步）
- 链接：新增 / 编辑 / 删除，支持名称、地址、描述、分组、图标、打开方式；支持拖拽排序与跨分组移动，并提供键盘可用的按钮替代方案
- 分组：增删改、拖拽排序（编辑模式下拖动分组标题前的 ⠿ 手柄）以及上移/下移按钮；删除非空分组时必须显式选择「迁移到其它分组」或勾选确认「级联删除」
- 设置页 `/admin`：站点标题/副标题、壁纸地址、遮罩与卡片不透明度、卡片尺寸、毛玻璃强度、主题、默认搜索引擎、时钟秒数、修改密码
- 数据：JSON 备份导出、校验预览 + 显式确认的原子恢复；浏览器书签 HTML 导入（本地解析、预览、按规范化 URL 去重）
- 安全：PBKDF2-SHA256 加盐口令、服务端仅存会话令牌哈希、七天滑动过期的 Cookie 会话、同源 + CSRF 校验、登录/初始化限流、严格输入校验、API 响应禁止缓存

---

## 1. 技术架构

```
浏览器 (Vue SPA)
   │  fetch /api/*（同源、Cookie 会话、X-CSRF-Token）
   ▼
Cloudflare Pages Functions  →  functions/api/[[path]].ts
   │  统一路由与中间件：functions/_lib 中的 router / http / auth
   ▼
Cloudflare D1 (SQLite)      →  migrations/*.sql
```

| 目录 | 说明 |
| --- | --- |
| `src/` | 前端源码（视图、组件、状态仓库、共享校验与类型） |
| `src/shared/` | 前后端共享的纯 TS 模块：类型、校验、设置、备份格式、图标库、URL 工具、容量上限 |
| `functions/api/[[path]].ts` | Pages Functions 唯一入口，`/api/*` 全部由它分发 |
| `functions/_lib/` | 服务端模块：路由、HTTP 工具、会话与限流、加密、D1 访问层、批量写入、各类 handler |
| `migrations/` | D1 迁移 SQL（`0001_init.sql`、`0002_validation_guard.sql`、`0003_named_guards.sql`） |
| `tests/api/` | 在 workerd 中运行的集成测试（真实 Miniflare D1） |
| `tests/unit/` | jsdom 环境下的前端单元测试（书签解析、校验、URL、备份格式、会话状态、外观变量） |
| `dist/` | `npm run build` 产物（已被 gitignore） |
| `wrangler.jsonc` | 唯一的 Cloudflare 配置来源（Pages 输出目录、D1 绑定、compatibility date） |

### 数据模型

- `app_meta`：全局版本号 `revision`，所有内容修改都会 +1，用于乐观并发控制
- `admin_users`：单管理员（`id = 1`），保存 `pbkdf2-sha256$迭代次数$盐$哈希`
- `sessions`：只保存令牌的 SHA-256 摘要、CSRF 令牌、创建/最近活动/过期时间
- `login_attempts`：登录、初始化、改密尝试次数，用于频率限制
- `groups` / `links`：导航内容，`links.group_id` 外键级联
- `settings`：站点设置的 JSON 单行存储
- `revision_guard` / `existence_guard` / `validation_guard` / `content_budget_guard`：并发守卫表。任何插入都会违反已命名的 `CHECK` 约束，因此当版本号不匹配、目标行不存在、业务上限被突破或内容总量超预算时，整个 `db.batch()` 事务回滚，分别返回 409 / 404 / 400 / 400，绝不发生部分写入

### 规模化写入

D1 对每次 Worker 调用的 SQL 语句数量有限制（Free 计划 50 条）。因此导入、恢复、排序等操作全部通过 `json_each(...)` 分块批量写入：
单次 600 条链接的导入 / 恢复 / 排序都在个位数语句内完成，且与真正的写操作处于同一个受版本守卫保护的事务中。分块同时受 512 KiB 与 500 条/块的约束，因此 5000 条链接的上限也不会让语句数接近 50。自动化测试会统计 SQL 语句数并断言不超过 50 条。

每批写操作还会在写入语句之后、递增版本号之前执行一次内容总量守卫（`content_budget_guard`）：用 `length(CAST(json_object(...) AS BLOB))` 按行汇总分组 + 链接 + 设置的紧凑 JSON 体积（外加数组分隔符与包装余量），超过 10 MiB 预算即整批回滚并返回 400。该守卫与 `db.batch()` 同事务执行，不存在“先读后写”竞态，也不受单条 SQL 绑定体积限制。

---

## 2. 本地开发

环境要求：Node.js ≥ 20（开发使用 24.x 验证）、npm、Git Bash 或 PowerShell 均可。

```bash
# 1) 安装依赖（npm 12 会询问是否允许 workerd/esbuild 的安装脚本，仓库已在 package.json 中预先批准）
npm install

# 2) 准备本地环境变量
cp .dev.vars.example .dev.vars      # Windows: copy .dev.vars.example .dev.vars
#   编辑 .dev.vars，把 INIT_SECRET 改成一段随机字符串（至少 16 位）

# 3) 初始化本地 D1 并应用迁移（数据保存在 .wrangler/state，已被忽略）
npm run db:migrate:local

# 4a) 全栈预览（推荐）：构建前端 + 启动 Pages Functions + 本地 D1
npm run preview            # http://127.0.0.1:8788

# 4b) 或者分开跑，获得前端热更新
npm run build              # 先生成 dist（wrangler pages dev 需要它作为静态资源目录）
npm run dev:api            # 终端 A：API + 本地 D1，端口 8788
npm run dev                # 终端 B：Vite 开发服务器，端口 5173，/api 已代理到 8788
```

首次打开页面会被引导到 `/setup`，需要填写三件事：

1. **INIT_SECRET**：`.dev.vars` 中的初始化密钥（部署时来自 Cloudflare 加密变量）
2. **管理员用户名**：3–32 位字母、数字、`_`、`.`、`-`
3. **密码**：至少 10 位，且包含大小写字母、数字、符号中的至少两类

初始化只能成功一次；之后 `/setup` 会跳转到登录页。

---

## 3. 部署到 Cloudflare Pages

> 仓库包含 `wrangler.jsonc`（`pages_build_output_dir = "dist"`、D1 绑定占位符、`compatibility_date = "2026-09-15"`）。**无需真实部署即可完成本地验证**，下面步骤供上线时使用。

### 3.1 创建 D1 数据库

```bash
npx wrangler d1 create xingyu-nav
```

把输出中的 `database_id` 填入 `wrangler.jsonc` 的 `d1_databases[0].database_id`（当前是占位 UUID）：

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "xingyu-nav",
    "database_id": "真实数据库 ID",
    "migrations_dir": "migrations"
  }
]
```

### 3.2 应用远端迁移

```bash
npm run db:migrate:remote      # wrangler d1 migrations apply DB --remote
```

迁移是追加式的；已有数据库只需应用尚未执行的新迁移。

### 3.3 配置初始化密钥（加密变量）

```bash
npx wrangler pages secret put INIT_SECRET --project-name <你的 Pages 项目名>
# 生成随机密钥示例：node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

也可以在 Cloudflare Dashboard → Workers & Pages → 你的 Pages 项目 → Settings → Variables and Secrets 中添加 `INIT_SECRET`（类型选择 **Secret / 加密**）。

`INIT_SECRET` 只在 `/api/setup` 首次初始化时参与校验，绝不会进入前端构建产物，也不会以 `VITE_` 前缀暴露。

### 3.4 部署

**方式 A：连接 Git 仓库（推荐）**

- Build command：`npm run build`
- Build output directory：`dist`（`wrangler.jsonc` 中已声明）
- Pages 会自动发现并打包 `functions/` 目录

**方式 B：命令行**

```bash
npm run build
npx wrangler pages deploy dist --project-name <你的 Pages 项目名>
```

部署完成后访问站点，用 `INIT_SECRET` 完成初始化。

### 3.5 自定义域名与 HTTPS

在 Pages 项目 → Custom domains 绑定域名。会话 Cookie 在 HTTPS 下自动带上 `Secure`；本地 http 调试时（`wrangler pages dev` 的 `localhost` / `127.0.0.1`）不带 `Secure`，也可以显式设置 `FORCE_SECURE_COOKIE=true/false` 覆盖。

---

## 4. 安全设计

| 主题 | 做法 |
| --- | --- |
| 口令 | WebCrypto PBKDF2-SHA256，16 字节随机盐，默认 150,000 次迭代；哈希串自带算法与迭代次数，登录时可自动升级旧参数（升级写操作带哈希条件守卫，绝不会覆盖并发修改后的新密码） |
| 会话 | 32 字节随机令牌只以 SHA-256 摘要存库；Cookie 为 `HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`，HTTPS 下追加 `Secure` |
| 滑动过期 | 7 天有效期。**只有显式的活动上报**（已认证的页面首次加载、点击 / 键盘 / 标签页重新可见，客户端节流 5 分钟）会顺延过期时间；被动的内容 GET 与后台刷新**不会**续期，也不存在任何定时轮询。过期会话在续期之前就被删除，返回 `session_expired` |
| CSRF | 所有非安全方法必须同时满足：`Origin`（或 `Referer`）与本站 **完整 origin**（协议 + 主机 + 端口）一致；`Content-Type: application/json`；`X-CSRF-Token` 与会话中的 CSRF 令牌常数时间比对。开发环境的额外来源必须通过 `DEV_ORIGIN` 显式配置，生产不会放宽 |
| 限流 | 登录失败按 IP（20 次 / 15 分钟）与用户名（5 次 / 15 分钟）；初始化尝试按 IP（10 次 / 15 分钟）；改密失败按用户名（10 次 / 15 分钟）。每次尝试在密码校验**之前**用单条条件 INSERT 原子占位，并发请求无法一起越过阈值；成功后只清理本次占位及更早的失败记录，不误删并发失败 |
| 输入校验 | 服务端对每个请求体做严格模式校验：拒绝未知字段、限制长度与数量、URL 仅允许 `http(s)`、图标引用必须存在、请求体大小流式限制（普通接口 1 MB / 书签导入与备份恢复 20 MB） |
| 并发 | 所有内容写入都在同一个 `db.batch()` 事务里先执行版本守卫，再写入，最后 `revision + 1`；版本不匹配即整体回滚并返回 409。内容读取与备份导出使用单次批量读取获得一致快照。客户端收到 409 会刷新最新数据并提示重试 |
| 隐私 | 除 `/api/status`（只回答「是否需要初始化」与当前登录态）外，所有接口都需要登录；API 响应统一 `Cache-Control: no-store` 与 `Vary: Cookie`；静态产物中不含任何密钥或口令；登出 / 会话过期会立即清空前端的标题、壁纸与分组，在途响应按会话代际丢弃，不会回流 |
| 其他 | 页面不渲染任何导入的 HTML（书签解析只取文本，图标仅来自内置常量表），不提供文件上传、R2 或任何代理能力 |

**修改密码**：成功后撤销**包括当前设备在内**的全部会话，服务端返回清除 Cookie，前端立即跳回登录页要求重新登录。

---

## 5. API 一览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/status` | 初始化状态；已登录时返回用户名、CSRF 令牌与版本号 |
| POST | `/api/setup` | 一次性初始化（需要 `INIT_SECRET`） |
| POST | `/api/login` | 登录，签发会话 |
| POST | `/api/logout` | 撤销当前会话 |
| POST | `/api/session/activity` | 显式上报用户活动，顺延过期时间 |
| POST | `/api/password` | 修改密码：撤销全部会话（含当前设备），需要重新登录 |
| GET | `/api/content` | 站点设置 + 分组 + 链接 + 版本号 |
| POST | `/api/groups` | 新建分组 |
| PATCH | `/api/groups/:id` | 重命名 / 折叠 |
| DELETE | `/api/groups/:id` | 删除分组：`{ mode: 'migrate', targetGroupId }` 或 `{ mode: 'cascade', confirm: true }` |
| PUT | `/api/order` | 原子排序与跨分组移动（分组顺序 + 全部链接顺序快照） |
| POST | `/api/links` | 新建链接 |
| PATCH | `/api/links/:id` | 编辑链接（含移动到其它分组） |
| DELETE | `/api/links/:id` | 删除链接 |
| PUT | `/api/settings` | 保存站点设置（完整对象，严格校验） |
| GET | `/api/backup` | 导出 JSON 备份（不含任何认证信息） |
| POST | `/api/restore` | 校验后原子恢复备份 |
| POST | `/api/import` | 导入书签（服务端再次校验并去重） |

所有写操作的请求体都包含当前 `revision`；返回 `409 revision_conflict` 时表示需要刷新后重试。

---

## 6. 备份、恢复与书签导入

**导出**：`/admin` → 备份与恢复 → 「下载备份」。文件名形如 `xingyu-nav-backup-YYYYMMDD-HHMM.json`，内容为：

```json
{
  "format": "xingyu-nav-backup",
  "version": 1,
  "exportedAt": "2026-03-01T08:00:00.000Z",
  "settings": { "...": "站点设置" },
  "groups": [{ "id": "g_xxx", "name": "工作", "position": 0, "collapsed": false, "createdAt": "...", "updatedAt": "..." }],
  "links": [{ "id": "l_xxx", "groupId": "g_xxx", "name": "GitHub", "url": "https://github.com", "iconType": "builtin", "iconValue": "code", "...": "..." }]
}
```

备份文件**不包含**密码哈希、会话、CSRF 令牌或 `INIT_SECRET`。

**恢复**：选择 JSON 文件 → 前端用与服务端相同的校验器解析并展示预览（分组数、链接数、标题、导出时间）→ 点击「确认恢复」并在弹窗中勾选确认 → 服务端再次完整校验后，在单个事务中替换全部内容、设置并递增版本号。任何一步失败都不会改变现有数据。

**容量与体积的一致性保证**：最多 300 个分组 / 5000 条链接；全部内容（分组 + 链接 + 设置）的紧凑 JSON 总量不得超过 10 MiB。该预算由服务端在事务内强制执行，创建、更新、导入、恢复、保存设置都受同一守卫约束。导出文件是带 2 空格缩进的 pretty JSON，即使链接数量与字段长度都取到上限，额外空白也不到 2 MiB，加上恢复请求包装后仍远低于 20 MiB 的请求体上限；因此凡是能被写入的数据，都一定能通过 `/api/backup` 导出并被 `/api/restore` 原样恢复（测试覆盖接近预算边界的多字节 Unicode 内容往返）。

**书签导入**：浏览器「导出书签为 HTML」后，在 `/admin` → 书签导入中选择文件。文件在本地用 `DOMParser` 惰性解析（不执行脚本、不加载资源），按文件夹路径递归生成分组（可切换为「全部导入到一个分组」），自动跳过无协议/危险协议的链接与重复 URL，确认后提交到服务端；服务端会再次规范化、去重并批量写入。去重按「协议 + 小写主机 + 路径 + 查询串 + hash」计算，根路径的末尾斜杠会被忽略，但非根路径（例如目录地址）与 hash 路由会被保留。

---

## 7. 忘记密码 / 重置管理员

备份文件刻意不包含认证信息，因此**备份无法找回密码**。恢复方式是在服务端删除管理员与会话记录，然后重新走一次 `/setup`（内容、分组与设置都会保留）：

```bash
# 本地开发库（数据在 .wrangler/state）
npx wrangler d1 execute DB --local --persist-to .wrangler/state \
  --command "DELETE FROM sessions; DELETE FROM admin_users;"

# 远端生产库（需要已登录 wrangler 且有权限）
npx wrangler d1 execute DB --remote \
  --command "DELETE FROM sessions; DELETE FROM admin_users;"
```

删除后访问站点会跳转到 `/setup`，使用仍然有效的 `INIT_SECRET` 重新设置用户名和密码即可。请确保 `INIT_SECRET` 已妥善保存，否则需要重新部署新的 Secret。

---

## 8. 开发命令与验证

```bash
npm run typecheck     # 前端(vue-tsc) + 服务端(tsc, workers 类型) + 配置(tsc, node 类型)
npm run lint          # ESLint flat config，含 Vue 规则
npm run build         # 前端生产构建
npm run build:functions   # 单独编译 Pages Functions 到 .tmp/functions-build（验证打包无误）
npm run types         # 根据 wrangler.jsonc 生成绑定类型到 .tmp/worker-configuration.d.ts
npm test              # 单元测试 + workerd 集成测试
npm run test:unit     # jsdom：书签解析、校验、URL、备份、首页交互、路由守卫、会话状态、外观变量
npm run test:api      # workerd + 真实 Miniflare D1：认证、并发、限流、CRUD、批量写入、备份、导入
```

可选的真实浏览器响应式检查（需要本机安装 Chrome 或 Edge）：

```bash
npm run build
npm run db:migrate:local          # 需要空的本地数据库，脚本会走一遍初始化流程
npm run preview                   # 终端 A
npm run check:browser -- --init-secret <与 .dev.vars 一致的 INIT_SECRET>   # 终端 B
```

该脚本通过 Chrome DevTools Protocol 完成初始化/登录、用界面创建分组与链接，并检查桌面 1440×900 与手机 390×844 视口下无横向溢出、卡片自适应宽度、管理页可用、主题切换生效以及控制台无未捕获错误，截图输出到 `.tmp/browser-check/`。

集成测试直接调用与线上相同的 `functions/_lib/router.ts`，并使用真实的 D1（含 `CHECK`/外键约束与事务语义），覆盖：初始化只能一次、并发登录/初始化/改密限流、会话哈希存储、被动读取不续期而显式活动续期、登出与改密撤销（含当前设备）、同源/协议/端口校验、请求体上限、未知字段与危险协议拒绝、分组迁移与级联删除、跨分组排序的原子性与陈旧版本回滚、无变更请求的陈旧版本拒绝、600+ 条链接的批量导入 / 恢复 / 排序在 SQL 预算内完成、300 分组 / 5000 链接的备份往返、接近内容预算边界的多字节 Unicode 导出/恢复往返与超预算回滚、超过 10000 的安全整数排序位置往返、非法恢复、书签导入去重。

---

## 9. 已知边界与说明

- **单管理员**：没有注册、没有多用户/权限体系；所有内容接口只服务这一个账户。
- **无文件上传**：壁纸与图标都通过 URL 引用，不提供 R2 或图片代理；跨域图片能否显示取决于对方的防盗链与 CORS 策略，加载失败时会回退为首字母图标。
- **拖拽与触屏**：分组与链接的 HTML5 拖放主要面向鼠标；触屏与键盘用户请使用分组的上移/下移按钮、卡片的上移/下移/编辑（编辑弹窗中可切换分组）按钮，功能完全等价。
- **容量上限**：最多 300 个分组、5000 条链接；全部内容（分组 + 链接 + 设置）的紧凑 JSON 总量上限 10 MiB，单次备份恢复 / 导入请求体积上限 20 MiB。超限的导入 / 恢复会在事务内被拒绝并回滚，不会出现超预算数据或半截写入；由于 10 MiB 内容加 pretty 导出空白仍远低于 20 MiB，任何成功保存的内容都能被导出并再次恢复。
- **compatibility date**：`wrangler.jsonc` 使用 2026-09-15（由 wrangler 捆绑的 workerd 提供）；vitest 测试池捆绑的 workerd 最高支持 2026-08-15，因此 `vitest.workers.config.ts` 单独使用后者，二者仅相差一个月，API 行为一致。
- **`_worker.js` 说明**：`npm run build:functions` 只把编译结果输出到 `.tmp/`，不会写入 `dist/`，以免与 Pages 的 `functions/` 路由冲突。前端路由（`/admin`、`/login` 等）依赖 Pages 默认的 SPA 回退（项目没有 `404.html`，未命中的静态请求会返回 `index.html`），因此不再需要 `public/_redirects`；仓库中也没有该文件。`public/_headers` 为静态资源设置缓存与安全响应头。
- **会话顺延范围**：滑动过期没有绝对上限，只要在 7 天内持续有真实操作即可保持登录；改密会撤销全部旧会话。
- **时区**：时钟与日期使用浏览器本地时区；数据库时间戳统一为 UTC ISO 字符串。
- **开发依赖公告**：`npm audit` 会报告 `miniflare` / `wrangler` 传递依赖中 `sharp` 的高危公告。它们只用于本地测试与构建，不会进入部署产物；官方建议的修复方式需要把 `@cloudflare/vitest-pool-workers` 降级到 0.8.x（破坏性变更，会连带降低 Vitest 版本），因此当前保留现有版本并在升级后重新评估。
