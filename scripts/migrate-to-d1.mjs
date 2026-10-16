#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────────────────
//  migrate-to-d1 — 把仓库里的静态内容一次性迁移进本地 D1 + R2（.wrangler/state）：
//    1. src/assets/projects/<slug>/*.{jpg,jpeg,png,webp,avif} + meta.json
//         → R2 webp（full 2400 / thumb 800 / blur 24px）+ photos 表
//    2. src/content/{photography,tech}/*.md(x)（含 MDX 组件语法降级）
//         → articles 表
//
//  通过 getPlatformProxy 拿到的绑定与 `astro dev`（platformProxy）共享同一份
//  本地状态，迁移完直接 npm run dev 即可看到数据。
//
//  幂等：可重复执行 — 项目按 slug 覆盖元数据并重建照片，文章按 slug 覆盖。
//  用法：npm run migrate:d1     （仅本地；生产内容走管理后台重新上传）
// ────────────────────────────────────────────────────────────────────────────
import { readdir, readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getPlatformProxy } from 'wrangler';
import sharp from 'sharp';
import matter from 'gray-matter';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS_DIR = path.join(ROOT, 'src/assets/projects');
const CONTENT_DIR = path.join(ROOT, 'src/content');
const IMG_RE = /\.(jpe?g|png|webp|avif)$/i;

// MDX 组件语法降级（逻辑与 src/lib/markdown.ts 的 mdxToMarkdown 保持一致；
// 这里是纯 JS 脚本，不能直接 import TS 模块，故复制实现）
const mdxToMarkdown = (body) =>
  body
    .replace(/^import .*$/gm, '')
    .replace(
      /<Photo\s+src="([^"]+)"\s*(?:caption="([^"]*)")?\s*\/>/g,
      (_m, src, cap) => `![${cap ?? ''}](${src})`,
    )
    .replace(/<Gallery\s+photos=\{\[(.*?)\]\}\s*\/>/g, (_m, list) =>
      (list.match(/"([^"]+)"/g) ?? [])
        .map((s) => s.replace(/^"|"$/g, ''))
        .map((src) => `![](${src})`)
        .join('\n\n'),
    )
    .trim();

async function runSchema(DB) {
  const sql = await readFile(path.join(ROOT, 'src/db/schema.sql'), 'utf8');
  const stmts = sql
    .replace(/--.*$/gm, '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const s of stmts) await DB.prepare(s).run();
  console.log(`  schema: ${stmts.length} 条语句执行完毕（IF NOT EXISTS，幂等）`);
}

async function migrateProject(env, dir) {
  const slug = path.basename(dir);
  const meta = JSON.parse(await readFile(path.join(dir, 'meta.json'), 'utf8'));
  const files = (await readdir(dir)).filter((f) => IMG_RE.test(f)).sort();
  if (!files.length) return { project: slug, photos: 0 };

  // 项目按 slug upsert
  const existing = await env.DB.prepare('SELECT id FROM projects WHERE slug = ?').bind(slug).first();
  let projectId;
  if (existing) {
    await env.DB
      .prepare(
        'UPDATE projects SET title = ?, category = ?, year = ?, description = ?, updated_at = datetime("now") WHERE id = ?',
      )
      .bind(meta.title ?? slug, meta.category ?? '作品', meta.year ?? null, meta.description ?? null, existing.id)
      .run();
    projectId = existing.id;
  } else {
    const next = await env.DB
      .prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM projects')
      .first();
    const r = await env.DB
      .prepare('INSERT INTO projects (slug, title, category, year, description, sort_order) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(slug, meta.title ?? slug, meta.category ?? '作品', meta.year ?? null, meta.description ?? null, next?.n ?? 0)
      .run();
    projectId = r.meta.last_row_id;
  }

  // 照片按项目重建（先删旧行；R2 同名 key 直接覆盖）
  await env.DB.prepare('DELETE FROM photos WHERE project_id = ?').bind(projectId).run();

  let n = 0;
  for (const [i, file] of files.entries()) {
    const photoSlug = path.basename(file, path.extname(file));
    const buf = await readFile(path.join(dir, file));
    const img = sharp(buf).rotate(); // 尊重 EXIF 方向
    const full = await img
      .clone()
      .resize(2400, 2400, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    const thumb = await img
      .clone()
      .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
    const blurBuf = await img.clone().resize(24).webp({ quality: 30 }).toBuffer();
    const blur = `data:image/webp;base64,${blurBuf.toString('base64')}`;

    await env.R2.put(`img/${slug}/${photoSlug}/full.webp`, full.data, {
      httpMetadata: { contentType: 'image/webp' },
    });
    await env.R2.put(`img/${slug}/${photoSlug}/thumb.webp`, thumb, {
      httpMetadata: { contentType: 'image/webp' },
    });
    await env.DB
      .prepare('INSERT INTO photos (project_id, slug, title, sort_order, w, h, blur) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(projectId, photoSlug, '', i, full.info.width, full.info.height, blur)
      .run();
    n++;
    console.log(`    ${slug}/${photoSlug} → webp ${full.info.width}x${full.info.height} (${(full.data.length / 1024).toFixed(0)} KiB full, ${(thumb.length / 1024).toFixed(0)} KiB thumb)`);
  }
  return { project: slug, photos: n };
}

async function migrateArticles(env) {
  const done = [];
  for (const coll of ['photography', 'tech']) {
    const dir = path.join(CONTENT_DIR, coll);
    let files = [];
    try {
      files = (await readdir(dir)).filter((f) => /\.mdx?$/.test(f)).sort();
    } catch {
      continue; // 目录不存在则跳过
    }
    for (const file of files) {
      const slug = path.basename(file, path.extname(file));
      const full = path.join(dir, file);
      const raw = await readFile(full, 'utf8');
      const { data, content } = matter(raw);
      const body = file.endsWith('.mdx') ? mdxToMarkdown(content.trim()) : content.trim();
      const st = await stat(full);
      const pubDate =
        data.pubDate instanceof Date
          ? data.pubDate.toISOString().slice(0, 10)
          : typeof data.pubDate === 'string'
            ? data.pubDate.slice(0, 10)
            : st.mtime.toISOString().slice(0, 10);

      await env.DB.prepare('DELETE FROM articles WHERE slug = ?').bind(slug).run();
      await env.DB
        .prepare(
          `INSERT INTO articles (slug, collection, title, description, body_md, cover_url, cover_alt, pub_date, draft)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          slug,
          coll,
          typeof data.title === 'string' ? data.title : slug,
          typeof data.description === 'string' ? data.description : null,
          body,
          typeof data.cover === 'string' ? data.cover : null,
          typeof data.coverAlt === 'string' ? data.coverAlt : null,
          pubDate,
          data.draft === true ? 1 : 0,
        )
        .run();
      done.push(`${coll}/${slug}（${pubDate}${data.draft === true ? '，草稿' : ''}）`);
    }
  }
  return done;
}

console.log('迁移到本地 D1 + R2（.wrangler/state）…\n');
const proxy = await getPlatformProxy({ configPath: path.join(ROOT, 'wrangler.toml') });
const env = proxy.env;

try {
  console.log('[1/3] 初始化表结构');
  await runSchema(env.DB);

  console.log('[2/3] 迁移照片（sharp → webp → R2）');
  const entries = (await readdir(ASSETS_DIR, { withFileTypes: true })).filter((d) => d.isDirectory());
  let totalPhotos = 0;
  for (const d of entries) {
    const dir = path.join(ASSETS_DIR, d.name);
    try {
      await readFile(path.join(dir, 'meta.json'), 'utf8');
    } catch {
      continue; // 无 meta.json 的目录跳过
    }
    const r = await migrateProject(env, dir);
    totalPhotos += r.photos;
    console.log(`  项目 ${r.project}: ${r.photos} 张`);
  }

  console.log('[3/3] 迁移文章');
  const articles = await migrateArticles(env);
  for (const a of articles) console.log(`  ${a}`);

  console.log(`\n完成：${entries.length} 个项目 / ${totalPhotos} 张照片 / ${articles.length} 篇文章。`);
  console.log('下一步：npm run dev → http://localhost:4321（数据已就绪）');
} finally {
  await proxy.dispose();
}
