// /api/admin/handbooks — 手册管理（鉴权由 middleware 统一处理）
//  GET    列表
//  POST   上传：{ title, description?, name, b64, size? }
//  PUT    更新：{ id, title?, description?, sort_order? }
//  DELETE ?id=  删除（同时清理 R2 文件）
import type { APIRoute } from 'astro';
import { getDB, getR2 } from '../../../lib/db';
import { b64ToBuf } from '../../../lib/b64';
import { listHandbooks, insertHandbook, deleteHandbook } from '../../../lib/handbooks';

const MAX_BYTES = 90 * 1024 * 1024; // Workers 请求体上限内留余量

const slugify = (name: string) =>
  name
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'manual';

export const GET: APIRoute = async () => {
  const db = getDB();
  return Response.json(await listHandbooks(db));
};

export const POST: APIRoute = async ({ request }) => {
  const db = getDB();
  const r2 = getR2();
  if (!r2) return Response.json({ error: 'R2 未绑定' }, { status: 500 });

  const body = await request.json().catch(() => null);
  if (!body?.title || !body?.b64) return Response.json({ error: '标题和文件必填' }, { status: 400 });

  const buf = await b64ToBuf(String(body.b64));
  if (!buf.byteLength) return Response.json({ error: '文件为空' }, { status: 400 });
  if (buf.byteLength > MAX_BYTES) return Response.json({ error: '文件超过 90MB' }, { status: 413 });

  const fileName = String(body.name || 'manual.pdf').replace(/[\\/\r\n]+/g, ' ').slice(-120);
  const key = `docs/${slugify(fileName)}-${Date.now().toString(36)}.pdf`;

  await r2.put(key, buf, { httpMetadata: { 'content-type': 'application/pdf' } });

  const row = await insertHandbook(db, {
    title: String(body.title).slice(0, 120),
    description: String(body.description ?? '').slice(0, 500),
    r2Key: key,
    fileName,
    size: buf.byteLength,
  });

  return Response.json({ ok: true, item: row });
};

export const PUT: APIRoute = async ({ request }) => {
  const db = getDB();
  const body = await request.json().catch(() => null);
  if (typeof body?.id !== 'number') return Response.json({ error: 'bad request' }, { status: 400 });

  const sets: string[] = [];
  const args: unknown[] = [];
  if (typeof body.title === 'string') {
    sets.push('title = ?');
    args.push(body.title.slice(0, 120));
  }
  if (typeof body.description === 'string') {
    sets.push('description = ?');
    args.push(body.description.slice(0, 500));
  }
  if (typeof body.sort_order === 'number') {
    sets.push('sort_order = ?');
    args.push(body.sort_order);
  }
  if (!sets.length) return Response.json({ ok: true });

  args.push(body.id);
  await db.prepare(`UPDATE handbooks SET ${sets.join(', ')} WHERE id = ?`).bind(...args).run();
  return Response.json({ ok: true });
};

export const DELETE: APIRoute = async ({ request, url }) => {
  const db = getDB();
  const body = await request.json().catch(() => null);
  const id = Number(url.searchParams.get('id') ?? body?.id);
  if (!Number.isFinite(id)) return Response.json({ error: 'bad request' }, { status: 400 });

  const ok = await deleteHandbook(db, id);
  return ok ? Response.json({ ok: true }) : Response.json({ error: '不存在' }, { status: 404 });
};
