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
      url: `/api/media/${r2Key.audio(t.slug)}`,
    })),
    // 已删除的曲目残留设置时视为无默认
    default: def && tracks.some((t) => t.slug === def) ? def : null,
  });
};
