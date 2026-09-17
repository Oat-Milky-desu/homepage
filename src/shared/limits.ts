/**
 * 前后端共享的容量与体积上限。
 * 服务端在这些上限处拒绝写入，保证任何一份合法导出的备份都能被恢复，
 * 前端也使用同一组常量给出预览与提示。
 */

/** 分组数量上限 */
export const MAX_GROUPS = 300;
/** 链接数量上限 */
export const MAX_LINKS = 5000;

/** 普通 JSON 请求体上限（1 MB） */
export const JSON_BODY_LIMIT_BYTES = 1024 * 1024;
/**
 * 书签导入请求体上限。
 * 服务端还会在事务内校验写入后的内容总量（见 CONTENT_SERIALIZED_BUDGET_BYTES），
 * 因此请求体较大也不会产生超预算的数据。
 */
export const IMPORT_BODY_LIMIT_BYTES = 20 * 1024 * 1024;
/** 备份恢复请求体上限，与导入保持一致 */
export const RESTORE_BODY_LIMIT_BYTES = 20 * 1024 * 1024;

/** 浏览器书签 HTML 文件的前端预检上限（服务端仍会再校验 JSON 体积） */
export const BOOKMARK_FILE_LIMIT_BYTES = 20 * 1024 * 1024;

/**
 * 全部内容（分组 + 链接 + 设置）的序列化体积预算（紧凑 JSON，单位字节）。
 *
 * 服务端在 executeMutation 的事务内、版本号递增之前校验该预算：
 * 任何写入（创建 / 更新 / 导入 / 恢复 / 保存设置）如果让内容总量超过它，
 * 整批语句都会回滚并返回 400，因此数据库里永远不会出现超预算内容。
 *
 * 与 RESTORE_BODY_LIMIT_BYTES（20 MiB）的关系：
 * 备份导出（前端另存为文件时）使用 2 空格缩进的 pretty JSON，在 5000 条链接的
 * 数量上限下额外空白开销约 0.5 MiB（远小于 EXPORT_PRETTY_OVERHEAD_BYTES），
 * 再加上恢复请求包装后仍远低于 20 MiB，因此任何成功写入的内容都能被导出、
 * 下载，并被再次恢复。
 */
export const CONTENT_SERIALIZED_BUDGET_BYTES = 10 * 1024 * 1024;
/** pretty JSON 导出相对紧凑 JSON 的保守额外预算，用于说明 10 MiB 内容预算与 20 MiB 恢复上限的关系 */
export const EXPORT_PRETTY_OVERHEAD_BYTES = 2 * 1024 * 1024;

/** 单条 SQL 中 json_each 参数的最大体积，用于分块批量写入 */
export const JSON_CHUNK_MAX_BYTES = 512 * 1024;
/** 单条 SQL 中 json_each 参数的最大条目数 */
export const JSON_CHUNK_MAX_ITEMS = 500;
