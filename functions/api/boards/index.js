/**
 * 云端画板：列表与保存
 *   GET  /api/boards          -> 当前登录用户的所有画板（{id,name,mode,updatedAt}）
 *   POST /api/boards          -> 保存/更新一个画板（upsert），body: {id,name,mode,content}
 * 需要登录（从 Cookie 解 JWT）。未登录返回 401。
 */
import { resolveUser, dbListBoards, dbUpsertBoard } from '../../../auth/auth-backend.js';

export async function onRequestGet(context) {
  const user = await resolveUser(context.request, context.env);
  if (!user.authenticated) return json({ error: 'unauthenticated' }, 401);
  if (!context.env.DB) return json({ error: 'db_not_bound' }, 503);
  const list = await dbListBoards(context.env, user.userId);
  return json(list);
}

export async function onRequestPost(context) {
  const user = await resolveUser(context.request, context.env);
  if (!user.authenticated) return json({ error: 'unauthenticated' }, 401);
  if (!context.env.DB) return json({ error: 'db_not_bound' }, 503);
  const body = await context.request.json().catch(() => ({}));
  if (!body || !body.id) return json({ error: 'board_id_required' }, 400);
  try {
    await dbUpsertBoard(context.env, user.userId, body);
    return json({ ok: true, id: body.id });
  } catch (e) {
    return json({ error: 'upsert_failed', message: String(e && e.message || e) }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
