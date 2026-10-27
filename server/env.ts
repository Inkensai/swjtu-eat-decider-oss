export interface Env {
  DB: D1Database
  ASSETS: Fetcher
  /**
   * 适合 Workers Free 的管理员访问密钥摘要：`sha256:<64位十六进制>`。
   * 密钥由密码学安全随机数生成，至少 128 位熵；设置后优先于 ADMIN_PASSWORD_HASH。
   */
  ADMIN_ACCESS_KEY_HASH?: string
  /** 人工管理员密码的 PBKDF2 哈希；计算开销较高，适合付费套餐并经过 CPU 实测。 */
  ADMIN_PASSWORD_HASH?: string
  /** 会话绝对有效期（秒），默认 12 小时。 */
  ADMIN_SESSION_TTL_SECONDS?: string
  /** 同一来源允许的连续登录失败次数，默认 5。 */
  ADMIN_LOGIN_MAX_ATTEMPTS?: string
  /** 登录限流窗口（秒），默认 900。 */
  ADMIN_LOGIN_WINDOW_SECONDS?: string
}
