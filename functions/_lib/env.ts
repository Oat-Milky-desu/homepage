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

export const DEFAULT_PBKDF2_ITERATIONS = 150_000;
