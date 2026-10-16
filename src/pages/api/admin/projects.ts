// /api/admin/projects — GET 列表 | POST 新建
import type { APIRoute } from 'astro';
import { getDB, listProjects } from '../../../lib/db';

export const GET: APIRoute = async ({ locals }) => {
  const db = getDB();
  return Response.json(await listProjects(db));
};

export const POST: APIRoute = async ({ request, locals }) => {
  const db = getDB();
  const body = await request.json().catch(() => null);
  if (!body?.title) return Response.json({ error: '标题必填' }, { status: 400 });

  // slug：优先显式指定，否则由标题生成（中文标题用拼音不可行，退化为 project-N）
  let slug: string = typeof body.slug === 'string' && body.slug
    ? body.slug.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
    : '';
  if (!slug) {
    const r = await db.prepare('SELECT COUNT(*) AS n FROM projects').first<{ n: number }>();
    slug = `project-${(r?.n ?? 0) + 1}`;
  }
  const exists = await db.prepare('SELECT 1 FROM projects WHERE slug = ?').bind(slug).first();
  if (exists) return Response.json({ error: `slug "${slug}" 已存在` }, { status: 409 });

  await db
    .prepare(
      `INSERT INTO projects (slug, title, category, year, description, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      slug,
      String(body.title),
      String(body.category || '作品'),
      body.year ? String(body.year) : null,
      body.description ? String(body.description) : null,
      Number(body.sort_order) || 0,
    )
    .run();
  return Response.json({ ok: true, slug });
};
