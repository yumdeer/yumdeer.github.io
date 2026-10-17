// /api/admin/about — POST 保存「INFO · 艺术家简介」正文（Markdown → D1 site_settings）
import type { APIRoute } from 'astro';
import { getDB, setSetting } from '../../../lib/db';

export const POST: APIRoute = async ({ request }) => {
  const body = await request.json().catch(() => null);
  if (!body || typeof body.aboutMd !== 'string')
    return Response.json({ error: 'aboutMd 必填（string）' }, { status: 400 });
  await setSetting(getDB(), 'about_md', body.aboutMd);
  return Response.json({ ok: true });
};
