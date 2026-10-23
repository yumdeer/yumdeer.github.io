// GET /api/media/[...key] — 从 R2 返回图片/音频。
// key 形如 img/digital/digital-01/full.webp 或 audio/xxx.mp3。
//
// ⚠️ 绝不能把 r2.get(...).body 流式直通返回：实测该流式管道只有 ~3KB/s，
// 9MB 音频要 40 分钟才能下完，audio 元素永远缓冲不够（点击播放无反应）。
// 照片几百 KB 感知不到，音频必坏。必须 arrayBuffer() 一次性读入再返回，
// Workers 内存上限 128MB，音频/图片远小于此。
//
// 音频必须支持 Range（206）：浏览器 media 管线 seek/缓冲依赖它，
// Safari 甚至完全拒绝播放无 Range 支持的音频。
// 带长缓存（内容寻址：每次上传生成新文件名）。
import type { APIRoute } from 'astro';
import { getR2 } from '../../../lib/db';

// 解析 Range 头，返回 { offset, length }；null = 无/不合法（按普通 200 处理）
const parseRange = (header: string | undefined, size: number): { offset: number; length: number } | 'invalid' | null => {
  if (!header) return null;
  const m = header.match(/^bytes=(\d*)-(\d*)$/);
  if (!m || (!m[1] && !m[2])) return 'invalid';
  let offset: number;
  let end: number; // 含端点
  if (!m[1]) {
    // bytes=-N ：最后 N 字节
    const n = Number(m[2]);
    if (n === 0) return 'invalid';
    offset = Math.max(0, size - n);
    end = size - 1;
  } else {
    offset = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  if (offset > end || offset >= size) return 'invalid';
  return { offset, length: end - offset + 1 };
};

// 单次 Range 响应最多 2MB：浏览器点播放会发 Range: bytes=0- 开放式全量
// 请求，9MB 音频在慢网络（国内→美西）下持续传输会占满 HTTP/2 单连接的
// 拥塞窗口，把页面导航/图片请求全部挤成"等歌曲下完才响应"。
// 服务端分片：开放式/大段请求只回 2MB（约 50 秒缓冲 @320kbps），浏览器
// 收够即停，播放推进到需要时再发 bytes=N- 取下一段——传输从持续占用
// 变为间歇分片，导航请求获得喘息窗口。客户端明确要的小段（如 Safari
// 的 bytes=0-1 探测）不受影响。
const MAX_CHUNK = 2 * 1024 * 1024;

export const GET: APIRoute = async ({ params, request }) => {
  const key = params.key;
  if (!key || key.includes('..')) return new Response('Not found', { status: 404 });

  const r2 = getR2();

  // 先 head 拿大小（Range 校验 + Content-Length 都需要），R2 head 不读体，开销极小
  const head = await r2.head(key);
  if (!head) return new Response('Not found', { status: 404 });
  const size = head.size;

  const type = key.endsWith('.mp3')
    ? 'audio/mpeg'
    : key.endsWith('.webp')
      ? 'image/webp'
      : 'application/octet-stream';
  const contentType = head.httpMetadata?.['content-type'] ?? type;
  const baseHeaders: Record<string, string> = {
    'content-type': contentType,
    'cache-control': 'public, max-age=31536000, immutable',
    'accept-ranges': 'bytes',
  };

  const range = parseRange(request.headers.get('range'), size);
  if (range === 'invalid')
    return new Response('Range Not Satisfiable', {
      status: 416,
      headers: { ...baseHeaders, 'content-range': `bytes */${size}` },
    });

  if (range) {
    const length = Math.min(range.length, MAX_CHUNK);
    const obj = await r2.get(key, { range: { offset: range.offset, length } });
    if (!obj) return new Response('Not found', { status: 404 });
    const buf = await obj.arrayBuffer();
    return new Response(buf, {
      status: 206,
      headers: {
        ...baseHeaders,
        'content-length': String(buf.byteLength),
        'content-range': `bytes ${range.offset}-${range.offset + buf.byteLength - 1}/${size}`,
      },
    });
  }

  const obj = await r2.get(key);
  if (!obj) return new Response('Not found', { status: 404 });
  const buf = await obj.arrayBuffer();
  return new Response(buf, {
    status: 200,
    headers: { ...baseHeaders, 'content-length': String(buf.byteLength) },
  });
};
