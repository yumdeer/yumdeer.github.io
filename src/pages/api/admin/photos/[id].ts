// /api/admin/photos/[id] — DELETE 删除单张（R2 对象 + 数据行）| PUT 改标题
import type { APIRoute } from 'astro';
import { getDB, getR2, r2Key } from '../../../../lib/db';

async function photoWithProject(db: ReturnType<typeof getDB>, id: number) {
  return db
    .prepare(
      `SELECT p.id, p.slug, pr.slug AS project_slug FROM photos p
       JOIN projects pr ON pr.id = p.project_id WHERE p.id = ?`,
    )
    .bind(id)
    .first<{ id: number; slug: string; project_slug: string }>();
}

export const PUT: APIRoute = async ({ params, request, locals }) => {
  const db = getDB();
  const body = await request.json().catch(() => null);
  if (!body || typeof body.title !== 'string') return Response.json({ error: 'bad request' }, { status: 400 });
  await db.prepare('UPDATE photos SET title = ? WHERE id = ?').bind(body.title, Number(params.id)).run();
  return Response.json({ ok: true });
};

export const DELETE: APIRoute = async ({ params, locals }) => {
  const db = getDB();
  const r2 = getR2();
  const row = await photoWithProject(db, Number(params.id));
  if (!row) return Response.json({ error: 'not found' }, { status: 404 });

  if (r2) {
    await r2.delete(r2Key.photoFull(row.project_slug, row.slug)).catch(() => {});
    await r2.delete(r2Key.photoThumb(row.project_slug, row.slug)).catch(() => {});
  }
  await db.prepare('DELETE FROM photos WHERE id = ?').bind(row.id).run();
  return Response.json({ ok: true });
};
