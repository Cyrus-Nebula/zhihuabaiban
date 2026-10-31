/**
 * 第三方登录 · 回调：GET /api/auth/oauth/callback/<provider>?code=...&state=...
 * 校验 state 防 CSRF → 换取令牌并登录 → 下发本站 Cookie → 跳回首页。
 */
import { oauthCallback, cookieHeader } from '../../../../../auth/auth-backend.js';

function redirect(loc) {
  return new Response(null, { status: 302, headers: { Location: loc } });
}

export async function onRequestGet(context) {
  const provider = context.params.provider;
  const origin = new URL(context.request.url).origin;
  const url = new URL(context.request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookieState = (context.request.headers.get('Cookie') || '').match(/(?:^|;\s*)oauth_state=([^;]+)/);
  if (!code) return redirect(origin + '/?oauth=error');
  if (!state || !cookieState || cookieState[1] !== state) return redirect(origin + '/?oauth=state_mismatch');

  const r = await oauthCallback(provider, code, context.env, origin);
  if (!r.token) return redirect(origin + '/?oauth=error');

  const headers = new Headers({ Location: origin + '/?oauth=success' });
  headers.append('Set-Cookie', cookieHeader(r.token));
  headers.append('Set-Cookie', 'oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0');
  return new Response(null, { status: 302, headers });
}
