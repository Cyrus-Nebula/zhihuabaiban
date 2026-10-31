/**
 * 修改密码：POST /api/auth/change-password  {oldPassword, newPassword}
 * 需登录。成功后令牌版本 +1 并重签 Cookie（当前会话保持登录）。
 */
import { changePassword, cookieHeader } from '../../../auth/auth-backend.js';

export async function onRequestPost(context) {
  const body = await context.request.json().catch(() => ({}));
  const r = await changePassword(body, context.env, context.request);
  const headers = new Headers();
  if (r.token) headers.set('Set-Cookie', cookieHeader(r.token));
  return new Response(JSON.stringify(r.body), { status: r.status, headers });
}
