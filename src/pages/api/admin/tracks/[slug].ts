// /api/admin/tracks/[slug] — DELETE 删除曲目（R2 对象 + 数据行）
import type { APIRoute } from 'astro';
import { getDB, getR2, r2Key } from '../../../../lib/db';

export const DELETE: APIRoute = async ({ params, locals }) => {
  const db = getDB();
  const r2 = getR2();
  const row = await db.prepare('SELECT slug FROM tracks WHERE slug = ?').bind(params.slug).first<{ slug: string }>();
  if (!row) return Response.json({ error: 'not found' }, { status: 404 });
  if (r2) await r2.delete(r2Key.audio(row.slug)).catch(() => {});
  await db.prepare('DELETE FROM tracks WHERE slug = ?').bind(row.slug).run();
  return Response.json({ ok: true });
};
