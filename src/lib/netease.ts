// ────────────────────────────────────────────────────────────────────────────
//  网易云外链播放器 → 歌曲卡片。
//  网易云 outchain 播放器（music.163.com/outchain/player）已停止对外播放：
//  页面能加载出歌名，但内部不再创建 <audio>，点播放无反应（2026-10 实测）。
//  外链直链 song/media/outer/url 也已失效（返回 HTML）。
//  处理：文章渲染时把 iframe 替换为静态卡片（封面/歌名/歌手 + 跳转链接），
//  歌曲信息走仍存活的 song/detail API（服务端 fetch，绕开 CORS），
//  结果缓存进 D1 site_settings.netease_songs，避免每次渲染都请求网易。
// ────────────────────────────────────────────────────────────────────────────

export interface NeteaseSongInfo {
  name: string;
  artist: string;
  album: string;
  cover: string;
}

interface SongCache {
  [id: string]: { info: NeteaseSongInfo | null; at: number };
}

const CACHE_TTL = 7 * 24 * 3600 * 1000; // 成功结果缓存 7 天（失败不缓存，下次渲染重试）
const FETCH_TIMEOUT = 3000;

// 两种历史形态：编辑器插入的 iframe；以及兜底匹配任何 163 outchain iframe
const IFRAME_RE = /<iframe[^>]*music\.163\.com\/outchain\/player[^>]*\bid=(\d+)[^>]*>\s*<\/iframe>/g;

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const cardHtml = (id: string, info: NeteaseSongInfo | null) => {
  const title = info ? escapeHtml(info.name) : '网易云音乐';
  const artist = info ? escapeHtml(info.artist + (info.album ? ` · ${info.album}` : '')) : '点击打开收听';
  const cover = info?.cover
    ? `<img src="${escapeHtml(info.cover)}" alt="" loading="lazy" />`
    : '<div class="netease-cover-fallback">♪</div>';
  return `<div class="netease-card"><a href="https://music.163.com/song?id=${id}" target="_blank" rel="noopener noreferrer">${cover}<div class="netease-card-info"><p class="netease-card-title">${title}</p><p class="netease-card-artist">${artist}</p></div><span class="netease-card-go">打开 ↗</span></a></div>`;
};

async function fetchSongInfo(id: string): Promise<NeteaseSongInfo | null> {
  try {
    const r = await fetch(`https://music.163.com/api/song/detail/?id=${id}&ids=%5B${id}%5D`, {
      headers: { referer: 'https://music.163.com/' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    });
    if (!r.ok) return null;
    const data = (await r.json()) as {
      songs?: { name: string; artists?: { name: string }[]; album?: { name: string; picUrl?: string } }[];
    };
    const s = data.songs?.[0];
    if (!s) return null;
    return {
      name: s.name,
      artist: s.artists?.map((a) => a.name).join(' / ') ?? '',
      album: s.album?.name ?? '',
      cover: s.album?.picUrl ?? '',
    };
  } catch {
    return null; // 海外边缘节点可能被网易限制：渲染兜底卡片，不缓存
  }
}

import { getSetting, setSetting } from './db';

export async function enhanceNetease(
  html: string,
  db: Parameters<typeof getSetting>[0],
): Promise<string> {
  if (!html.includes('music.163.com')) return html;

  const ids = [...new Set([...html.matchAll(IFRAME_RE)].map((m) => m[1]))];
  if (ids.length === 0) return html;

  let cache: SongCache = {};
  try {
    cache = JSON.parse((await getSetting(db, 'netease_songs')) || '{}');
  } catch {}

  const infoMap = new Map<string, NeteaseSongInfo | null>();
  const now = Date.now();
  let cacheDirty = false;
  await Promise.all(
    ids.map(async (id) => {
      const hit = cache[id];
      if (hit && now - hit.at < CACHE_TTL) {
        infoMap.set(id, hit.info);
        return;
      }
      const info = await fetchSongInfo(id);
      infoMap.set(id, info);
      if (info) {
        cache[id] = { info, at: now };
        cacheDirty = true;
      }
    }),
  );

  if (cacheDirty) {
    // 上限 300 首：旧文被删后缓存不至于无限膨胀
    const entries = Object.entries(cache).sort((a, b) => b[1].at - a[1].at).slice(0, 300);
    try {
      await setSetting(db, 'netease_songs', JSON.stringify(Object.fromEntries(entries)));
    } catch {}
  }

  return html.replace(IFRAME_RE, (_m, id: string) => cardHtml(id, infoMap.get(id) ?? null));
}
