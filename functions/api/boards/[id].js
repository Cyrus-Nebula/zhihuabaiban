/**
 * 云端画板：单条获取与删除
 *   GET    /api/boards/:id    -> {id,name,mode,content,createdAt,updatedAt}
 *   DELETE /api/boards/:id    -> 删除
 * 需要登录，且只能操作自己 user_id 下的画板。
 */
import { resolveUser, dbGetBoard, dbDeleteBoard } from '../../../auth/auth-backend.js';

export async function onRequestGet(context) {
  try {
    const user = await resolveUser(context.request, context.env);
    if (!user.authenticated) return json({ error: 'unauthenticated' }, 401);
    if (!context.env.DB) return json({ error: 'db_not_bound' }, 503);
    const id = decodeURIComponent(context.params.id);
    const board = await dbGetBoard(context.env, user.userId, id);
    if (!board) return json({ error: 'not_found' }, 404);
    return json(board);
  } catch (e) {
    return json({ error: 'internal', message: String((e && e.message) || e) }, 500);
  }
}

export async function onRequestDelete(context) {
  try {
    const user = await resolveUser(context.request, context.env);
    if (!user.authenticated) return json({ error: 'unauthenticated' }, 401);
    if (!context.env.DB) return json({ error: 'db_not_bound' }, 503);
    const id = decodeURIComponent(context.params.id);
    await dbDeleteBoard(context.env, user.userId, id);
    return json({ ok: true });
  } catch (e) {
    return json({ error: 'internal', message: String((e && e.message) || e) }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
