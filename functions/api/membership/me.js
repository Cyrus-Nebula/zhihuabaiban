/**
 * 会员状态探针：GET /api/membership/me
 * 返回 {authenticated, role, membership, membershipSince, name, email}。
 */
import { resolveUser } from '../../../auth/auth-backend.js';

export async function onRequestGet(context) {
  const user = await resolveUser(context.request, context.env);
  if (!user.authenticated) return new Response(JSON.stringify({ authenticated: false }), { status: 200 });
  let since = null;
  if (context.env.DB) {
    const row = await context.env.DB.prepare('SELECT membership_since FROM user_profiles WHERE user_id=?').bind(user.userId).first().catch(() => null);
    if (row) since = row.membership_since;
  }
  return new Response(JSON.stringify({
    authenticated: true,
    role: user.role,
    membership: user.membership,
    membershipSince: since,
    name: user.name,
    email: user.email,
  }), { status: 200 });
}
