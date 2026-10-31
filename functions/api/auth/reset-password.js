/**
 * 重置密码（第二步）：POST /api/auth/reset-password  {token, newPassword}
 * 校验令牌后更新密码（并使所有旧会话失效），成功后下发新 Cookie 直接登录。
 */
import { resetPassword, cookieHeader } from '../../../auth/auth-backend.js';

export async function onRequestPost(context) {
  try {
    const body = await context.request.json().catch(() => ({}));
    const r = await resetPassword(body, context.env);
    const headers = new Headers();
    if (r.token) headers.set('Set-Cookie', cookieHeader(r.token));
    return new Response(JSON.stringify(r.body), { status: r.status, headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'internal', message: String((e && e.message) || e) }), { status: 500 });
  }
}
