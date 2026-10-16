-- 张鹿溪摄影集 D1 数据库结构
-- 内容全部由管理后台写入；公开页面只读。
-- 初始化：npx wrangler d1 execute flowerdeer --local --file=src/db/schema.sql
--         （生产把 --local 换成 --remote）

-- 管理员（首个注册者即管理员；/admin/setup 仅在空表时可用）
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,            -- PBKDF2-SHA256，格式: iterations$salt$hex
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 会话（随机 token 存 D1，HttpOnly Cookie 携带）
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

-- 摄影项目（侧栏分组 = category）
CREATE TABLE IF NOT EXISTS projects (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT NOT NULL UNIQUE,       -- URL 路径名
  title       TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT '作品',
  year        TEXT,
  description TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 照片（属于某项目；图片文件在 R2：img/{project_slug}/{photo_slug}/thumb.webp 与 full.webp）
CREATE TABLE IF NOT EXISTS photos (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  slug       TEXT NOT NULL,               -- R2 内的文件名（无扩展名）
  title      TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  w          INTEGER NOT NULL DEFAULT 0,  -- full 变体像素宽
  h          INTEGER NOT NULL DEFAULT 0,
  blur       TEXT,                        -- 24px 模糊占位图 data URL
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(project_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_photos_project ON photos(project_id, sort_order);

-- 随笔文章（collection: photography | tech）
CREATE TABLE IF NOT EXISTS articles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT NOT NULL UNIQUE,
  collection  TEXT NOT NULL DEFAULT 'photography',
  title       TEXT NOT NULL,
  description TEXT,
  body_md     TEXT NOT NULL DEFAULT '',
  cover_url   TEXT,
  cover_alt   TEXT,
  pub_date    TEXT NOT NULL,
  draft       INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_articles_list ON articles(collection, pub_date DESC);

-- 音乐曲目（音频文件在 R2：audio/{slug}.mp3；与内置合成环境音并存）
CREATE TABLE IF NOT EXISTS tracks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  slug         TEXT NOT NULL UNIQUE,
  title        TEXT NOT NULL,
  artist       TEXT DEFAULT '',
  duration_sec INTEGER NOT NULL DEFAULT 0,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
