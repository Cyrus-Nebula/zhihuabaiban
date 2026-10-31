/**
 * 兑换会员激活码：POST /api/membership/redeem  {code}
 * 需登录。成功后该账号升级为长期会员，并下发新 Cookie 使会员状态立即生效。
 */
import { resolveUser, redeemCode, cookieHeader } from '../../../auth/auth-backend.js';

export async function onRequestPost(context) {
  try {
    const user = await resolveUser(context.request, context.env);
    if (!user.authenticated) return json({ error: 'unauthenticated', message: '请先登录' }, 401);
    const body = await context.request.json().catch(() => ({}));
    const r = await redeemCode(body.code, context.env, user);
    const headers = new Headers();
    if (r.token) headers.set('Set-Cookie', cookieHeader(r.token));
    return new Response(JSON.stringify(r.body), { status: r.status, headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'internal', message: String((e && e.message) || e) }), { status: 500 });
  }
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
