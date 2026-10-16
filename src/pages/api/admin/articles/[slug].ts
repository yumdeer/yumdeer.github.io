// /api/admin/articles/[slug] — DELETE 删除文章
import type { APIRoute } from 'astro';
import { getDB } from '../../../../lib/db';

export const DELETE: APIRoute = async ({ params, locals }) => {
  const db = getDB();
  const r = await db.prepare('DELETE FROM articles WHERE slug = ?').bind(params.slug).run();
  return Response.json({ ok: true });
};
