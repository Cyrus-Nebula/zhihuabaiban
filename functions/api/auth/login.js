/**
 * 登录：POST /api/auth/login  {email, password}
 * 成功后写入 httpOnly Cookie（auth_token）。
 */
import { loginUser, cookieHeader } from '../../../auth/auth-backend.js';

export async function onRequestPost(context) {
  const body = await context.request.json().catch(() => ({}));
  const r = await loginUser(body, context.env);
  const headers = new Headers();
  if (r.token) headers.set('Set-Cookie', cookieHeader(r.token));
  return new Response(JSON.stringify(r.body), { status: r.status, headers });
}
