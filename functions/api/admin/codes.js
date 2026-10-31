/**
 * 管理员 · 会员激活码：GET 列表 / POST 生成（count 个，默认 1，最多 50）
 * 仅管理员（ADMIN_EMAILS 中的邮箱，或 role=admin）可访问。
 */
import { resolveUser, isAdminEmail, listActivationCodes, createActivationCodes } from '../../../auth/auth-backend.js';

function isAdmin(user, env) {
  return !!(user && user.authenticated && (user.role === 'admin' || isAdminEmail(user.email, env)));
}
function json(obj, status) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestGet(context) {
  const user = await resolveUser(context.request, context.env);
  if (!isAdmin(user, context.env)) return json({ error: 'forbidden', message: '需要管理员权限' }, 403);
  const list = await listActivationCodes(context.env);
  return json({ codes: list }, 200);
}

export async function onRequestPost(context) {
  const user = await resolveUser(context.request, context.env);
  if (!isAdmin(user, context.env)) return json({ error: 'forbidden', message: '需要管理员权限' }, 403);
  const body = await context.request.json().catch(() => ({}));
  const count = Number(body.count) || 1;
  const codes = await createActivationCodes(context.env, count, user.email);
  return json({ ok: true, codes }, 200);
}
