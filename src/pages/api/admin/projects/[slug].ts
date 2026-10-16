// /api/admin/projects/[slug] — PUT 更新元数据 | DELETE 删除（含 R2 照片与数据行）
import type { APIRoute } from 'astro';
import { getDB, getR2, listPhotos, r2Key } from '../../../../lib/db';

export const PUT: APIRoute = async ({ params, request, locals }) => {
  const db = getDB();
  const body = await request.json().catch(() => null);
  if (!body) return Response.json({ error: 'bad request' }, { status: 400 });

  const fields: string[] = [];
  const values: unknown[] = [];
  for (const k of ['title', 'category', 'year', 'description', 'sort_order'] as const) {
    if (k in body) {
      fields.push(`${k} = ?`);
      values.push(k === 'sort_order' ? Number(body[k]) || 0 : body[k] === '' ? null : body[k]);
    }
  }
  if (fields.length) {
    fields.push("updated_at = datetime('now')");
    values.push(params.slug);
    await db.prepare(`UPDATE projects SET ${fields.join(', ')} WHERE slug = ?`).bind(...values).run();
  }
  return Response.json({ ok: true });
};

export const DELETE: APIRoute = async ({ params, locals }) => {
  const db = getDB();
  const r2 = getR2();
  const slug = params.slug!;

  const proj = await db.prepare('SELECT id FROM projects WHERE slug = ?').bind(slug).first<{ id: number }>();
  if (!proj) return Response.json({ error: 'not found' }, { status: 404 });

  const photos = await listPhotos(db, proj.id);
  if (r2) {
    for (const p of photos) {
      await r2.delete(r2Key.photoFull(slug, p.slug)).catch(() => {});
      await r2.delete(r2Key.photoThumb(slug, p.slug)).catch(() => {});
    }
  }
  await db.prepare('DELETE FROM projects WHERE id = ?').bind(proj.id).run(); // 级联删照片行
  return Response.json({ ok: true });
};
