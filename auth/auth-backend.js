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
    return { authenticated: true, userId: payload.sub, email: payload.email || null };
  } catch {
    return { authenticated: false };
  }
}

/** 注册：校验 → 查重 → 写 users 表 → 签 JWT。返回 {status, body, token} */
export async function registerUser({ email, password }, env) {
  if (!env.DB) return { status: 503, body: { error: 'db_not_bound', message: '服务端未配置数据库' }, token: null };
  if (!env.JWT_SECRET) return { status: 500, body: { error: 'jwt_secret_missing' }, token: null };
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
  const token = await signToken({ sub: id, email: e, tv: 0 }, env.JWT_SECRET);
  return { status: 200, body: { ok: true, user: { id, email: e } }, token };
}

/** 登录：限流检查 → 校验 → 取用户 → 验密码 → 签 JWT。返回 {status, body, token, retryAfterSec?} */
export async function loginUser({ email, password }, env, request) {
  if (!env.DB) return { status: 503, body: { error: 'db_not_bound', message: '服务端未配置数据库' }, token: null };
  if (!env.JWT_SECRET) return { status: 500, body: { error: 'jwt_secret_missing' }, token: null };
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
  const token = await signToken({ sub: row.id, email: row.email, tv: Number(row.token_version) || 0 }, env.JWT_SECRET);
  return { status: 200, body: { ok: true, user: { id: row.id, email: row.email } }, token };
}

/** 修改密码（需登录）：验旧密 → 改哈希 → token_version+1 → 重签令牌（当前会话保持登录） */
export async function changePassword({ oldPassword, newPassword }, env, request) {
  const user = await resolveUser(request, env);
  if (!user.authenticated) return { status: 401, body: { error: 'unauthenticated', message: '请先登录' }, token: null };
  if (!env.DB) return { status: 503, body: { error: 'db_not_bound' }, token: null };
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
  const token = await signToken({ sub: user.userId, email: user.email, tv: newTv }, env.JWT_SECRET);
  return { status: 200, body: { ok: true }, token };
}

/** 删除账号（需登录）：验密 → 删该用户全部画板与用户本身 → 清 Cookie 登出 */
export async function deleteAccount({ password }, env, request) {
  const user = await resolveUser(request, env);
  if (!user.authenticated) return { status: 401, body: { error: 'unauthenticated', message: '请先登录' }, token: null };
  if (!env.DB) return { status: 503, body: { error: 'db_not_bound' }, token: null };
  if (!password || typeof password !== 'string') return { status: 400, body: { error: 'missing_fields', message: '请输入密码确认' }, token: null };
  const row = await env.DB.prepare('SELECT password_hash FROM users WHERE id=?').bind(user.userId).first();
  if (!row) return { status: 401, body: { error: 'unauthenticated' }, token: null };
  if (!(await verifyPassword(password, row.password_hash))) {
    return { status: 400, body: { error: 'wrong_password', message: '密码不正确' }, token: null };
  }
  await env.DB.prepare('DELETE FROM boards WHERE user_id=?').bind(user.userId).run();
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
