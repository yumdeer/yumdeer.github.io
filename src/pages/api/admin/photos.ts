// /api/admin/photos — POST 上传照片（浏览器已压缩为 base64 webp）
//  body: { projectSlug, photos: [{ slug, title, thumbB64, fullB64, blurDataUrl, w, h }] }
// /api/admin/photos?reorder — PUT 批量更新排序/标题：{ updates: [{id, title?, sort_order?}] }
import type { APIRoute } from 'astro';
import { getDB, getR2, getProject, listPhotos, r2Key } from '../../../lib/db';

function b64ToBuf(b64: string): ArrayBuffer {
  const bin = atob(b64.includes(',') ? b64.split(',')[1] : b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

const slugify = (name: string) =>
  name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'photo';

export const POST: APIRoute = async ({ request, locals }) => {
  const db = getDB();
  const r2 = getR2();
  const body = await request.json().catch(() => null);
  if (!body?.projectSlug || !Array.isArray(body.photos) || !body.photos.length)
    return Response.json({ error: 'bad request' }, { status: 400 });

  const proj = await getProject(db, String(body.projectSlug));
  if (!proj) return Response.json({ error: '项目不存在' }, { status: 404 });
  if (!r2) return Response.json({ error: 'R2 未绑定' }, { status: 500 });

  const existing = new Set((await listPhotos(db, proj.id)).map((p) => p.slug));
  const maxSort = (await db
    .prepare('SELECT MAX(sort_order) AS m FROM photos WHERE project_id = ?')
    .bind(proj.id)
    .first<{ m: number | null }>()).m ?? -1;

  let sort = maxSort + 1;
  const created: string[] = [];
  const skipped: string[] = [];

  for (const p of body.photos) {
    let slug = slugify(String(p.name ?? 'photo'));
    let base = slug;
    let n = 1;
    while (existing.has(slug)) slug = `${base}-${n++}`; // 同名自动加后缀
    existing.add(slug);

    const meta = { 'content-type': 'image/webp' };
    await r2.put(r2Key.photoFull(proj.slug, slug), b64ToBuf(p.fullB64), { httpMetadata: meta });
    await r2.put(r2Key.photoThumb(proj.slug, slug), b64ToBuf(p.thumbB64), { httpMetadata: meta });

    await db
      .prepare(
        `INSERT INTO photos (project_id, slug, title, sort_order, w, h, blur)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(proj.id, slug, String(p.title ?? ''), sort++, Number(p.w) || 0, Number(p.h) || 0, p.blurDataUrl ?? null)
      .run();
    created.push(slug);
    if (slug !== slugify(String(p.name ?? ''))) skipped.push(`${p.name} → ${slug}`);
  }

  return Response.json({ ok: true, created, renamed: skipped });
};

export const PUT: APIRoute = async ({ request, locals }) => {
  const db = getDB();
  const body = await request.json().catch(() => null);
  if (!Array.isArray(body?.updates)) return Response.json({ error: 'bad request' }, { status: 400 });

  for (const u of body.updates) {
    if (typeof u.id !== 'number') continue;
    if (typeof u.title === 'string') {
      await db.prepare('UPDATE photos SET title = ? WHERE id = ?').bind(u.title, u.id).run();
    }
    if (typeof u.sort_order === 'number') {
      await db.prepare('UPDATE photos SET sort_order = ? WHERE id = ?').bind(u.sort_order, u.id).run();
    }
  }
  return Response.json({ ok: true });
};
