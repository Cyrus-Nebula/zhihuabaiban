-- 智绘几何 · 自建账号 + 云端画板存储（Cloudflare D1 / SQLite）
-- 在 Cloudflare Dashboard 建库并绑定到 Pages 项目后，Functions 中通过 context.env.DB 访问。
--
-- 建库与绑定步骤（Cloudflare Dashboard）：
--   1) Workers & Pages -> D1 -> Create database，命名如 `zhihui_geo`（免费 5GB）
--   2) 你的 Pages 项目 -> Settings -> Functions -> D1 bindings -> 绑定变量名 `DB` 到该库
--   3) 本地开发用 `wrangler pages dev --d1=DB`（需 wrangler.toml 的 [[d1_databases]] 配置）
--   4) 执行本文件建表（Dashboard 的 D1 控制台直接粘贴运行，或 `wrangler d1 execute`）
--
-- 登录令牌（JWT_SECRET）不是 D1 的一部分，需在 Pages -> Settings -> Environment variables
-- 里设一个名为 JWT_SECRET 的变量（任意长随机串，如 `openssl rand -hex 32`）。

-- 用户表：邮箱 + 加盐哈希密码（PBKDF2-HMAC-SHA256）
-- token_version：改密/删号后 +1，使所有旧登录令牌立即失效（无状态 JWT 的主动吊销手段）
CREATE TABLE IF NOT EXISTS users (
  id            TEXT    PRIMARY KEY,                     -- u_xxx
  email         TEXT    NOT NULL UNIQUE,                -- 小写归一化后的邮箱
  password_hash TEXT    NOT NULL,                        -- pbkdf2$<iters>$<salt>$<hash>
  token_version INTEGER NOT NULL DEFAULT 0,             -- 令牌版本，改密/删号时自增
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- 登录限流：按「邮箱 + 访问 IP」双桶计数，失败达到阈值后锁定一段时间
-- key 取值：'ip:<clientIp>' 或 '<邮箱>'(仅当该邮箱确实存在，避免对未注册邮箱做账户锁死 DoS)
CREATE TABLE IF NOT EXISTS login_throttle (
  key          TEXT    PRIMARY KEY,
  fails        INTEGER NOT NULL DEFAULT 0,
  first_at     INTEGER NOT NULL,
  locked_until INTEGER                                     -- 锁定截止时间(ms)，NULL 表示未锁定
);
CREATE INDEX IF NOT EXISTS idx_throttle_locked ON login_throttle(locked_until);

-- 画板表：以 user_id 做账户隔离（与 js/store.js 的本地数据模型对齐）
CREATE TABLE IF NOT EXISTS boards (
  id          TEXT    PRIMARY KEY,                     -- 沿用现有 f_xxx 风格
  user_id     TEXT    NOT NULL,                        -- users.id
  name        TEXT    NOT NULL DEFAULT '未命名画板',
  mode        TEXT    NOT NULL DEFAULT '2d',           -- '2d' | '3d'
  content     TEXT,                                    -- 完整工程 JSON：{name,commands,moves}
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_boards_user ON boards(user_id, updated_at DESC);

-- ─────────────────────────────────────────────────────────────
-- 存量库迁移（仅当本文件已在此前执行过、但当时没有 token_version/login_throttle 时）：
--   ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0;
--   CREATE TABLE IF NOT EXISTS login_throttle (
--     key TEXT PRIMARY KEY, fails INTEGER NOT NULL DEFAULT 0,
--     first_at INTEGER NOT NULL, locked_until INTEGER
--   );
-- 新库直接执行本文件即可，无需手动迁移。
-- ─────────────────────────────────────────────────────────────
