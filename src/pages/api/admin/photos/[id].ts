// /api/admin/photos/[id] — DELETE 删除单张（R2 对象 + 数据行）| PUT 改标题 / 移动到其他项目
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
  if (!body) return Response.json({ error: 'bad request' }, { status: 400 });
  const id = Number(params.id);

  // 改标题（原有能力）
  if (typeof body.title === 'string') {
    await db.prepare('UPDATE photos SET title = ? WHERE id = ?').bind(body.title, id).run();
  }

  // ── 移动到其他项目 ──
  // R2 照片 key 嵌着项目 slug（img/<proj>/<photo>/…），必须同步迁移对象，
  // 否则新项目里 404。顺序：先复制到新 key（失败即中止，旧数据完好）→
  // 更新 D1 → 删旧 key（残留无害）。
  if (typeof body.toProjectSlug === 'string') {
    const row = await photoWithProject(db, id);
    if (!row) return Response.json({ error: 'not found' }, { status: 404 });
    const target = await db
      .prepare('SELECT id, slug FROM projects WHERE slug = ?')
      .bind(body.toProjectSlug)
      .first<{ id: number; slug: string }>();
    if (!target) return Response.json({ error: '目标项目不存在' }, { status: 404 });
    if (target.slug === row.project_slug) return Response.json({ ok: true }); // 同项目 no-op

    // 目标项目已有同名照片（UNIQUE(project_id, slug)）→ 自动加 -2/-3 后缀
    let newSlug = row.slug;
    for (let i = 2; ; i++) {
      const dup = await db
        .prepare('SELECT 1 FROM photos WHERE project_id = ? AND slug = ?')
        .bind(target.id, newSlug)
        .first();
      if (!dup) break;
      newSlug = `${row.slug}-${i}`;
    }

    const r2 = getR2();
    if (r2) {
      for (const [src, dest] of [
        [r2Key.photoFull(row.project_slug, row.slug), r2Key.photoFull(target.slug, newSlug)],
        [r2Key.photoThumb(row.project_slug, row.slug), r2Key.photoThumb(target.slug, newSlug)],
      ] as const) {
        const obj = await r2.get(src).catch(() => null);
        if (!obj) continue; // 脏数据缺对象：跳过，不阻断移动
        await r2.put(dest, obj.body, { httpMetadata: obj.httpMetadata });
      }
    }

    // 追加到目标项目末尾，保持其原有顺序不被打乱
    const max = await db
      .prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM photos WHERE project_id = ?')
      .bind(target.id)
      .first<{ next: number }>();
    await db
      .prepare('UPDATE photos SET project_id = ?, slug = ?, sort_order = ? WHERE id = ?')
      .bind(target.id, newSlug, max?.next ?? 0, id)
      .run();

    // D1 已指向新 key：清理旧对象（失败仅残留无引用文件）
    if (r2) {
      await r2.delete(r2Key.photoFull(row.project_slug, row.slug)).catch(() => {});
      await r2.delete(r2Key.photoThumb(row.project_slug, row.slug)).catch(() => {});
    }
    return Response.json({ ok: true, slug: newSlug });
  }

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
