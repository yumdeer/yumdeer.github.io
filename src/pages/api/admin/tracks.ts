// /api/admin/tracks — GET 列表 | POST 上传曲目（base64 mp3 + 元数据）
//  body: { name, title, artist?, durationSec, audioB64 }
import type { APIRoute } from 'astro';
import { getDB, getR2, listTracks, r2Key } from '../../../lib/db';
import { b64ToBuf } from '../../../lib/b64';

const slugify = (name: string) =>
  name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'track';

export const GET: APIRoute = async ({ locals }) => {
  const db = getDB();
  return Response.json(await listTracks(db));
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
