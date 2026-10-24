// /api/admin/fetch-image — 图片链接代理（管理员 URL 导入用）
// 外链图片直接画进 canvas 会被跨域污染（toBlob 抛 SecurityError），
// 前端改为 fetch 本代理（同源）拿字节，浏览器压缩管线（webp thumb/full +
// 24px blur）与本地文件上传完全复用，存进 R2 后与站内照片无任何差别。
// 安全线：仅 http(s)；拦截私网/回环主机（SSRF）；30MB 上限；20s 超时；
// content-type 须为图片类（octet-stream 也放行，最终由 createImageBitmap 判定）。
import type { APIRoute } from 'astro';

const MAX_BYTES = 30 * 1024 * 1024;
const TIMEOUT_MS = 20_000;

// 私网/回环/链路本地地址判定（个人站点管理员入口，基础防 SSRF 即可）
const isPrivateHost = (h: string) => {
  const host = h.toLowerCase().replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return true;
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    );
  }
  const v6 = host.match(/^\[?([0-9a-f:]+)\]?$/);
  if (v6) {
    const s = v6[1];
    return s === '::' || s === '::1' || s.startsWith('fc') || s.startsWith('fd') || s.startsWith('fe80');
  }
  return false;
};

export const GET: APIRoute = async ({ url }) => {
  const target = url.searchParams.get('url');
  if (!target) return Response.json({ error: '缺少 url 参数' }, { status: 400 });

  let u: URL;
  try {
    u = new URL(target);
  } catch {
    return Response.json({ error: 'URL 格式错误' }, { status: 400 });
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:')
    return Response.json({ error: '仅支持 http(s) 链接' }, { status: 400 });
  if (isPrivateHost(u.hostname))
    return Response.json({ error: '不允许访问内网地址' }, { status: 400 });

  let resp: Response;
  try {
    // 部分图床拦截无 UA 请求，带浏览器式 UA
    resp = await fetch(u.toString(), {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' },
    });
  } catch {
    return Response.json({ error: '拉取失败（超时或网络错误）' }, { status: 502 });
  }
  if (!resp.ok) return Response.json({ error: `源站返回 HTTP ${resp.status}` }, { status: 502 });

  const ct = (resp.headers.get('content-type') || '').toLowerCase();
  if (!ct.startsWith('image/') && !ct.includes('octet-stream'))
    return Response.json({ error: `不是图片（content-type: ${ct || '未知'}）` }, { status: 415 });
  if (Number(resp.headers.get('content-length') || 0) > MAX_BYTES)
    return Response.json({ error: '图片超过 30MB 上限' }, { status: 413 });

  const buf = await resp.arrayBuffer().catch(() => null);
  if (!buf || buf.byteLength === 0) return Response.json({ error: '拉取到空内容' }, { status: 502 });
  if (buf.byteLength > MAX_BYTES) return Response.json({ error: '图片超过 30MB 上限' }, { status: 413 });

  return new Response(buf, {
    headers: { 'content-type': ct || 'application/octet-stream', 'cache-control': 'no-store' },
  });
};
