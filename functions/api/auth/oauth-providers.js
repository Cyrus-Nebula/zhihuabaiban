/**
 * 已启用的第三方登录提供商：GET /api/auth/oauth-providers
 * 返回 {providers: {google:{label}, github:..., wechat:..., qq:...}}（仅含已配置 AppID/Secret 的）。
 * 前端据此决定是否显示对应按钮，无需把密钥暴露给浏览器。
 */
import { oauthEnabled } from '../../../auth/auth-backend.js';

export async function onRequestGet(context) {
  return new Response(JSON.stringify({ providers: oauthEnabled(context.env) }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
