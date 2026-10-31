/**
 * 删除账号：POST /api/auth/delete-account  {password}
 * 需登录且校验密码。删除该用户全部画板与账号本身，并清除登录 Cookie。
 */
import { deleteAccount, cookieHeader } from '../../../auth/auth-backend.js';

export async function onRequestPost(context) {
  try {
    const body = await context.request.json().catch(() => ({}));
    const r = await deleteAccount(body, context.env, context.request);
    // 无论成功与否都清掉 Cookie（删号成功即登出；密码错也不应保留旧会话意外）
    const headers = new Headers({ 'Set-Cookie': cookieHeader(null) });
    return new Response(JSON.stringify(r.body), { status: r.status, headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'internal', message: String((e && e.message) || e) }), { status: 500 });
  }
}
