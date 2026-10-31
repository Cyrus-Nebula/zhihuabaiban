/**
 * 第三方登录 · 授权跳转：GET /api/auth/oauth/<provider>
 * provider ∈ {google, github, wechat, qq}。未配置该提供商的 AppID/Secret 时跳转回首页并带错误参数。
 * 生成 state 写入 HttpOnly Cookie 防 CSRF，再 302 到服务商授权页。
 */
import { oauthAuthorizeUrl } from '../../../../auth/auth-backend.js';

function randomState() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
}

export async function onRequestGet(context) {
  const provider = context.params.provider;
  const origin = new URL(context.request.url).origin;
  const state = randomState();
  const url = oauthAuthorizeUrl(provider, context.env, origin, state);
  if (!url) {
    return new Response(null, { status: 302, headers: { Location: origin + '/?oauth=unsupported' } });
  }
  const cookie = `oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`;
  return new Response(null, { status: 302, headers: { Location: url, 'Set-Cookie': cookie } });
}
