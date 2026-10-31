/**
 * 找回密码（第一步）：POST /api/auth/forgot-password  {email}
 * 生成重置令牌并放回重置链接。当前为「重置链接」方案——链接直接在响应里返回，
 * 由用户/管理员转达给本人（无需任何外部邮件服务）。配置 RESEND_API_KEY 后可改为真发邮件。
 */
import { forgotPassword } from '../../../auth/auth-backend.js';

export async function onRequestPost(context) {
  try {
    const body = await context.request.json().catch(() => ({}));
    const origin = new URL(context.request.url).origin;
    const r = await forgotPassword(body, context.env, origin);
    return new Response(JSON.stringify(r.body), { status: r.status });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'internal', message: String((e && e.message) || e) }), { status: 500 });
  }
}
