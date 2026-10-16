// GET /api/media/[...key] — 从 R2 流式返回图片/音频。
// key 形如 img/digital/digital-01/full.webp 或 audio/xxx.mp3。
// 带长缓存（内容寻址：每次上传生成新文件名）。
import type { APIRoute } from 'astro';
import { getR2 } from '../../../lib/db';

export const GET: APIRoute = async ({ params, locals }) => {
  const key = params.key;
  if (!key || key.includes('..')) return new Response('Not found', { status: 404 });

  const r2 = getR2();
  const obj = await r2.get(key);
  if (!obj) return new Response('Not found', { status: 404 });

  const type = key.endsWith('.mp3')
    ? 'audio/mpeg'
    : key.endsWith('.webp')
      ? 'image/webp'
      : 'application/octet-stream';

  return new Response(obj.body, {
    headers: {
      'content-type': obj.httpMetadata?.['content-type'] ?? type,
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
};
