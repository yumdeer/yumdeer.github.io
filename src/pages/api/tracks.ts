// GET /api/tracks — 曲目列表（音乐播放器用，公开只读）。
import type { APIRoute } from 'astro';
import { getDB, listTracks, r2Key } from '../../lib/db';

export const GET: APIRoute = async ({ locals }) => {
  const db = getDB();
  const tracks = await listTracks(db);
  return Response.json(
    tracks.map((t) => ({
      slug: t.slug,
      title: t.title,
      artist: t.artist ?? '',
      duration: t.duration_sec,
      url: `/api/media/${r2Key.audio(t.slug).replace('.mp3', '.mp3')}`,
    })),
  );
};
