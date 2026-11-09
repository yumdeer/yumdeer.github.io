// 图片解码统一入口。
// 浏览器原生 createImageBitmap 不支持 TIFF（Chrome / Firefox / Safari 都会抛
// "The source image could not be decoded"），所以上传 TIFF 时先兜底用 UTIF 解码。
// 解码结果统一返回 ImageBitmap，后续 canvas → webp 的压缩管线完全复用。
// @ts-expect-error utif 没有类型声明
import UTIF from 'utif';

// TIFF 文件头魔数：II*\0（小端）或 MM\0*（大端）
const TIFF_LE = [0x49, 0x49, 0x2a, 0x00];
const TIFF_BE = [0x4d, 0x4d, 0x00, 0x2a];

function isTiff(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 4) return false;
  const h = new Uint8Array(buf, 0, 4);
  return [TIFF_LE, TIFF_BE].some((magic) => magic.every((b, i) => h[i] === b));
}

async function decodeTiff(buf: ArrayBuffer): Promise<ImageBitmap> {
  const ifds = UTIF.decode(buf);
  if (!ifds.length) throw new Error('TIFF 中没有可用的图像页');
  // 多页 TIFF 只取第一页
  const ifd = ifds[0];
  UTIF.decodeImage(buf, ifd);
  const rgba = UTIF.toRGBA8(ifd);
  const canvas = document.createElement('canvas');
  canvas.width = ifd.width;
  canvas.height = ifd.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建画布');
  const data = new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  ctx.putImageData(new ImageData(data, ifd.width, ifd.height), 0, 0);
  return createImageBitmap(canvas);
}

export async function decodeImage(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob);
  } catch (err) {
    const buf = await blob.arrayBuffer();
    if (!isTiff(buf)) throw err;
    return decodeTiff(buf);
  }
}
