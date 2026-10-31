/**
 * 登出：POST /api/auth/logout
 * 清除 auth_token Cookie。
 */
import { cookieHeader } from '../../../auth/auth-backend.js';

export async function onRequestPost() {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Set-Cookie': cookieHeader(null) },
  });
}
