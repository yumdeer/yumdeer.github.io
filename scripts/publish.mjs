#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────────────────
//  一键发布脚本 — 给一个目录，自动分类、登记、构建、部署。
//
//  用法：
//    npm run publish -- <源目录> [选项]
//
//  目录内容自动识别：
//    • 图片 (jpg/jpeg/png/webp/avif) → src/assets/projects/<slug>/，自动登记
//      meta.json（已有则不覆盖）；文件名即照片标题（01-sunset.jpg → "Sunset"）
//    • Markdown (*.md)               → src/content/<type>/，自动补全 frontmatter
//      （已有 frontmatter 则保留，仅补缺失的必填字段）
//    • meta.json (可选)              → 本目录的发布配置：
//        { "project": "trip-2026", "title": "2026 旅途", "category": "作品",
//          "year": "2026", "description": "…", "type": "photography" }
//
//  常用选项（优先级：CLI 参数 > 源目录 meta.json > 默认值）：
//    --project <slug>     项目 slug（URL 路径名，建议英文；默认=目录名 slug 化）
//    --title <标题>        项目显示标题（默认=目录名）
//    --category <分类>     侧栏分组（默认=作品）
//    --year <年份>         显示在标题旁（默认=今年）
//    --desc <描述>         项目页顶部说明
//    --type <类型>         随笔集合：photography | tech（默认=photography）
//    --dry-run            只显示计划，不实际执行
//    --no-deploy          只提交源码到 main，不构建部署 gh-pages
//
//  示例：
//    npm run publish -- ~/Pictures/trip --project trip-2026 --title "2026 旅途"
//    npm run publish -- ~/notes/essay.md  --type tech
// ────────────────────────────────────────────────────────────────────────────
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IMG_EXT = /\.(jpe?g|png|webp|avif)$/i;
const SITE_URL = 'https://flowerdeer.cn';

// ── 参数解析 ────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const opts = { _: [], deploy: true, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--no-deploy') opts.deploy = false;
    else if (a === '--project') opts.project = argv[++i];
    else if (a === '--title') opts.title = argv[++i];
    else if (a === '--category') opts.category = argv[++i];
    else if (a === '--year') opts.year = argv[++i];
    else if (a === '--desc') opts.desc = argv[++i];
    else if (a === '--type') opts.type = argv[++i];
    else if (a.startsWith('--')) { console.error(`未知选项: ${a}`); process.exit(1); }
    else opts._.push(a);
  }
  return opts;
}

const args = parseArgs(process.argv.slice(2));
const srcDirInput = args._[0];
if (!srcDirInput) {
  console.error('用法: npm run publish -- <源目录> [选项]');
  process.exit(1);
}

const srcDir = path.resolve(srcDirInput);
if (!fs.existsSync(srcDir)) {
  console.error(`目录不存在: ${srcDir}`);
  process.exit(1);
}

// 源目录可以是文件（单篇随笔）
const isFile = fs.statSync(srcDir).isFile();
const srcBase = isFile ? path.dirname(srcDir) : srcDir;
const entries = isFile
  ? [{ name: path.basename(srcDir), isFile: true, mtime: fs.statSync(srcDir).mtime }]
  : fs.readdirSync(srcDir, { withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => ({ name: d.name, isFile: true, mtime: fs.statSync(path.join(srcDir, d.name)).mtime }));

const images = entries.filter((e) => IMG_EXT.test(e.name));
const markdowns = entries.filter((e) => /\.md$/i.test(e.name));

// 源目录 meta.json（发布配置，优先级低于 CLI 参数）
let dirMeta = {};
const dirMetaPath = path.join(srcBase, 'meta.json');
if (fs.existsSync(dirMetaPath)) {
  dirMeta = JSON.parse(fs.readFileSync(dirMetaPath, 'utf8'));
}

if (images.length === 0 && markdowns.length === 0) {
  console.error('目录里没有图片 (jpg/png/webp/avif) 也没有 Markdown (*.md)，无可发布内容。');
  process.exit(1);
}

// ── 项目 slug / 标题决定 ─────────────────────────────────────────────────────
const dirName = isFile ? path.basename(srcDir, '.md') : path.basename(srcDir);
function slugify(name) {
  const s = name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  return s || `p-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
}
const hasChinese = (s) => /[\u4e00-\u9fff]/.test(s);

const slug = args.project || dirMeta.project || slugify(dirName);
const projectTitle = args.title || dirMeta.title || dirName;
const category = args.category || dirMeta.category || '作品';
const year = args.year || dirMeta.year || String(new Date().getFullYear());
const description = args.desc || dirMeta.description || '';
const contentType = args.type || dirMeta.type || 'photography';

if (hasChinese(slug) && !args.project && !dirMeta.project) {
  console.warn(`⚠ 目录名含中文，slug 自动改为 "${slug}"（如需自定义请用 --project <英文slug>）`);
}

const projDir = path.join(ROOT, 'src/assets/projects', slug);
const projMetaPath = path.join(projDir, 'meta.json');
const isNewProject = images.length > 0 && !fs.existsSync(projMetaPath);

// ── frontmatter 工具（轻量手写，避免依赖）────────────────────────────────────
function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: text };
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    const [, k, raw] = kv;
    let v = raw.trim();
    if (/^".*"$/.test(v) || /^'.*'$/.test(v)) v = v.slice(1, -1);
    data[k] = v;
  }
  return { data, body: m[2] };
}

function buildFrontmatter(data) {
  const lines = Object.entries(data).map(([k, v]) => `${k}: ${v}`);
  return `---\n${lines.join('\n')}\n---\n`;
}

// ── 执行计划 ─────────────────────────────────────────────────────────────────
const plan = [];
if (images.length > 0) {
  if (isNewProject) {
    plan.push(`新建项目 "${projectTitle}" (slug=${slug}, 分类=${category}, 年份=${year})`);
  } else if (!fs.existsSync(projMetaPath)) {
    plan.push(`追加照片到项目 ${slug}（新建 meta.json）`);
  } else {
    plan.push(`追加照片到已有项目 ${slug}（meta.json 不变）`);
  }
  for (const img of images) plan.push(`  + ${img.name}`);
}
for (const md of markdowns) {
  if (hasChinese(md.name)) {
    console.warn(`⚠ 随笔文件名含中文，URL 将显示为编码字符（可正常访问）。建议英文命名如 my-trip.md`);
  }
  plan.push(`发布随笔 ${md.name} → src/content/${contentType}/`);
}

console.log('发布计划：');
console.log(plan.join('\n'));

if (args.dryRun) {
  console.log('\n[dry-run] 以上仅为计划，未执行任何修改。');
  process.exit(0);
}

// ── 执行：图片 ───────────────────────────────────────────────────────────────
if (images.length > 0) {
  fs.mkdirSync(projDir, { recursive: true });
  if (!fs.existsSync(projMetaPath)) {
    fs.writeFileSync(
      projMetaPath,
      JSON.stringify(
        { title: projectTitle, category, year, description: description || undefined },
        null,
        2,
      ) + '\n',
    );
    console.log(`✓ 写入 ${path.relative(ROOT, projMetaPath)}`);
  }
  for (const img of images) {
    const dest = path.join(projDir, img.name);
    if (fs.existsSync(dest)) {
      console.warn(`⚠ 跳过已存在: ${img.name}`);
      continue;
    }
    fs.copyFileSync(path.join(srcBase, img.name), dest);
    console.log(`✓ ${img.name} → src/assets/projects/${slug}/`);
  }
}

// ── 执行：随笔（自动补 frontmatter）─────────────────────────────────────────
for (const md of markdowns) {
  const src = path.join(srcBase, md.name);
  const raw = fs.readFileSync(src, 'utf8');
  const { data, body } = parseFrontmatter(raw);

  const title = data.title || md.name.replace(/\.md$/i, '').replace(/[-_]+/g, ' ');
  const pubDate = data.pubDate || md.mtime.toISOString().slice(0, 10);
  const description = data.description || title;
  const merged = {
    title: JSON.stringify(title),
    description: JSON.stringify(description),
    pubDate,
    ...(data.draft !== undefined ? { draft: data.draft } : {}),
    ...(data.tags ? { tags: data.tags } : {}),
  };

  const contentDir = path.join(ROOT, 'src/content', contentType);
  fs.mkdirSync(contentDir, { recursive: true });
  const dest = path.join(contentDir, md.name);
  fs.writeFileSync(dest, buildFrontmatter(merged) + body);
  console.log(`✓ ${md.name} → src/content/${contentType}/ (title=${title}, pubDate=${pubDate})`);
}

// ── 提交源码（只 add 本次发布涉及的路径，避免裹挟无关变更）─────────────────
function run(cmd, opts = {}) {
  execSync(cmd, { stdio: 'inherit', cwd: ROOT, ...opts });
}

const addPaths = [];
if (images.length) addPaths.push(`src/assets/projects/${slug}`);
for (const md of markdowns) addPaths.push(`src/content/${contentType}`);

const parts = [];
if (images.length) parts.push(isNewProject ? `新项目「${projectTitle}」${images.length} 张照片` : `项目 ${slug} 追加 ${images.length} 张照片`);
if (markdowns.length) parts.push(`${markdowns.length} 篇随笔`);
const commitMsg = `publish: ${parts.join(' + ')}`;

run(`git add -- ${addPaths.map((p) => JSON.stringify(p)).join(' ')}`);
try {
  run(`git commit -m ${JSON.stringify(commitMsg)}`);
} catch {
  console.warn('⚠ 没有可提交的变更（可能内容都已存在），跳过提交。');
  process.exit(0);
}
run('git push origin main');
console.log('✓ 源码已提交并推送 main');

if (!args.deploy) {
  console.log('\n[--no-deploy] 完成，未部署。稍后手动部署: npm run deploy');
  process.exit(0);
}

// ── 构建并部署 gh-pages ──────────────────────────────────────────────────────
run(`node scripts/deploy.mjs --msg ${JSON.stringify(`Deploy: ${commitMsg}`)}`);

console.log('\n🎉 发布完成！');
if (images.length) console.log(`  摄影项目: ${SITE_URL}/project/${slug}/`);
for (const md of markdowns) console.log(`  随笔: ${SITE_URL}/blog/${contentType}/${md.name.replace(/\.md$/i, '')}/`);
console.log('  （GitHub Pages CDN 生效约需 1-2 分钟）');
