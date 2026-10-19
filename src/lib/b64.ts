// base64 → ArrayBuffer（上传 API 共用）。
// ⚠️ 不用 JS for 循环逐字节转换：一张几 MB 的媒体就是数百万次循环，
// 会超 Cloudflare Workers CPU 时间限制 → Worker 被强制终止 → 客户端
// "上传中"永远卡死。fetch data:URL 由 runtime 原生解码，几乎不计 CPU。
export async function b64ToBuf(b64: string): Promise<ArrayBuffer> {
  const raw = b64.includes(',') ? b64.split(',')[1] : b64;
  const r = await fetch(`data:application/octet-stream;base64,${raw}`);
  return r.arrayBuffer();
}
