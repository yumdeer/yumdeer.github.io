// GET /api/tracks — 曲目列表 + 默认曲目（音乐播放器用，公开只读）。
// 响应 { tracks: [...], default: slug | null }。
import type { APIRoute } from 'astro';
import { getDB, getSetting, listTracks, r2Key } from '../../lib/db';

export const GET: APIRoute = async ({ locals }) => {
  const db = getDB();
  const tracks = await listTracks(db);
  const def = (await getSetting(db, 'default_track')) || null;
  return Response.json({
    tracks: tracks.map((t) => ({
      slug: t.slug,
      title: t.title,
      artist: t.artist ?? '',
      duration: t.duration_sec,
      // ?v= 破缓存：音频 URL 是稳定 slug（非内容寻址），又带 1 年 immutable
      // 长缓存——服务端修 bug / 换实现后，浏览器会一直用旧缓存条目，普通
      // 刷新也不重新拉。挂上曲目 id 作版本号，换个 URL 强制全端重新获取。
      url: `/api/media/${r2Key.audio(t.slug)}?v=${t.id}`,
    })),
    // 已删除的曲目残留设置时视为无默认
    default: def && tracks.some((t) => t.slug === def) ? def : null,
  });
};
