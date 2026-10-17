// ────────────────────────────────────────────────────────────────────────────
//  Middleware — /admin/** 与 /api/admin/** 需要登录会话；未登录跳 login。
//  公开页面不拦截，但附带登录态（locals.user）：Layout 据此注入前台
//  "所见即所得"编辑模式（EditKit），访客无感知。
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

  const token = parseSessionCookie(request.headers.get('cookie'));
  const db = env.DB;

  if (!needsAuth) {
    // 公开页面：有会话就解析出用户（供编辑模式），无会话零开销直通
    if (!token || !db) return next();
    return (async () => {
      const user = await getSessionUser(db, token);
      if (user) (locals as any).user = user;
      return next();
    })();
  }

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
