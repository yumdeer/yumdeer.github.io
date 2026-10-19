// /api/admin/projects/[slug] — PUT 更新元数据（含改名）| DELETE 删除（含 R2 照片与数据行）
import type { APIRoute } from 'astro';
import { getDB, getR2, listPhotos, r2Key, type PhotoRow } from '../../../../lib/db';

export const PUT: APIRoute = async ({ params, request }) => {
  const db = getDB();
  const body = await request.json().catch(() => null);
  if (!body) return Response.json({ error: 'bad request' }, { status: 400 });

  const oldSlug = params.slug!;
  let newSlug: string | null = null;
  let renamePhotos: PhotoRow[] = [];

  // ── 改 slug：R2 里照片对象 key 嵌着项目 slug（img/<proj>/<photo>/…），
  // 必须同步迁移对象，否则前台图片全部 404。顺序：先全部复制到新 key
  // （任一失败即中止，旧数据完好）→ 更新 D1 → 删旧 key（残留无害）。──
  if (typeof body.slug === 'string' && body.slug.trim() !== oldSlug) {
    newSlug = body.slug.trim();
    if (!/^[\w-]+$/.test(newSlug)) {
      return Response.json({ error: 'slug 只能包含字母、数字、-、_' }, { status: 400 });
    }
    const dup = await db
      .prepare('SELECT id FROM projects WHERE slug = ? AND slug != ?')
      .bind(newSlug, oldSlug)
      .first();
    if (dup) return Response.json({ error: `slug「${newSlug}」已被其他项目使用` }, { status: 409 });

    const proj = await db.prepare('SELECT id FROM projects WHERE slug = ?').bind(oldSlug).first<{ id: number }>();
    if (!proj) return Response.json({ error: 'not found' }, { status: 404 });

    renamePhotos = await listPhotos(db, proj.id);
    const r2 = getR2();
    for (const p of renamePhotos) {
      for (const [src, dest] of [
        [r2Key.photoFull(oldSlug, p.slug), r2Key.photoFull(newSlug, p.slug)],
        [r2Key.photoThumb(oldSlug, p.slug), r2Key.photoThumb(newSlug, p.slug)],
      ] as const) {
        const obj = await r2.get(src).catch(() => null);
        if (!obj) continue; // 脏数据缺对象：跳过，不阻断改名
        await r2.put(dest, obj.body, { httpMetadata: obj.httpMetadata });
      }
    }
  }

  const fields: string[] = [];
  const values: unknown[] = [];
  for (const k of ['title', 'category', 'year', 'description', 'sort_order'] as const) {
    if (k in body) {
      fields.push(`${k} = ?`);
      values.push(k === 'sort_order' ? Number(body[k]) || 0 : body[k] === '' ? null : body[k]);
    }
  }
  if (newSlug) {
    fields.push('slug = ?');
    values.push(newSlug);
  }
  if (fields.length) {
    fields.push("updated_at = datetime('now')");
    values.push(oldSlug);
    await db.prepare(`UPDATE projects SET ${fields.join(', ')} WHERE slug = ?`).bind(...values).run();
  }

  // D1 已指向新 key：清理旧目录（失败仅残留无引用对象，不影响前台）
  if (newSlug && renamePhotos.length) {
    const r2 = getR2();
    for (const p of renamePhotos) {
      await r2.delete(r2Key.photoFull(oldSlug, p.slug)).catch(() => {});
      await r2.delete(r2Key.photoThumb(oldSlug, p.slug)).catch(() => {});
    }
  }
  return Response.json({ ok: true, slug: newSlug ?? oldSlug });
};

export const DELETE: APIRoute = async ({ params }) => {
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
