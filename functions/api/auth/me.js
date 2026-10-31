/**
 * 当前登录态探针：GET /api/auth/me
 * 前端加载时调用，返回 {authenticated, userId?, email?}。
 */
import { resolveUser } from '../../../auth/auth-backend.js';

export async function onRequestGet(context) {
  const user = await resolveUser(context.request, context.env);
  return new Response(JSON.stringify(user), { status: 200 });
}
