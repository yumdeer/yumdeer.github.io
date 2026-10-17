// /api/admin/collections — DELETE 删除自定义分类
//  分类不是独立表，而是 articles.collection 的值：删除 = 把该分类下的
//  文章全部迁入目标分类（默认摄影随笔），迁完该分类自然从选项消失。
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
  const moveTo = url.searchParams.get('moveTo')?.trim() || 'photography';
  if (moveTo === name) {
    return Response.json({ error: '迁移目标不能是被删分类本身' }, { status: 400 });
  }

  const r = await db
    .prepare("UPDATE articles SET collection=?, updated_at=datetime('now') WHERE collection=?")
    .bind(moveTo, name)
    .run();
  return Response.json({ ok: true, moved: (r.meta as { changes?: number }).changes ?? 0, moveTo });
};
