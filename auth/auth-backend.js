/**
 * 智绘几何 · 自建账号体系核心（无第三方依赖，纯 Web Crypto + D1）
 *
 * 设计原则（沿用 ai/ai-backend.js）：
 *   - 纯 ES module、从 env 取变量、可被 Pages Function / Worker / 本地代理共用
 *   - 账号完全自建：邮箱 + 密码，密码用 PBKDF2-HMAC-SHA256 加盐哈希存储
 *   - 登录态用**服务端签名的 JWT** 写入 httpOnly Cookie，前端不碰令牌
 *   - 画板数据存 D1，按 user_id 做账户隔离
 *
 * 环境变量（Pages Dashboard -> Settings -> Environment variables）：
 *   JWT_SECRET  必填，用于签发/校验登录令牌（任意长随机字符串，如 `openssl rand -hex 32`）
 *   DB          D1 数据库绑定（建库与绑定见 auth/schema.sql 顶部说明）
 *
 * 安全说明：
 *   - 密码哈希迭代 100000 次 PBKDF2-SHA256，盐 16 字节随机，存储格式
 *     `pbkdf2$<iters>$<saltB64>$<hashB64>`
 *   - JWT 用 HS256（HMAC-SHA256），载荷仅含 sub(userId)、email 与 tv(令牌版本)，有效期 30 天
 *   - Cookie 设 HttpOnly + Secure + SameSite=Lax，防 XSS 读取与跨站自动携带（同源 fetch 仍带，跨站 POST 不带→天然防 CSRF）
 *   - 令牌版本（users.token_version）：改密/删号后 +1，所有旧会话立即失效
 *   - 登录限流：login_throttle 表按「邮箱 + 访问 IP」双桶计数，失败 5 次锁定 30 分钟
 */

export const COOKIE_NAME = 'auth_token';
const TOKEN_TTL_SEC = 60 * 60 * 24 * 30; // 30 天

/* ---------- 限流参数 ---------- */
const MAX_FAILS = 5;          // 窗口内最多失败次数
const WINDOW_MS = 15 * 60 * 1000; // 计数窗口 15 分钟
const LOCK_MS = 30 * 60 * 1000;   // 触发锁定后的冷却时间 30 分钟

/* ---------- base64url 工具 ---------- */
function b64url(buf) {
  const bytes = typeof buf === 'string' ? new TextEncoder().encode(buf) : buf;
  let str = '';
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlToBytes(s) {
  const b = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b.length % 4 ? '='.repeat(4 - (b.length % 4)) : '';
  const bin = atob(b + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
function b64urlDecode(s) {
  const b = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b.length % 4 ? '='.repeat(4 - (b.length % 4)) : '';
  return decodeURIComponent(
    atob(b + pad)
      .split('')
      .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
      .join('')
  );
}
/** 防止计时攻击的字符串比对 */
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ---------- 密码哈希（PBKDF2-HMAC-SHA256） ---------- */
export async function hashPassword(password) {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iters = 100000;
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: iters, hash: 'SHA-256' },
    key,
    256
  );
  return 'pbkdf2$' + iters + '$' + b64url(salt) + '$' + b64url(new Uint8Array(bits));
}
export async function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const [, itersStr, saltB64, expectHash] = parts;
  const enc = new TextEncoder();
  const salt = b64urlToBytes(saltB64);
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: Number(itersStr), hash: 'SHA-256' },
    key,
    256
  );
  const got = b64url(new Uint8Array(bits));
  return timingSafeEqual(got, expectHash);
}

/* ---------- 密码强度校验 ---------- */
function validatePassword(pw) {
  if (typeof pw !== 'string') return { error: 'weak_password', message: '请输入密码' };
  if (pw.length < 8) return { error: 'weak_password', message: '密码至少 8 位' };
  if (pw.length > 200) return { error: 'weak_password', message: '密码过长（不超过 200 位）' };
  if (pw.trim().length === 0) return { error: 'weak_password', message: '密码不能为空白' };
  return null;
}

/* ---------- JWT（HS256） ---------- */
async function hmacSign(data, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
  return crypto.subtle.sign('HMAC', key, enc.encode(data));
}
export async function signToken(payload, secret) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const body = b64url(
    JSON.stringify(Object.assign({ iat: now, exp: now + TOKEN_TTL_SEC }, payload))
  );
  const data = header + '.' + body;
  const sig = new Uint8Array(await hmacSign(data, secret));
  return data + '.' + b64url(sig);
}
export async function verifyToken(token, secret) {
  if (typeof token !== 'string') throw new Error('missing_token');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('malformed_token');
  const [header, body, sig] = parts;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
  const ok = await crypto.subtle.verify('HMAC', key, b64urlToBytes(sig), enc.encode(header + '.' + body));
  if (!ok) throw new Error('bad_signature');
  const payload = JSON.parse(b64urlDecode(body));
  if (payload.exp && payload.exp * 1000 < Date.now()) throw new Error('token_expired');
  return payload;
}

/* ---------- Cookie ---------- */
export function cookieHeader(token) {
  const base = `${COOKIE_NAME}=${token || ''}; HttpOnly; Secure; SameSite=Lax; Path=/`;
  return token ? `${base}; Max-Age=${TOKEN_TTL_SEC}` : `${base}; Max-Age=0`;
}
function readCookie(request) {
  const c = request.headers.get('Cookie') || '';
  const m = c.match(/(?:^|;\s*)auth_token=([^;]+)/);
  return m ? m[1] : null;
}
/** 取客户端 IP（Cloudflare 提供 cf-connecting-ip；本地/代理回退到 x-forwarded-for） */
export function clientIp(request) {
  const cf = request.headers.get('cf-connecting-ip');
  if (cf) return cf;
  const xff = request.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return 'unknown';
}

/* ---------- 业务封装 ---------- */

/* 自初始化：首次访问时在绑定的 D1 上建表（幂等，仅执行一次/隔离）。
   免去在 Cloudflare 控制台手动跑 schema.sql 的步骤——只要 D1 已绑定，表会自动创建。 */
let _schemaReady = null;
async function ensureSchema(env) {
  if (!env || !env.DB) return;
  if (_schemaReady) return _schemaReady;
  _schemaReady = (async () => {
    const stmts = [
      `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, token_version INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)`,
      `CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`,
      `CREATE TABLE IF NOT EXISTS login_throttle (key TEXT PRIMARY KEY, fails INTEGER NOT NULL DEFAULT 0, first_at INTEGER NOT NULL, locked_until INTEGER)`,
      `CREATE TABLE IF NOT EXISTS boards (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL DEFAULT '未命名画板', mode TEXT NOT NULL DEFAULT '2d', content TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
      `CREATE INDEX IF NOT EXISTS idx_boards_user ON boards(user_id, updated_at DESC)`,
      // 角色 / 会员（与 users 1:1）
      `CREATE TABLE IF NOT EXISTS user_profiles (user_id TEXT PRIMARY KEY, role TEXT NOT NULL DEFAULT 'user', membership TEXT NOT NULL DEFAULT 'none', membership_since INTEGER, membership_expires INTEGER, display_name TEXT)`,
      // 会员激活码（激活长期会员）
      `CREATE TABLE IF NOT EXISTS activation_codes (code TEXT PRIMARY KEY, type TEXT NOT NULL DEFAULT 'lifetime', created_by TEXT, created_at INTEGER NOT NULL, claimed_by TEXT, claimed_at INTEGER, active INTEGER NOT NULL DEFAULT 1)`,
      `CREATE INDEX IF NOT EXISTS idx_codes_claimed ON activation_codes(claimed_by)`,
      // 找回密码令牌
      `CREATE TABLE IF NOT EXISTS password_resets (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, email TEXT NOT NULL, expires_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0)`,
      // 第三方登录身份映射
      `CREATE TABLE IF NOT EXISTS oauth_identities (provider TEXT NOT NULL, provider_id TEXT NOT NULL, user_id TEXT NOT NULL, email TEXT, name TEXT, PRIMARY KEY (provider, provider_id))`,
      `CREATE INDEX IF NOT EXISTS idx_oauth_user ON oauth_identities(user_id)`,
    ];
    for (const s of stmts) await env.DB.prepare(s).run();
  })().catch((e) => { _schemaReady = null; throw e; });
  return _schemaReady;
}

function normalizeEmail(email) {
  if (typeof email !== 'string') return null;
  const e = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return null;
  if (e.length > 254) return null;
  return e;
}
function genUserId() {
  return 'u_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** 读取用户当前令牌版本；列不存在/无记录时默认 0（兼容存量库） */
async function getUserTv(env, userId) {
  if (!env.DB) return 0;
  try {
    const row = await env.DB.prepare('SELECT token_version FROM users WHERE id=?').bind(userId).first();
    return row ? Number(row.token_version) || 0 : 0;
  } catch {
    return 0;
  }
}

/** 读取当前登录用户（从 Cookie 解 JWT，并校验令牌版本）。未登录/配置缺失/失效/被吊销均返回 authenticated:false */
export async function resolveUser(request, env) {
  const token = readCookie(request);
  if (!token) return { authenticated: false };
  await ensureSchema(env);
  if (!env.JWT_SECRET) return { authenticated: false, error: 'jwt_secret_missing' };
  try {
    const payload = await verifyToken(token, env.JWT_SECRET);
    // 令牌版本校验：改密/删号后旧令牌立即失效
    if (env.DB && typeof payload.tv === 'number') {
      let tvRow;
      try {
        tvRow = await env.DB.prepare('SELECT token_version FROM users WHERE id=?').bind(payload.sub).first();
      } catch (e2) {
        // 存量库无 token_version 列：跳过版本校验（吊销能力暂不可用，但登录不中断）
        if (String(e2 && e2.message || e2).includes('token_version')) tvRow = 'NO_COLUMN';
        else throw e2;
      }
      if (tvRow === 'NO_COLUMN') {
        // 无列，无法校验版本，直接放行
      } else if (!tvRow) {
        return { authenticated: false, error: 'token_revoked' };
      } else if (Number(tvRow.token_version) !== payload.tv) {
        return { authenticated: false, error: 'token_revoked' };
      }
    }
    return { authenticated: true, userId: payload.sub, email: payload.email || null, role: payload.role || 'user', membership: payload.m || 'none', name: payload.name || null, tv: typeof payload.tv === 'number' ? payload.tv : 0 };
  } catch {
    return { authenticated: false };
  }
}

/** 注册：校验 → 查重 → 写 users 表 → 签 JWT。返回 {status, body, token} */
export async function registerUser({ email, password }, env) {
  if (!env.DB) return { status: 503, body: { error: 'db_not_bound', message: '服务端未配置数据库' }, token: null };
  if (!env.JWT_SECRET) return { status: 500, body: { error: 'jwt_secret_missing' }, token: null };
  await ensureSchema(env);
  const e = normalizeEmail(email);
  if (!e) return { status: 400, body: { error: 'invalid_email', message: '邮箱格式不正确' }, token: null };
  const pwErr = validatePassword(password);
  if (pwErr) return { status: 400, body: pwErr, token: null };
  const existing = await env.DB.prepare('SELECT id FROM users WHERE email=?').bind(e).first();
  if (existing) return { status: 409, body: { error: 'email_taken', message: '该邮箱已注册，请直接登录' }, token: null };
  const id = genUserId();
  const hash = await hashPassword(password);
  // 兼容存量库：若 users 表尚无 token_version 列，退化为不含该列的插入
  try {
    await env.DB.prepare('INSERT INTO users (id, email, password_hash, token_version, created_at) VALUES (?,?,?,?,?)')
      .bind(id, e, hash, 0, Date.now()).run();
  } catch (e2) {
    if (String(e2 && e2.message || e2).includes('token_version')) {
      await env.DB.prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?,?,?,?)')
        .bind(id, e, hash, Date.now()).run();
    } else throw e2;
  }
  const token = await signToken({ sub: id, email: e, tv: 0, ...(await issueClaims(env, id, e)) }, env.JWT_SECRET);
  return { status: 200, body: { ok: true, user: { id, email: e } }, token };
}

/** 登录：限流检查 → 校验 → 取用户 → 验密码 → 签 JWT。返回 {status, body, token, retryAfterSec?} */
export async function loginUser({ email, password }, env, request) {
  if (!env.DB) return { status: 503, body: { error: 'db_not_bound', message: '服务端未配置数据库' }, token: null };
  if (!env.JWT_SECRET) return { status: 500, body: { error: 'jwt_secret_missing' }, token: null };
  await ensureSchema(env);
  const e = normalizeEmail(email);
  if (!e || typeof password !== 'string') {
    return { status: 400, body: { error: 'missing_fields', message: '请输入邮箱和密码' }, token: null };
  }
  // 限流：邮箱桶 + IP 桶任一被锁则拒绝
  if (env.DB) {
    const th = await checkThrottle(env, e, clientIp(request));
    if (th.locked) {
      return {
        status: 429,
        retryAfterSec: th.retryAfterSec,
        body: { error: 'too_many_attempts', message: `尝试次数过多，请 ${th.retryAfterSec} 秒后再试`, retryAfterSec: th.retryAfterSec },
        token: null,
      };
    }
  }
  let row;
  try {
    row = await env.DB.prepare('SELECT id, email, password_hash, token_version FROM users WHERE email=?').bind(e).first();
  } catch (e2) {
    // 存量库无 token_version 列时退化读取
    if (String(e2 && e2.message || e2).includes('token_version')) {
      row = await env.DB.prepare('SELECT id, email, password_hash FROM users WHERE email=?').bind(e).first();
      if (row) row.token_version = 0;
    } else throw e2;
  }
  if (!row) { await recordFail(env, e, clientIp(request)); return { status: 401, body: { error: 'invalid_credentials', message: '邮箱或密码错误' }, token: null }; }
  const ok = await verifyPassword(password, row.password_hash);
  if (!ok) { await recordFail(env, e, clientIp(request)); return { status: 401, body: { error: 'invalid_credentials', message: '邮箱或密码错误' }, token: null }; }
  await resetThrottle(env, e, clientIp(request));
  const token = await signToken({ sub: row.id, email: row.email, tv: Number(row.token_version) || 0, ...(await issueClaims(env, row.id, row.email)) }, env.JWT_SECRET);
  return { status: 200, body: { ok: true, user: { id: row.id, email: row.email } }, token };
}

/** 修改密码（需登录）：验旧密 → 改哈希 → token_version+1 → 重签令牌（当前会话保持登录） */
export async function changePassword({ oldPassword, newPassword }, env, request) {
  const user = await resolveUser(request, env);
  if (!user.authenticated) return { status: 401, body: { error: 'unauthenticated', message: '请先登录' }, token: null };
  if (!env.DB) return { status: 503, body: { error: 'db_not_bound' }, token: null };
  await ensureSchema(env);
  const pwErr = validatePassword(newPassword);
  if (pwErr) return { status: 400, body: pwErr, token: null };
  if (!oldPassword || typeof oldPassword !== 'string') return { status: 400, body: { error: 'missing_fields', message: '请输入当前密码' }, token: null };
  const row = await env.DB.prepare('SELECT password_hash, token_version FROM users WHERE id=?').bind(user.userId).first();
  if (!row) return { status: 401, body: { error: 'unauthenticated' }, token: null };
  if (!(await verifyPassword(oldPassword, row.password_hash))) {
    return { status: 400, body: { error: 'wrong_old_password', message: '当前密码不正确' }, token: null };
  }
  const hash = await hashPassword(newPassword);
  const newTv = (Number(row.token_version) || 0) + 1;
  // 兼容存量库：若 users 表尚无 token_version 列，仅更新密码哈希（跳过版本自增）
  try {
    await env.DB.prepare('UPDATE users SET password_hash=?, token_version=? WHERE id=?').bind(hash, newTv, user.userId).run();
  } catch (e2) {
    if (String(e2 && e2.message || e2).includes('token_version')) {
      await env.DB.prepare('UPDATE users SET password_hash=? WHERE id=?').bind(hash, user.userId).run();
    } else throw e2;
  }
  const token = await signToken({ sub: user.userId, email: user.email, tv: newTv, ...(await issueClaims(env, user.userId, user.email)) }, env.JWT_SECRET);
  return { status: 200, body: { ok: true }, token };
}

/** 删除账号（需登录）：验密 → 删该用户全部画板与用户本身 → 清 Cookie 登出 */
export async function deleteAccount({ password }, env, request) {
  const user = await resolveUser(request, env);
  if (!user.authenticated) return { status: 401, body: { error: 'unauthenticated', message: '请先登录' }, token: null };
  if (!env.DB) return { status: 503, body: { error: 'db_not_bound' }, token: null };
  await ensureSchema(env);
  if (!password || typeof password !== 'string') return { status: 400, body: { error: 'missing_fields', message: '请输入密码确认' }, token: null };
  const row = await env.DB.prepare('SELECT password_hash FROM users WHERE id=?').bind(user.userId).first();
  if (!row) return { status: 401, body: { error: 'unauthenticated' }, token: null };
  if (!(await verifyPassword(password, row.password_hash))) {
    return { status: 400, body: { error: 'wrong_password', message: '密码不正确' }, token: null };
  }
  await env.DB.prepare('DELETE FROM boards WHERE user_id=?').bind(user.userId).run();
  await env.DB.prepare('DELETE FROM oauth_identities WHERE user_id=?').bind(user.userId).run();
  await env.DB.prepare('DELETE FROM user_profiles WHERE user_id=?').bind(user.userId).run();
  await env.DB.prepare('UPDATE activation_codes SET claimed_by=NULL, claimed_at=NULL WHERE claimed_by=?').bind(user.userId).run();
  await env.DB.prepare('DELETE FROM users WHERE id=?').bind(user.userId).run();
  return { status: 200, body: { ok: true }, token: null };
}

/* ---------- 登录限流（D1 双桶：邮箱 + IP） ---------- */
export async function checkThrottle(env, email, ip) {
  if (!env.DB) return { locked: false };
  const now = Date.now();
  const keys = ['ip:' + ip];
  if (email) keys.push(email);
  for (const key of keys) {
    const row = await env.DB.prepare('SELECT * FROM login_throttle WHERE key=?').bind(key).first();
    if (row && row.locked_until && row.locked_until > now) {
      return { locked: true, retryAfterSec: Math.ceil((row.locked_until - now) / 1000), key };
    }
  }
  return { locked: false };
}
async function recordFail(env, email, ip) {
  if (!env.DB) return;
  const now = Date.now();
  const keys = ['ip:' + ip];
  if (email) keys.push(email);
  for (const key of keys) {
    const row = await env.DB.prepare('SELECT * FROM login_throttle WHERE key=?').bind(key).first();
    const fails = (row ? row.fails : 0) + 1;
    const firstAt = row ? row.first_at : now;
    const lockedUntil = fails >= MAX_FAILS ? now + LOCK_MS : row ? row.locked_until : null;
    await env.DB.prepare(
      `INSERT INTO login_throttle (key, fails, first_at, locked_until)
       VALUES (?,?,?,?)
       ON CONFLICT(key) DO UPDATE SET fails=excluded.fails, first_at=excluded.first_at, locked_until=excluded.locked_until`
    ).bind(key, fails, firstAt, lockedUntil).run();
  }
}
async function resetThrottle(env, email, ip) {
  if (!env.DB) return;
  const keys = ['ip:' + ip];
  if (email) keys.push(email);
  for (const key of keys) {
    await env.DB.prepare('DELETE FROM login_throttle WHERE key=?').bind(key).run();
  }
}

/* ---------- 画板（D1，按 user_id 隔离） ---------- */
export async function dbUpsertBoard(env, userId, board) {
  const now = Date.now();
  const id = String(board.id || '').trim();
  if (!id) throw new Error('board_id_required');
  const name = String(board.name || '未命名画板').slice(0, 200);
  const mode = board.mode === '3d' ? '3d' : '2d';
  const content = JSON.stringify(board.content ?? null);
  await env.DB.prepare(
    `INSERT INTO boards (id, user_id, name, mode, content, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, mode=excluded.mode, content=excluded.content, updated_at=excluded.updated_at`
  ).bind(id, userId, name, mode, content, now, now).run();
}
export async function dbListBoards(env, userId) {
  const { results } = await env.DB.prepare(
    'SELECT id, name, mode, updated_at FROM boards WHERE user_id=? ORDER BY updated_at DESC'
  ).bind(userId).all();
  return results || [];
}
export async function dbGetBoard(env, userId, id) {
  const row = await env.DB.prepare('SELECT * FROM boards WHERE id=? AND user_id=?').bind(id, userId).first();
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    mode: row.mode,
    content: safeParse(row.content),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
export async function dbDeleteBoard(env, userId, id) {
  await env.DB.prepare('DELETE FROM boards WHERE id=? AND user_id=?').bind(id, userId).run();
}

function safeParse(s) {
  if (s == null) return null;
  try { return JSON.parse(s); } catch { return null; }
}

/* ---------- 角色 / 会员辅助 ---------- */
/** 管理员判定：邮箱在 ADMIN_EMAILS（逗号分隔，大小写不敏感）中即为最高权限 */
export function isAdminEmail(email, env) {
  const raw = env && env.ADMIN_EMAILS;
  if (!raw || typeof raw !== 'string') return false;
  const set = new Set(raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
  return !!(email && set.has(String(email).trim().toLowerCase()));
}

/** 确保用户有 profile 行；返回 {role, membership, membershipSince, membershipExpires, name}。
 *  若邮箱属于管理员名单，自动把 role 提升为 admin 并落库（与 JWT 角色保持一致）。 */
async function ensureProfile(env, userId, email) {
  if (!env.DB) return { role: 'user', membership: 'none', name: email || null };
  await env.DB.prepare(
    `INSERT OR IGNORE INTO user_profiles (user_id, role, membership) VALUES (?, 'user', 'none')`
  ).bind(userId).run();
  const row = await env.DB.prepare('SELECT role, membership, membership_since, membership_expires, display_name FROM user_profiles WHERE user_id=?').bind(userId).first();
  let role = (row && row.role) || 'user';
  if (isAdminEmail(email, env) && role !== 'admin') {
    role = 'admin';
    await env.DB.prepare('UPDATE user_profiles SET role=? WHERE user_id=?').bind('admin', userId).run();
  }
  return {
    role,
    membership: (row && row.membership) || 'none',
    membershipSince: row ? row.membership_since : null,
    membershipExpires: row ? row.membership_expires : null,
    name: (row && row.display_name) || email || null,
  };
}

/** 生成 JWT 载荷里的角色/会员字段（供注册/登录/改密签发令牌时复用） */
async function issueClaims(env, userId, email) {
  const p = await ensureProfile(env, userId, email);
  return { role: p.role, m: p.membership, name: p.name };
}

async function setMembership(env, userId, type) {
  const now = Date.now();
  const existing = await env.DB.prepare('SELECT role FROM user_profiles WHERE user_id=?').bind(userId).first();
  if (existing) {
    await env.DB.prepare('UPDATE user_profiles SET membership=?, membership_since=?, membership_expires=? WHERE user_id=?')
      .bind(type, type === 'none' ? null : now, null, userId).run();
  } else {
    await env.DB.prepare('INSERT INTO user_profiles (user_id, role, membership, membership_since, membership_expires) VALUES (?,?,?,?,?)')
      .bind(userId, 'user', type, type === 'none' ? null : now, null).run();
  }
}

/* ---------- 会员激活码 ---------- */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去除易混字符 I/O/0/1
function genCode(len = 12) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return s;
}
/** 生成若干长期会员激活码（管理员用） */
export async function createActivationCodes(env, count, createdBy) {
  if (!env.DB) throw new Error('db_not_bound');
  const n = Math.max(1, Math.min(50, Number(count) || 1));
  const codes = [];
  for (let i = 0; i < n; i++) {
    let code = genCode(12), ok = false, tries = 0;
    while (!ok && tries++ < 6) {
      const dup = await env.DB.prepare('SELECT code FROM activation_codes WHERE code=?').bind(code).first();
      if (!dup) ok = true; else code = genCode(12);
    }
    await env.DB.prepare('INSERT INTO activation_codes (code, type, created_by, created_at, active) VALUES (?,?,?,?,1)')
      .bind(code, 'lifetime', createdBy || null, Date.now()).run();
    codes.push(code);
  }
  return codes;
}
/** 列出激活码（管理员用） */
export async function listActivationCodes(env) {
  if (!env.DB) return [];
  const { results } = await env.DB.prepare('SELECT code, type, created_by, created_at, claimed_by, claimed_at, active FROM activation_codes ORDER BY created_at DESC').all();
  return results || [];
}
/** 兑换激活码为长期会员（需登录）。user 为 resolveUser 的结果（含 userId/email/role/name/tv）。
 *  成功后同时签发新令牌（m='lifetime'），使会员状态立即在前端生效。 */
export async function redeemCode(rawCode, env, user) {
  if (!env.DB) throw new Error('db_not_bound');
  const code = String(rawCode || '').trim().toUpperCase();
  if (!code) return { ok: false, status: 400, body: { error: 'missing_code', message: '请输入激活码' } };
  const row = await env.DB.prepare('SELECT * FROM activation_codes WHERE code=?').bind(code).first();
  if (!row) return { ok: false, status: 404, body: { error: 'invalid_code', message: '激活码无效' } };
  if (row.active === 0) return { ok: false, status: 410, body: { error: 'code_disabled', message: '该激活码已停用' } };
  if (row.claimed_by) return { ok: false, status: 409, body: { error: 'code_used', message: '该激活码已被使用' } };
  await env.DB.prepare('UPDATE activation_codes SET claimed_by=?, claimed_at=? WHERE code=?').bind(user.userId, Date.now(), row.code).run();
  await setMembership(env, user.userId, 'lifetime');
  const token = await signToken({ sub: user.userId, email: user.email, tv: typeof user.tv === 'number' ? user.tv : 0, role: user.role || 'user', m: 'lifetime', name: user.name || null }, env.JWT_SECRET);
  return { ok: true, status: 200, body: { ok: true, membership: 'lifetime' }, token };
}

/* ---------- 用户列表（管理员用） ---------- */
export async function listUsers(env) {
  if (!env.DB) return [];
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.email, u.created_at, p.role, p.membership, p.membership_since
     FROM users u LEFT JOIN user_profiles p ON u.id=p.user_id
     ORDER BY u.created_at DESC`
  ).all();
  return results || [];
}

/* ---------- 找回密码（重置链接方案，无需邮件服务） ---------- */
const RESET_TTL_MS = 30 * 60 * 1000; // 30 分钟
export async function forgotPassword({ email }, env, origin) {
  if (!env.DB) return { status: 503, body: { error: 'db_not_bound', message: '服务端未配置数据库' } };
  const e = normalizeEmail(email);
  if (!e) return { status: 400, body: { error: 'invalid_email', message: '邮箱格式不正确' } };
  const row = await env.DB.prepare('SELECT id, email FROM users WHERE email=?').bind(e).first();
  if (!row) return { status: 404, body: { error: 'email_not_found', message: '该邮箱未注册' } };
  const token = genCode(20) + Date.now().toString(36) + genCode(8);
  await env.DB.prepare('INSERT INTO password_resets (token, user_id, email, expires_at, used) VALUES (?,?,?,?,0)')
    .bind(token, row.id, e, Date.now() + RESET_TTL_MS).run();
  const base = (origin || env.SITE_URL || 'https://nebula-zhihua.pages.dev').replace(/\/$/, '');
  const url = base + '/reset.html?token=' + encodeURIComponent(token);
  return { status: 200, body: { ok: true, resetUrl: url } };
}
export async function resetPassword({ token, newPassword }, env) {
  if (!env.DB) return { status: 503, body: { error: 'db_not_bound' } };
  if (!token) return { status: 400, body: { error: 'missing_token', message: '缺少重置令牌' } };
  const pwErr = validatePassword(newPassword);
  if (pwErr) return { status: 400, body: pwErr };
  const row = await env.DB.prepare('SELECT * FROM password_resets WHERE token=?').bind(token).first();
  if (!row) return { status: 404, body: { error: 'invalid_token', message: '令牌无效或已过期' } };
  if (row.used) return { status: 410, body: { error: 'token_used', message: '该链接已使用过，请重新申请' } };
  if (row.expires_at < Date.now()) return { status: 410, body: { error: 'token_expired', message: '链接已过期（30 分钟），请重新申请' } };
  const hash = await hashPassword(newPassword);
  // 重置密码即视为凭据泄露：令牌版本 +1，使所有旧会话失效
  let tvRow = null;
  try { tvRow = await env.DB.prepare('SELECT token_version FROM users WHERE id=?').bind(row.user_id).first(); } catch { tvRow = null; }
  const newTv = (tvRow ? Number(tvRow.token_version) || 0 : 0) + 1;
  try {
    await env.DB.prepare('UPDATE users SET password_hash=?, token_version=? WHERE id=?').bind(hash, newTv, row.user_id).run();
  } catch (e2) {
    if (String(e2 && e2.message || e2).includes('token_version')) {
      await env.DB.prepare('UPDATE users SET password_hash=? WHERE id=?').bind(hash, row.user_id).run();
    } else throw e2;
  }
  await env.DB.prepare('UPDATE password_resets SET used=1 WHERE token=?').bind(token).run();
  const u = await env.DB.prepare('SELECT id, email FROM users WHERE id=?').bind(row.user_id).first();
  const profile = await ensureProfile(env, u.id, u.email);
  const jwt = await signToken({ sub: u.id, email: u.email, tv: newTv, role: profile.role, m: profile.membership, name: profile.name }, env.JWT_SECRET);
  return { status: 200, body: { ok: true }, token: jwt };
}

/* ---------- 第三方登录（通用 OAuth2，支持 Google / GitHub / 微信 / QQ） ---------- */
const OAUTH = {
  google: {
    label: 'Google', auth: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token', userinfo: 'https://www.googleapis.com/oauth2/v2/userinfo',
    scope: 'openid email profile', envId: 'OAUTH_GOOGLE_ID', envSecret: 'OAUTH_GOOGLE_SECRET',
    bearer: true,
  },
  github: {
    label: 'GitHub', auth: 'https://github.com/login/oauth/authorize',
    token: 'https://github.com/login/oauth/access_token', userinfo: 'https://api.github.com/user',
    scope: 'read:user user:email', envId: 'OAUTH_GITHUB_ID', envSecret: 'OAUTH_GITHUB_SECRET',
    accept: 'application/json', github: true,
  },
  wechat: {
    label: '微信', auth: 'https://open.weixin.qq.com/connect/qrconnect',
    token: 'https://api.weixin.qq.com/sns/oauth2/access_token', userinfo: 'https://api.weixin.qq.com/sns/userinfo',
    scope: 'snsapi_login', envId: 'OAUTH_WECHAT_ID', envSecret: 'OAUTH_WECHAT_SECRET', wechat: true,
  },
  qq: {
    label: 'QQ', auth: 'https://graph.qq.com/oauth2.0/authorize',
    token: 'https://graph.qq.com/oauth2.0/token', userinfo: 'https://graph.qq.com/user/get_user_info',
    scope: 'get_user_info', envId: 'OAUTH_QQ_ID', envSecret: 'OAUTH_QQ_SECRET', qq: true,
  },
};
/** 返回当前已配置（有 AppID/Secret）的第三方登录提供商 */
export function oauthEnabled(env) {
  const out = {};
  for (const [k, c] of Object.entries(OAUTH)) {
    if (env && env[c.envId] && env[c.envSecret]) out[k] = { label: c.label };
  }
  return out;
}
function redirectUri(provider, base) {
  return base.replace(/\/$/, '') + '/api/auth/oauth/callback/' + provider;
}
/** 生成授权跳转 URL（state 由调用方存入 Cookie 防 CSRF） */
export function oauthAuthorizeUrl(provider, env, base, state) {
  const c = OAUTH[provider];
  if (!c || !env[c.envId] || !env[c.envSecret]) return null;
  const p = new URLSearchParams({ client_id: env[c.envId], redirect_uri: redirectUri(provider, base), response_type: 'code', scope: c.scope, state });
  if (c.wechat) { p.set('appid', env[c.envId]); }
  return c.auth + '?' + p.toString();
}
function oauthFallbackEmail(provider, pid) { return 'oauth_' + provider + '_' + pid + '@local'; }

/** 处理回调：用 code 换令牌 → 取用户信息 → 找到/创建用户 → 签发本站 JWT。返回 {status, body, token} */
export async function oauthCallback(provider, code, env, base) {
  const c = OAUTH[provider];
  if (!c) return { status: 400, body: { error: 'unknown_provider', message: '不支持的登录方式' } };
  if (!env.DB) return { status: 503, body: { error: 'db_not_bound' } };
  if (!env.JWT_SECRET) return { status: 500, body: { error: 'jwt_secret_missing' } };
  const redirect = redirectUri(provider, base);
  let accessToken, pid, email = null, name = null;

  if (c.wechat) {
    const j = await (await fetch(`https://api.weixin.qq.com/sns/oauth2/access_token?appid=${env[c.envId]}&secret=${env[c.envSecret]}&code=${code}&grant_type=authorization_code`)).json();
    if (j.errcode) return { status: 401, body: { error: 'oauth_failed', message: '微信授权失败：' + j.errmsg } };
    accessToken = j.access_token; pid = j.openid;
    const ui = await (await fetch(`${c.userinfo}?access_token=${accessToken}&openid=${pid}`)).json();
    email = oauthFallbackEmail(provider, pid); name = ui.nickname;
  } else if (c.qq) {
    const j = await (await fetch(`https://graph.qq.com/oauth2.0/token?grant_type=authorization_code&client_id=${env[c.envId]}&client_secret=${env[c.envSecret]}&code=${code}&redirect_uri=${encodeURIComponent(redirect)}&fmt=json`)).json();
    if (!j.access_token) return { status: 401, body: { error: 'oauth_failed', message: 'QQ 授权失败' } };
    accessToken = j.access_token;
    const me = await (await fetch(`https://graph.qq.com/oauth2.0/me?access_token=${accessToken}&fmt=json`)).json();
    pid = me.openid;
    const ui = await (await fetch(`${c.userinfo}?access_token=${accessToken}&oauth_consumer_key=${env[c.envId]}&openid=${pid}`)).json();
    email = oauthFallbackEmail(provider, pid); name = ui.nickname;
  } else {
    const body = new URLSearchParams({ client_id: env[c.envId], client_secret: env[c.envSecret], code, redirect_uri: redirect, grant_type: 'authorization_code' });
    const headers = c.accept ? { Accept: c.accept } : { 'Content-Type': 'application/x-www-form-urlencoded' };
    const r = await fetch(c.token, { method: 'POST', headers, body });
    const j = c.accept ? await r.json() : Object.fromEntries(new URLSearchParams(await r.text()));
    if (!j.access_token) return { status: 401, body: { error: 'oauth_failed', message: '授权令牌获取失败' } };
    accessToken = j.access_token;
    if (c.github) {
      const u = await (await fetch(c.userinfo, { headers: { Authorization: 'token ' + accessToken, 'User-Agent': 'zhihui' } })).json();
      name = u.name || u.login; pid = String(u.id);
      const em = await (await fetch('https://api.github.com/user/emails', { headers: { Authorization: 'token ' + accessToken, 'User-Agent': 'zhihui' } })).json();
      const primary = Array.isArray(em) && em.find((x) => x.primary && x.verified);
      email = primary ? primary.email : (u.email || null);
    } else { // google
      const j2 = await (await fetch(c.userinfo, { headers: { Authorization: 'Bearer ' + accessToken } })).json();
      email = j2.email; name = j2.name; pid = j2.id || j2.sub;
    }
  }

  // 找到或创建用户
  let userId = null;
  const ident = await env.DB.prepare('SELECT user_id FROM oauth_identities WHERE provider=? AND provider_id=?').bind(provider, pid).first();
  if (ident) userId = ident.user_id;
  else if (email && !email.startsWith('oauth_')) {
    const u = await env.DB.prepare('SELECT id FROM users WHERE email=?').bind(normalizeEmail(email) || email).first();
    if (u) userId = u.id;
  }
  const userEmail = email && !email.startsWith('oauth_') ? (normalizeEmail(email) || email) : oauthFallbackEmail(provider, pid);
  if (!userId) {
    const id = 'u_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    await env.DB.prepare('INSERT INTO users (id, email, password_hash, token_version, created_at) VALUES (?,?,?,?,?)')
      .bind(id, userEmail, null, 0, Date.now()).run();
    userId = id;
  }
  await env.DB.prepare('INSERT OR REPLACE INTO oauth_identities (provider, provider_id, user_id, email, name) VALUES (?,?,?,?,?)')
    .bind(provider, pid, userId, email, name).run();
  const profile = await ensureProfile(env, userId, userEmail);
  const u = await env.DB.prepare('SELECT email FROM users WHERE id=?').bind(userId).first();
  const jwt = await signToken({ sub: userId, email: u.email, tv: 0, role: profile.role, m: profile.membership, name: profile.name }, env.JWT_SECRET);
  return { status: 200, body: { ok: true, user: { id: userId, email: u.email, name: profile.name } }, token: jwt };
}
