// ────────────────────────────────────────────────────────────────────────────
//  D1/R2 访问层 — 通过 `cloudflare:workers` 的 env 导出取绑定
//  （@astrojs/cloudflare v14 移除了 locals.runtime.env；本地 dev 由适配器的
//   platformProxy 提供同一份 .wrangler/state 模拟，生产为真实绑定）。
//  SSR 模式下所有页面/接口统一从这里拿连接。
// ────────────────────────────────────────────────────────────────────────────
import { env } from 'cloudflare:workers';

export interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
}

export function getDB() {
  const db = (env as { DB?: unknown }).DB;
  if (!db) throw new Error('D1 数据库未绑定（检查 wrangler.toml / platformProxy）');
  return db as {
    prepare(sql: string): {
      bind(...args: unknown[]): {
        all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
        first<T = Record<string, unknown>>(): Promise<T | null>;
        run(): Promise<{ success: boolean }>;
      };
    };
    batch(stmts: unknown[]): Promise<unknown>;
  };
}

export function getR2() {
  const r2 = (env as { R2?: unknown }).R2;
  if (!r2) throw new Error('R2 存储未绑定（检查 wrangler.toml / platformProxy）');
  return r2 as {
    put(key: string, value: ArrayBuffer | ReadableStream | string, opts?: {
      httpMetadata?: Record<string, string>;
    }): Promise<unknown>;
    get(key: string): Promise<{
      body: ReadableStream;
      httpMetadata?: Record<string, string>;
    } | null>;
    delete(key: string): Promise<unknown>;
    list(opts?: { prefix?: string }): Promise<{ objects: { key: string }[] }>;
  };
}

// ── 查询助手 ────────────────────────────────────────────────────────────────

export interface ProjectRow {
  id: number;
  slug: string;
  title: string;
  category: string;
  year: string | null;
  description: string | null;
  sort_order: number;
}

export interface PhotoRow {
  id: number;
  project_id: number;
  slug: string;
  title: string;
  sort_order: number;
  w: number;
  h: number;
  blur: string | null;
}

export interface ArticleRow {
  id: number;
  slug: string;
  collection: string;
  title: string;
  description: string | null;
  body_md: string;
  cover_url: string | null;
  cover_alt: string | null;
  pub_date: string;
  draft: number;
}

export interface TrackRow {
  id: number;
  slug: string;
  title: string;
  artist: string | null;
  duration_sec: number;
  sort_order: number;
}

export async function listProjects(db: ReturnType<typeof getDB>): Promise<ProjectRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM projects ORDER BY sort_order, id')
    .all<ProjectRow>();
  return results;
}

export async function getProject(db: ReturnType<typeof getDB>, slug: string) {
  return db.prepare('SELECT * FROM projects WHERE slug = ?').bind(slug).first<ProjectRow>();
}

export async function listPhotos(db: ReturnType<typeof getDB>, projectId: number): Promise<PhotoRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM photos WHERE project_id = ? ORDER BY sort_order, id')
    .bind(projectId)
    .all<PhotoRow>();
  return results;
}

export async function listArticles(
  db: ReturnType<typeof getDB>,
  opts: { includeDrafts?: boolean } = {},
): Promise<ArticleRow[]> {
  const where = opts.includeDrafts ? '' : 'WHERE draft = 0';
  const { results } = await db
    .prepare(`SELECT * FROM articles ${where} ORDER BY pub_date DESC, id DESC`)
    .all<ArticleRow>();
  return results;
}

export async function getArticle(db: ReturnType<typeof getDB>, slug: string) {
  return db.prepare('SELECT * FROM articles WHERE slug = ?').bind(slug).first<ArticleRow>();
}

export async function listTracks(db: ReturnType<typeof getDB>): Promise<TrackRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM tracks ORDER BY sort_order, id')
    .all<TrackRow>();
  return results;
}

// 首页精选：全部照片（跨项目）
export async function listAllPhotos(db: ReturnType<typeof getDB>) {
  const { results } = await db
    .prepare(
      `SELECT p.*, pr.slug AS project_slug FROM photos p
       JOIN projects pr ON pr.id = p.project_id
       ORDER BY pr.sort_order, p.sort_order, p.id`,
    )
    .all<PhotoRow & { project_slug: string }>();
  return results;
}

// ── 站点设置（key-value，后台可编辑的页面文案等）─────────────────────────
// 表不存在时自动建（幂等）：生产库无需手动跑迁移，首次访问/保存即创建。
// 当前 key：about_md = 「INFO 艺术家简介」页正文（Markdown）。
export async function getSetting(db: ReturnType<typeof getDB>, key: string): Promise<string | null> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS site_settings (
         key   TEXT PRIMARY KEY,
         value TEXT NOT NULL,
         updated_at TEXT NOT NULL DEFAULT (datetime('now'))
       )`,
    )
    .run();
  const row = await db.prepare('SELECT value FROM site_settings WHERE key = ?').bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function setSetting(db: ReturnType<typeof getDB>, key: string, value: string): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS site_settings (
         key   TEXT PRIMARY KEY,
         value TEXT NOT NULL,
         updated_at TEXT NOT NULL DEFAULT (datetime('now'))
       )`,
    )
    .run();
  await db
    .prepare(
      `INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(key, value)
    .run();
}

// R2 键约定
export const r2Key = {
  photoFull: (projectSlug: string, photoSlug: string) => `img/${projectSlug}/${photoSlug}/full.webp`,
  photoThumb: (projectSlug: string, photoSlug: string) => `img/${projectSlug}/${photoSlug}/thumb.webp`,
  audio: (slug: string) => `audio/${slug}.mp3`,
  // 文章内嵌媒体（不进 photos/tracks 表，只在正文中引用）
  articleImage: (name: string) => `img/article/${name}.webp`,
  articleAudio: (name: string) => `audio/article/${name}.mp3`,
};
