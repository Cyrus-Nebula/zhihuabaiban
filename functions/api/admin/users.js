/**
 * 管理员 · 用户列表：GET /api/admin/users
 * 仅管理员可访问。返回全部用户（邮箱、角色、会员、注册时间）。
 */
import { resolveUser, isAdminEmail, listUsers } from '../../../auth/auth-backend.js';

function isAdmin(user, env) {
  return !!(user && user.authenticated && (user.role === 'admin' || isAdminEmail(user.email, env)));
}
function json(obj, status) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestGet(context) {
  const user = await resolveUser(context.request, context.env);
  if (!isAdmin(user, context.env)) return json({ error: 'forbidden', message: '需要管理员权限' }, 403);
  const users = await listUsers(context.env);
  return json({ users }, 200);
}
