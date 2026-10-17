// /api/admin/articles — GET 列表（含草稿）| POST 新建/更新
//  POST body: { slug?, collection, title, description?, bodyMd, coverUrl?, coverAlt?, pubDate?, draft? }
//  带 slug = 更新，不带 = 新建。
import type { APIRoute } from 'astro';
import { getDB, listArticles, getArticle } from '../../../lib/db';
import { parseMarkdown } from '../../../lib/markdown';

export const GET: APIRoute = async ({ locals }) => {
  const db = getDB();
  return Response.json(await listArticles(db, { includeDrafts: true }));
};

export const POST: APIRoute = async ({ request, locals }) => {
  const db = getDB();
  const body = await request.json().catch(() => null);
  if (!body?.title) return Response.json({ error: '标题必填' }, { status: 400 });

  // 分类：内置 photography/tech 保留（兼容旧数据与路由），允许自定义（如"生活"），
  // 也允许为空（未分类——分类不是必填项）
  const collection = ['photography', 'tech'].includes(body.collection)
    ? body.collection
    : String(body.collection ?? 'photography').trim().slice(0, 20);

  // 粘贴整篇带 frontmatter 的 Markdown（可包含 title 等元数据）
  let title = String(body.title);
  let description = body.description ? String(body.description) : null;
  let bodyMd = String(body.bodyMd ?? '');
  if (body.parseFrontmatter && bodyMd.trim()) {
    const parsed = parseMarkdown(bodyMd);
    title = parsed.title ?? title;
    description = parsed.description ?? description;
    bodyMd = parsed.body;
    if (parsed.pubDate && !body.pubDate) body.pubDate = parsed.pubDate;
    if (parsed.draft) body.draft = true;
  }

  // 更新已有文章
  if (body.slug) {
    const exists = await getArticle(db, String(body.slug));
    if (!exists) return Response.json({ error: '文章不存在' }, { status: 404 });
    await db
      .prepare(
        `UPDATE articles SET collection=?, title=?, description=?, body_md=?, cover_url=?, cover_alt=?,
         pub_date=?, draft=?, updated_at=datetime('now') WHERE slug=?`,
      )
      .bind(
        collection, title, description, bodyMd,
        body.coverUrl ? String(body.coverUrl) : null,
        body.coverAlt ? String(body.coverAlt) : null,
        String(body.pubDate || exists.pub_date),
        body.draft ? 1 : 0,
        String(body.slug),
      )
      .run();
    return Response.json({ ok: true, slug: body.slug });
  }

  // 新建：slug 由标题生成（保留中文字符——hexo 迁移文章的中文 slug 路由已验证可行）
  let slug: string = String(title).toLowerCase().replace(/[^a-z0-9-\u4e00-\u9fff]+/g, '-').replace(/^-+|-+$/g, '');
  if (!slug) {
    const r = await db.prepare('SELECT COUNT(*) AS n FROM articles').first<{ n: number }>();
    slug = `article-${(r?.n ?? 0) + 1}`;
  }
  let base = slug, n = 1;
  while (await getArticle(db, slug)) slug = `${base}-${n++}`;

  const pubDate = String(body.pubDate || new Date().toISOString().slice(0, 10));
  await db
    .prepare(
      `INSERT INTO articles (slug, collection, title, description, body_md, cover_url, cover_alt, pub_date, draft)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      slug, collection, title, description, bodyMd,
      body.coverUrl ? String(body.coverUrl) : null,
      body.coverAlt ? String(body.coverAlt) : null,
      pubDate, body.draft ? 1 : 0,
    )
    .run();
  return Response.json({ ok: true, slug });
};
