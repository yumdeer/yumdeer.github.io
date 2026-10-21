// /api/admin/projects/[slug] — PUT 更新元数据（含改名 / 主页上墙开关）| DELETE 删除
// 改名+有照片时 PUT 返回 NDJSON 流：每迁完一张照片推一行 {progress,total}，
// 前端据此渲染进度条（迁移较慢，逐对象复制 R2 无 rename）。
import type { APIRoute } from 'astro';
import { getDB, getR2, listPhotos, r2Key, getHiddenProjects, setHiddenProjects, type PhotoRow } from '../../../../lib/db';

export const PUT: APIRoute = async ({ params, request }) => {
  const db = getDB();
  const body = await request.json().catch(() => null);
  if (!body) return Response.json({ error: 'bad request' }, { status: 400 });
  const oldSlug = params.slug!;

  // 主页显示墙开关（独立于元数据保存，点击即生效）：true = 不上墙
  if (typeof body.hideFromHome === 'boolean') {
    const list = await getHiddenProjects(db);
    const i = list.indexOf(oldSlug);
    if (body.hideFromHome && i === -1) list.push(oldSlug);
    if (!body.hideFromHome && i !== -1) list.splice(i, 1);
    await setHiddenProjects(db, list);
    return Response.json({ ok: true, hidden: body.hideFromHome });
  }

  const newSlug =
    typeof body.slug === 'string' && body.slug.trim() !== oldSlug ? body.slug.trim() : null;
  if (newSlug && !/^[\w-]+$/.test(newSlug)) {
    return Response.json({ error: 'slug 只能包含字母、数字、-、_' }, { status: 400 });
  }

  // 元数据字段（两条路径共用）
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const k of ['title', 'category', 'year', 'description', 'sort_order'] as const) {
    if (k in body) {
      fields.push(`${k} = ?`);
      values.push(k === 'sort_order' ? Number(body[k]) || 0 : body[k] === '' ? null : body[k]);
    }
  }

  // 提交 D1 更新（改 slug 必须等 R2 复制全部完成后再调用）
  const applyUpdate = async () => {
    if (!fields.length && !newSlug) return;
    const f = [...fields];
    const v = [...values];
    if (newSlug) {
      f.push('slug = ?');
      v.push(newSlug);
    }
    f.push("updated_at = datetime('now')");
    v.push(oldSlug);
    await db.prepare(`UPDATE projects SET ${f.join(', ')} WHERE slug = ?`).bind(...v).run();
  };

  // ── 快路径：不改名，或改名但项目无照片（无对象要迁）→ 普通JSON ──
  if (!newSlug) {
    await applyUpdate();
    return Response.json({ ok: true, slug: oldSlug });
  }
  const dup = await db
    .prepare('SELECT id FROM projects WHERE slug = ? AND slug != ?')
    .bind(newSlug, oldSlug)
    .first();
  if (dup) return Response.json({ error: `slug「${newSlug}」已被其他项目使用` }, { status: 409 });
  const proj = await db.prepare('SELECT id FROM projects WHERE slug = ?').bind(oldSlug).first<{ id: number }>();
  if (!proj) return Response.json({ error: 'not found' }, { status: 404 });
  const photos: PhotoRow[] = await listPhotos(db, proj.id);
  if (!photos.length) {
    await applyUpdate();
    // 「不上墙」列表同步换新 slug（快路径改名）
    const hidden = await getHiddenProjects(db);
    const hi = hidden.indexOf(oldSlug);
    if (hi !== -1) {
      hidden[hi] = newSlug;
      await setHiddenProjects(db, hidden);
    }
    return Response.json({ ok: true, slug: newSlug });
  }

  // ── 慢路径：改名 + 有照片 → NDJSON 进度流 ──
  // 照片对象 key 嵌着项目 slug（img/<proj>/<photo>/…）。顺序：逐张复制到新
  // key（任一失败即中止，旧数据完好）→ 更新 D1 → 删旧 key（残留无害）。
  const r2 = getR2();
  const total = photos.length;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // enqueue 在客户端断开后会抛错：让它抛（中断迁移、保持旧状态可服务），
      // 错误上报的 send 再套 try 吞掉
      const send = (obj: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
      try {
        send({ progress: 0, total });
        for (let i = 0; i < total; i++) {
          const p = photos[i];
          for (const [src, dest] of [
            [r2Key.photoFull(oldSlug, p.slug), r2Key.photoFull(newSlug, p.slug)],
            [r2Key.photoThumb(oldSlug, p.slug), r2Key.photoThumb(newSlug, p.slug)],
          ] as const) {
            const obj = await r2.get(src).catch(() => null);
            if (!obj) continue; // 脏数据缺对象：跳过，不阻断改名
            await r2.put(dest, obj.body, { httpMetadata: obj.httpMetadata });
          }
          send({ progress: i + 1, total });
        }
        await applyUpdate();
        // 「不上墙」列表里若含旧 slug，同步换成新 slug
        const hidden = await getHiddenProjects(db);
        const hi = hidden.indexOf(oldSlug);
        if (hi !== -1) {
          hidden[hi] = newSlug;
          await setHiddenProjects(db, hidden);
        }
        // D1 已指向新 key：清理旧目录（失败仅残留无引用对象，不影响前台）
        for (const p of photos) {
          await r2.delete(r2Key.photoFull(oldSlug, p.slug)).catch(() => {});
          await r2.delete(r2Key.photoThumb(oldSlug, p.slug)).catch(() => {});
        }
        send({ ok: true, slug: newSlug });
      } catch (e) {
        // 中止整体：D1 未更新，站点仍走旧 slug（若此时已 applyUpdate 则仅
        // 残留无引用的新对象，同样安全）
        try {
          send({ error: e instanceof Error ? e.message : String(e) });
        } catch {}
      }
      try {
        controller.close();
      } catch {}
    },
  });
  return new Response(stream, {
    headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' },
  });
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
  // 从「不上墙」列表移除（避免残留死 slug）
  const hidden = await getHiddenProjects(db);
  const hi = hidden.indexOf(slug);
  if (hi !== -1) {
    hidden.splice(hi, 1);
    await setHiddenProjects(db, hidden);
  }
  return Response.json({ ok: true });
};
