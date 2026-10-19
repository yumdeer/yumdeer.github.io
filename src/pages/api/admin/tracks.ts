// /api/admin/tracks — GET 列表 | POST 上传曲目（base64 mp3 + 元数据）
//  | PUT 设置默认曲目 body: { default: slug | null }（存 site_settings.default_track）
import type { APIRoute } from 'astro';
import { getDB, getR2, listTracks, r2Key, setSetting } from '../../../lib/db';
import { b64ToBuf } from '../../../lib/b64';

const slugify = (name: string) =>
  name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'track';

export const GET: APIRoute = async ({ locals }) => {
  const db = getDB();
  return Response.json(await listTracks(db));
};

// 默认曲目：打开播放器面板时自动开始播放的那首（null = 无默认）
export const PUT: APIRoute = async ({ request, locals }) => {
  const db = getDB();
  const body = await request.json().catch(() => null);
  if (!body || !('default' in body)) return Response.json({ error: 'bad request' }, { status: 400 });

  if (body.default === null || body.default === '') {
    await setSetting(db, 'default_track', '');
    return Response.json({ ok: true, default: null });
  }
  const slug = String(body.default);
  const exists = await db.prepare('SELECT 1 FROM tracks WHERE slug = ?').bind(slug).first();
  if (!exists) return Response.json({ error: '曲目不存在' }, { status: 404 });
  await setSetting(db, 'default_track', slug);
  return Response.json({ ok: true, default: slug });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const db = getDB();
  const r2 = getR2();
  const body = await request.json().catch(() => null);
  if (!body?.audioB64 || !body?.title) return Response.json({ error: '标题与音频文件必填' }, { status: 400 });
  if (!r2) return Response.json({ error: 'R2 未绑定' }, { status: 500 });

  let slug = slugify(String(body.name || body.title));
  let base = slug, n = 1;
  while (await db.prepare('SELECT 1 FROM tracks WHERE slug = ?').bind(slug).first()) slug = `${base}-${n++}`;

  await r2.put(r2Key.audio(slug), await b64ToBuf(body.audioB64), {
    httpMetadata: { 'content-type': 'audio/mpeg' },
  });

  const maxSort = (await db.prepare('SELECT MAX(sort_order) AS m FROM tracks').first<{ m: number | null }>()).m ?? -1;
  await db
    .prepare('INSERT INTO tracks (slug, title, artist, duration_sec, sort_order) VALUES (?, ?, ?, ?, ?)')
    .bind(slug, String(body.title), body.artist ? String(body.artist) : '', Number(body.durationSec) || 0, maxSort + 1)
    .run();
  return Response.json({ ok: true, slug });
};
