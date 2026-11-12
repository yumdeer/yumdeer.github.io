// GET /api/handbooks/:id/download — 下载手册（R2 代理）
// 支持 Range（PDF 阅读器按需分片），非 Range 请求计一次下载。
import type { APIRoute } from 'astro';
import { getDB, getR2 } from '../../../../lib/db';
import { getHandbook } from '../../../../lib/handbooks';

const MAX_CHUNK = 8 * 1024 * 1024;

const parseRange = (header: string | undefined, size: number) => {
  if (!header) return null;
  const m = header.match(/^bytes=(\d*)-(\d*)$/);
  if (!m || (!m[1] && !m[2])) return 'invalid' as const;
  let offset: number;
  let end: number;
  if (!m[1]) {
    const n = Number(m[2]);
    if (!n) return 'invalid' as const;
    offset = Math.max(0, size - n);
    end = size - 1;
  } else {
    offset = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  if (offset > end || offset >= size) return 'invalid' as const;
  return { offset, length: end - offset + 1 };
};

export const GET: APIRoute = async ({ params, request }) => {
  const id = Number(params.id);
  if (!Number.isFinite(id)) return new Response('Bad request', { status: 400 });

  const db = getDB();
  const row = await getHandbook(db, id);
  if (!row) return new Response('Not found', { status: 404 });

  const r2 = getR2();
  if (!r2) return new Response('R2 未绑定', { status: 500 });
  const head = await r2.head(row.r2_key);
  if (!head) return new Response('Not found', { status: 404 });

  const size = head.size;
  const fileName = row.file_name || `${row.title}.pdf`;
  const headers: Record<string, string> = {
    'content-type': 'application/pdf',
    'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    'cache-control': 'private, max-age=0',
    'accept-ranges': 'bytes',
  };

  const range = parseRange(request.headers.get('range'), size);
  if (range === 'invalid')
    return new Response('Range Not Satisfiable', {
      status: 416,
      headers: { ...headers, 'content-range': `bytes */${size}` },
    });

  if (range) {
    const length = Math.min(range.length, MAX_CHUNK);
    const obj = await r2.get(row.r2_key, { range: { offset: range.offset, length } });
    if (!obj) return new Response('Not found', { status: 404 });
    const buf = await obj.arrayBuffer();
    return new Response(buf, {
      status: 206,
      headers: {
        ...headers,
        'content-length': String(buf.byteLength),
        'content-range': `bytes ${range.offset}-${range.offset + buf.byteLength - 1}/${size}`,
      },
    });
  }

  const obj = await r2.get(row.r2_key);
  if (!obj) return new Response('Not found', { status: 404 });
  const buf = await obj.arrayBuffer();
  await db.prepare('UPDATE handbooks SET downloads = downloads + 1 WHERE id = ?').bind(id).run();

  return new Response(buf, {
    status: 200,
    headers: { ...headers, 'content-length': String(buf.byteLength) },
  });
};
