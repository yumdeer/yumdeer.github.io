// 手册（PDF）元数据：文件存 R2，信息存 D1。
// 表在首次访问时幂等创建（与 site_settings 同策略），线上无需手动跑迁移。
import { getDB, getR2 } from './db';

export type Handbook = {
  id: number;
  title: string;
  description: string;
  r2_key: string;
  file_name: string;
  size: number;
  sort_order: number;
  downloads: number;
  created_at: string;
};

type DB = ReturnType<typeof getDB>;

const CREATE_SQL = `CREATE TABLE IF NOT EXISTS handbooks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  r2_key      TEXT NOT NULL UNIQUE,
  file_name   TEXT NOT NULL,
  size        INTEGER NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  downloads   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
)`;

let ready: Promise<unknown> | null = null;

// 建表 + 索引（幂等）。失败时清空缓存，下次请求重试。
export function ensureHandbooks(db: DB): Promise<unknown> {
  if (!ready) {
    ready = db
      .prepare(CREATE_SQL)
      .run()
      .then(() => db.prepare('CREATE INDEX IF NOT EXISTS idx_handbooks_sort ON handbooks(sort_order)').run())
      .catch((err) => {
        ready = null;
        throw err;
      });
  }
  return ready;
}

export async function listHandbooks(db: DB): Promise<Handbook[]> {
  await ensureHandbooks(db);
  const { results } = await db
    .prepare('SELECT * FROM handbooks ORDER BY sort_order ASC, id DESC')
    .all<Handbook>();
  return results ?? [];
}

export async function getHandbook(db: DB, id: number): Promise<Handbook | null> {
  await ensureHandbooks(db);
  return (await db.prepare('SELECT * FROM handbooks WHERE id = ?').bind(id).first<Handbook>()) ?? null;
}

export async function insertHandbook(
  db: DB,
  data: { title: string; description: string; r2Key: string; fileName: string; size: number },
): Promise<Handbook> {
  await ensureHandbooks(db);
  const max =
    (await db.prepare('SELECT MAX(sort_order) AS m FROM handbooks').first<{ m: number | null }>())?.m ?? -1;
  const row = await db
    .prepare(
      `INSERT INTO handbooks (title, description, r2_key, file_name, size, sort_order)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING *`,
    )
    .bind(data.title, data.description, data.r2Key, data.fileName, data.size, max + 1)
    .first<Handbook>();
  if (!row) throw new Error('insert failed');
  return row;
}

export async function deleteHandbook(db: DB, id: number): Promise<boolean> {
  const row = await getHandbook(db, id);
  if (!row) return false;
  const r2 = getR2();
  if (r2) await r2.delete(row.r2_key);
  await db.prepare('DELETE FROM handbooks WHERE id = ?').bind(id).run();
  return true;
}
