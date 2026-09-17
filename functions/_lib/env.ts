/**
 * Cloudflare Pages Functions 运行时绑定。
 * 同时通过全局声明扩展 `Cloudflare.Env`，让测试中的 `cloudflare:test` env 拥有相同类型。
 */
export interface Env {
  /** D1 数据库绑定 */
  DB: D1Database;
  /** 首次初始化密钥（仅在部署时通过 secret 配置，绝不进入前端构建） */
  INIT_SECRET?: string;
  /** 可选：强制所有会话 Cookie 带 Secure（本地 http 调试时可保持关闭） */
  FORCE_SECURE_COOKIE?: string;
  /**
   * 可选：本地开发时允许的额外来源（完整 origin，例如 http://localhost:5173）。
   * 仅在显式配置时生效，生产环境不需要配置。
   */
  DEV_ORIGIN?: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- 官方推荐的环境类型扩展方式
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      INIT_SECRET?: string;
      FORCE_SECURE_COOKIE?: string;
      DEV_ORIGIN?: string;
    }
  }
}

export interface ApiOptions {
  /** 可注入的时钟（毫秒），用于测试滑动过期 */
  now?: () => number;
  /** 可调的 PBKDF2 迭代次数（生产使用默认值） */
  pbkdf2Iterations?: number;
  /** 测试/本地开发可显式指定的额外同源 origin（完整协议 + 主机 + 端口） */
  devOrigin?: string;
}

/**
 * 新写入密码哈希的默认 PBKDF2 迭代次数。
 *
 * 托管版 Cloudflare Workers 的 WebCrypto 对 PBKDF2 迭代次数有 100000 的硬上限：
 * 超过时 deriveBits 会在线上抛出
 * `Pbkdf2 failed: iteration counts above 100000 are not supported`，
 * 首次初始化 / 登录 / 改密都会返回 500（https://github.com/cloudflare/workerd/issues/1346）。
 * 本地 workerd / Miniflare 不强制执行该上限，因此本地能跑通的更高值仍可能在线上失败，
 * 这里必须保持不超过 100000。哈希串自带迭代次数，历史哈希仍按其记录的开销校验。
 */
export const DEFAULT_PBKDF2_ITERATIONS = 100_000;
