/**
 * 注册：POST /api/auth/register  {email, password}
 * 成功后写入 httpOnly Cookie（auth_token）。
 */
import { registerUser, cookieHeader } from '../../../auth/auth-backend.js';

export async function onRequestPost(context) {
  try {
    const body = await context.request.json().catch(() => ({}));
    const r = await registerUser(body, context.env);
    const headers = new Headers();
    if (r.token) headers.set('Set-Cookie', cookieHeader(r.token));
    return new Response(JSON.stringify(r.body), { status: r.status, headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'internal', message: String((e && e.message) || e) }), { status: 500 });
  }
}
