// POST /api/admin/auth — { action: 'setup'|'login'|'logout'|'me', email?, password? }
// setup 仅在无用户时可用（首个注册者即管理员）。
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import {
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  countUsers,
  sessionCookie,
  clearSessionCookie,
  parseSessionCookie,
  getSessionUser,
} from '../../../lib/auth';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

export const POST: APIRoute = async ({ request, locals, cookies }) => {
  const db = env.DB;
  if (!db) return json({ error: '数据库未绑定' }, 500);

  let body: { action?: string; email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad request' }, 400);
  }

  // 注册（仅首次）
  if (body.action === 'setup') {
    const n = await countUsers(db);
    if (n > 0) return json({ error: '管理员已存在，请直接登录' }, 409);
    if (!body.email || !body.password || body.password.length < 8)
      return json({ error: '邮箱必填，密码至少 8 位' }, 400);
    const hash = await hashPassword(body.password);
    const r = await db
      .prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)')
      .bind(body.email, hash)
      .run();
    const token = await createSession(db, (r as any).meta.last_row_id);
    cookies.set('fd_session', token, { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 7 * 86400 });
    return json({ ok: true });
  }

  // 登录
  if (body.action === 'login') {
    if (!body.email || !body.password) return json({ error: '邮箱和密码必填' }, 400);
    const user = await db.prepare('SELECT id, password_hash FROM users WHERE email = ?')
      .bind(body.email).first<{ id: number; password_hash: string }>();
    if (!user || !(await verifyPassword(body.password, user.password_hash)))
      return json({ error: '邮箱或密码错误' }, 401);
    const token = await createSession(db, user.id);
    cookies.set('fd_session', token, { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 7 * 86400 });
    return json({ ok: true });
  }

  // 登出
  if (body.action === 'logout') {
    const token = parseSessionCookie(request.headers.get('cookie'));
    if (token) await destroySession(db, token);
    cookies.delete('fd_session', { path: '/' });
    return json({ ok: true });
  }

  // 当前用户
  if (body.action === 'me') {
    const token = parseSessionCookie(request.headers.get('cookie'));
    const user = token ? await getSessionUser(db, token) : null;
    return user ? json({ email: user.email }) : json({ error: 'unauthorized' }, 401);
  }

  return json({ error: 'unknown action' }, 400);
};

export const GET: APIRoute = async ({ request, locals }) => {
  const db = env.DB;
  const token = parseSessionCookie(request.headers.get('cookie'));
  const user = token && db ? await getSessionUser(db, token) : null;
  const n = db ? await countUsers(db) : -1;
  return json({ hasUsers: n > 0, loggedIn: !!user, email: user?.email ?? null });
};
