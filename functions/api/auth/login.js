/**
 * 登录：POST /api/auth/login  {email, password}
 * 成功后写入 httpOnly Cookie（auth_token）。失败过多会返回 429 + Retry-After。
 */
import { loginUser, cookieHeader } from '../../../auth/auth-backend.js';

export async function onRequestPost(context) {
  try {
    const body = await context.request.json().catch(() => ({}));
    const r = await loginUser(body, context.env, context.request);
    const headers = new Headers();
    if (r.token) headers.set('Set-Cookie', cookieHeader(r.token));
    if (r.status === 429 && r.retryAfterSec) headers.set('Retry-After', String(r.retryAfterSec));
    return new Response(JSON.stringify(r.body), { status: r.status, headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'internal', message: String((e && e.message) || e) }), { status: 500 });
  }
}
