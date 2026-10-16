// ────────────────────────────────────────────────────────────────────────────
//  认证 — PBKDF2-SHA256（WebCrypto，Workers 原生支持）+ D1 会话表。
//  Cookie: fd_session（HttpOnly / SameSite=Lax / 7 天）。
// ────────────────────────────────────────────────────────────────────────────
import type { AstroLocals } from 'astro';
import { env } from 'cloudflare:workers';

const PBKDF2_ITERATIONS = 100_000;
const SESSION_DAYS = 7;

function toHex(buf: ArrayBuffer) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function b64urlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS },
    key,
    256,
  );
  return `${PBKDF2_ITERATIONS}$${toHex(salt.buffer)}$${toHex(bits)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [iterStr, saltHex, hashHex] = stored.split('$');
  const iterations = Number(iterStr);
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    256,
  );
  return toHex(bits) === hashHex;
}

// ── 会话 ────────────────────────────────────────────────────────────────────

export function sessionCookie(token: string) {
  return `fd_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
}

export function clearSessionCookie() {
  return 'fd_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
}

export function parseSessionCookie(cookieHeader: string | undefined | null): string | null {
  if (!cookieHeader) return null;
  const m = cookieHeader.match(/(?:^|;\s*)fd_session=([^;]+)/);
  return m ? m[1] : null;
}

export async function createSession(
  db: ReturnType<() => unknown> extends never ? never : any,
  userId: number,
): Promise<string> {
  const token = toHex(crypto.getRandomValues(new Uint8Array(32)).buffer);
  const expires = new Date(Date.now() + SESSION_DAYS * 86400 * 1000).toISOString();
  await db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(token, userId, expires).run();
  return token;
}

export async function getSessionUser(db: any, token: string) {
  const row = await db
    .prepare(
      `SELECT u.id, u.email FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > datetime('now')`,
    )
    .bind(token)
    .first<{ id: number; email: string }>();
  return row ?? null;
}

export async function destroySession(db: any, token: string) {
  await db.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
}

export async function countUsers(db: any): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>();
  return row?.n ?? 0;
}

// Astro 请求侧便捷入口：从请求 Cookie 解析当前登录用户
export async function currentUser(locals: AstroLocals, request: Request) {
  const token = parseSessionCookie(request.headers.get('cookie'));
  if (!token) return null;
  try {
    const db = env.DB;
    return await getSessionUser(db, token);
  } catch {
    return null;
  }
}

export { b64urlDecode };
