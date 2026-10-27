-- 应用内管理员登录：会话与登录限流。
-- 密码散列只保存在服务端密钥 ADMIN_PASSWORD_HASH，不进入数据库、Git 或前端。

CREATE TABLE admin_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  csrf_token TEXT NOT NULL CHECK (length(csrf_token) BETWEEN 32 AND 128),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX admin_sessions_expires ON admin_sessions(expires_at);

CREATE TABLE admin_login_attempts (
  scope TEXT PRIMARY KEY NOT NULL,
  window_start INTEGER NOT NULL,
  failures INTEGER NOT NULL DEFAULT 0 CHECK (failures BETWEEN 0 AND 100000),
  locked_until INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX admin_login_attempts_window ON admin_login_attempts(window_start);
