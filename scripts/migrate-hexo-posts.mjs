// ────────────────────────────────────────────────────────────────────────────
//  hexo 老站随笔迁移：hexo 分支（构建产物 HTML）→ 新站 Markdown 文章
//  用法：node scripts/migrate-hexo-posts.mjs            # 提取到 tmp/hexo-md/
//        node scripts/migrate-hexo-posts.mjs --sql      # 额外生成导入 SQL
//  产物：tmp/hexo-md/<slug>.md + tmp/hexo-md/import.sql
//  注意：导入生产库前先人工抽查 Markdown 质量。
// ────────────────────────────────────────────────────────────────────────────
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT_DIR = path.join(ROOT, 'tmp', 'hexo-md');
mkdirSync(OUT_DIR, { recursive: true });

// 1. 列出 hexo 分支 2019/2021 下的文章 HTML
const list = (dir) =>
  execFileSync('git', ['-c', 'core.quotePath=false', 'ls-tree', '-r', `hexo:${dir}`, '--name-only'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter((f) => f.endsWith('index.html'));
const files = [...list('2019').map((f) => `2019/${f}`), ...list('2021').map((f) => `2021/${f}`)];
console.log(`共 ${files.length} 篇文章`);

// 2. HTML → Markdown（覆盖老站用到的元素；未识别的行内元素原样保留 HTML）
const decodeEnt = (s) =>
  s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
   .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

function htmlToMd(html) {
  let s = html;
  // 去掉 hexo 摘要分割与无关注释/空行
  s = s.replace(/<a id="more"><\/a>/g, '');
  s = s.replace(/<!--.*?-->/gs, '');
  // 标题
  s = s.replace(/<h([1-6])[^>]*>(.*?)<\/h\1>/gs, (_, lv, t) => `\n${'#'.repeat(+lv)} ${inline(t)}\n`);
  // 引用块
  s = s.replace(/<blockquote[^>]*>(.*?)<\/blockquote>/gs, (_, t) =>
    blockToLines(t).map((l) => `> ${l}`).join('\n') + '\n');
  // 列表（ul/ol → - / 1.，仅一层嵌套已足够老站内容）
  s = s.replace(/<li[^>]*>(.*?)<\/li>/gs, (_, t) => `- ${inline(t)}\n`);
  s = s.replace(/<\/?[uo]l[^>]*>/g, '\n');
  // 图片（保外链）
  s = s.replace(/<img[^>]*src="([^"]+)"[^>]*>/g, (_, src) => `\n![](${src})\n`);
  // 链接（图片外的）
  s = s.replace(/<a[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gs, (_, href, t) => `[${inline(t)}](${href})`);
  // 段落
  s = s.replace(/<p[^>]*>(.*?)<\/p>/gs, (_, t) => `\n${inline(t)}\n`);
  // center/b → 保留语义（老站多用于排版空行）
  s = s.replace(/<center[^>]*>(.*?)<\/center>/gs, (_, t) => `\n${inline(t)}\n`);
  // b 内容可能含 <br>/跨段（老站排版），先压平再加粗（md 的 ** 不能跨行段落）；空 b 丢弃
  s = s.replace(/<b[^r]r?[^>]*>(.*?)<\/b>/gs, (_, t) => {
    const flat = inline(t.replace(/<br\s*\/?>/g, ' ')).replace(/\n+/g, ' ').trim();
    return flat ? `**${flat}**` : '';
  });
  s = s.replace(/<br\s*\/?>/g, '\n');
  // 音乐 iframe 等富媒体原样保留（marked 直通 HTML）
  s = s.replace(/<iframe.*?<\/iframe>/gs, (m) => `\n${m}\n`);
  s = s.replace(/<\/?b>/g, '');                       // 嵌套 <b> 残留
  return s.split('\n').map((l) => l.replace(/[ \t]+$/,'')).join('\n')
    .replace(/^\*\*\s*\*\*$/gm, '')           // 空 <b> 残留（老站排版用的 <center><b><br></b></center>）
    .replace(/\n{3,}/g, '\n\n').trim();
}

const inline = (t) => decodeEnt(t.replace(/<strong[^>]*>(.*?)<\/strong>/gs, '**$1**')
  .replace(/<em[^>]*>(.*?)<\/em>/gs, '*$1*')
  .replace(/<code[^>]*>(.*?)<\/code>/gs, '`$1`')).trim();

const blockToLines = (t) => htmlToMd(t).split('\n').filter(Boolean);

// 3. 逐篇提取
const posts = [];
for (const f of files) {
  const html = execFileSync('git', ['-c', 'core.quotePath=false', 'show', `hexo:${f}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  const title = (html.match(/<meta property="og:title" content="([^"]*)">/) || [])[1]?.trim()
    ?? (html.match(/<h1 class="post-title"[^>]*>(.*?)<\/h1>/s) || [])[1]?.replace(/<[^>]+>/g, '').trim();
  const bodyM = html.match(/<div class="post-body" itemprop="articleBody">([\s\S]*?)<\/div>\s*<footer/);
  const dateM = f.match(/^(\d{4})\/(\d{2})\/(\d{2})\//);
  if (!title || !bodyM || !dateM) { console.error(`跳过（缺字段）: ${f}`); continue; }
  const body = htmlToMd(bodyM[1])
    // 老站本地图（hexo 分支 uploads/）→ 新站 R2 媒体流地址
    .replace(/\/uploads\//g, '/api/media/img/legacy/');
  const slug = `${title.replace(/\s+/g, '')}-${dateM[1]}`; // 标题去空格 + 年份防撞
  const pubDate = `${dateM[1]}-${dateM[2]}-${dateM[3]}`;
  const md = `---\ntitle: ${title}\npubDate: ${pubDate}\ncollection: photography\n---\n\n${body}\n`;
  writeFileSync(path.join(OUT_DIR, `${slug}.md`), md);
  posts.push({ slug, title, pubDate, body });
  console.log(`✓ ${pubDate} ${title}（${body.length} 字）`);
}

// 4. 生成生产 D1 导入 SQL（幂等：ON CONFLICT 覆盖）
if (process.argv.includes('--sql')) {
  const esc = (s) => s.replace(/'/g, "''");
  const sql = posts.map((p) =>
    `INSERT INTO articles (slug, collection, title, description, body_md, pub_date, draft, created_at, updated_at)
VALUES ('${esc(p.slug)}', 'photography', '${esc(p.title)}', NULL, '${esc(p.body)}', '${p.pubDate}', 0, datetime('now'), datetime('now'))
ON CONFLICT(slug) DO UPDATE SET body_md=excluded.body_md, title=excluded.title, pub_date=excluded.pub_date, updated_at=datetime('now');`).join('\n');
  writeFileSync(path.join(OUT_DIR, 'import.sql'), sql);
  console.log(`\nSQL 已生成: tmp/hexo-md/import.sql（${posts.length} 篇）`);
}
