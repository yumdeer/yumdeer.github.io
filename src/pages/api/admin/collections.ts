// /api/admin/collections — DELETE 删除自定义分类
//  分类不是独立表，而是 articles.collection 的值：删除 = 把该分类下的
//  文章全部设为未分类（collection=''，分类可为空，不强制迁移）。
//  内置 photography/tech 不可删（历史路由依赖）。
import type { APIRoute } from 'astro';
import { getDB } from '../../../lib/db';

const BUILTIN = ['photography', 'tech'];

export const DELETE: APIRoute = async ({ url, locals }) => {
  const db = getDB();
  const name = url.searchParams.get('name')?.trim();
  if (!name) return Response.json({ error: '缺少分类名' }, { status: 400 });
  if (BUILTIN.includes(name)) {
    return Response.json({ error: '内置分类不可删除' }, { status: 400 });
  }

  const r = await db
    .prepare("UPDATE articles SET collection='', updated_at=datetime('now') WHERE collection=?")
    .bind(name)
    .run();
  return Response.json({ ok: true, updated: (r.meta as { changes?: number }).changes ?? 0 });
};
