// /api/admin/article-media — 文章内嵌媒体上传（不进 photos/tracks 表）
//  body: { kind: 'image', name, b64 }        → R2 img/article/{name}.webp，返回 { url }
//        { kind: 'audio', name, b64 }        → R2 audio/article/{name}.mp3，返回 { url }
// 图片由浏览器端压缩为 webp base64；音频为 mp3 base64（与曲目上传同链路）。
import type { APIRoute } from 'astro';
import { getR2, r2Key } from '../../../lib/db';
import { b64ToBuf } from '../../../lib/b64';

const slugify = (name: string) =>
  name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'media';

export const POST: APIRoute = async ({ request }) => {
  const body = await request.json().catch(() => null);
  if (!body?.b64 || !body?.name) return Response.json({ error: '参数缺失' }, { status: 400 });

  // 文件名加随机后缀，避免同名覆盖已插入正文的旧图
  const name = `${slugify(String(body.name))}-${Math.random().toString(36).slice(2, 6)}`;

  if (body.kind === 'image') {
    const r2 = getR2();
    await r2.put(r2Key.articleImage(name), await b64ToBuf(body.b64), {
      httpMetadata: { 'content-type': 'image/webp' },
    });
    return Response.json({ url: `/api/media/${r2Key.articleImage(name)}` });
  }

  if (body.kind === 'audio') {
    const r2 = getR2();
    await r2.put(r2Key.articleAudio(name), await b64ToBuf(body.b64), {
      httpMetadata: { 'content-type': 'audio/mpeg' },
    });
    return Response.json({ url: `/api/media/${r2Key.articleAudio(name)}` });
  }

  return Response.json({ error: 'kind 必须是 image 或 audio' }, { status: 400 });
};
