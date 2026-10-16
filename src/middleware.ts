// ────────────────────────────────────────────────────────────────────────────
//  Middleware — /admin/** 与 /api/admin/** 需要登录会话；未登录跳 login。
//  公开页面与 /api/media、/api/tracks 不做保护。
// ────────────────────────────────────────────────────────────────────────────
import { defineMiddleware } from 'astro:middleware';
import { env } from 'cloudflare:workers';
import { parseSessionCookie, getSessionUser } from './lib/auth';

export const onRequest = defineMiddleware((context, next) => {
  const { url, request, locals, redirect } = context;
  const path = url.pathname;

  const needsAuth =
    (path.startsWith('/admin') && path !== '/admin/login' && path !== '/admin/setup') ||
    // /api/admin/auth 是登录入口本身（login/logout/me 各自校验凭据），必须匿名可达
    (path.startsWith('/api/admin') && path !== '/api/admin/auth');

  if (!needsAuth) return next();

  const token = parseSessionCookie(request.headers.get('cookie'));
  const db = env.DB;

  return (async () => {
    const user = token && db ? await getSessionUser(db, token) : null;
    if (user) {
      (locals as any).user = user;
      return next();
    }
    if (path.startsWith('/api/')) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    }
    return redirect('/admin/login');
  })();
});
