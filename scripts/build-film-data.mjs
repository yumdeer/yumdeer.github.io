// 把 DigitalFilm / SpektraLab (HarmonyOS) 的胶片资产压缩成本工具用的数据包。
// 源数据：/home/zhang/harmony-spektralab/assets（离线源，不随站点分发）。
// 生成：public/tools/film-color/data/{manifest.json,films/*.bin,papers/*.bin}
//
// 压缩策略：
// - 色度 tcLut 192² → 96²（2×2 均值），uint16 量化，保留暗部精度；
// - 密度曲线 / DIR 曲线 / tcB 保留 float32；
// - 相纸 33³ LUT 量化为 uint8（最终输出本来就是 8bit）；
// - 相纸坐标轴保留 float32。
//
// 用法：node scripts/build-film-data.mjs

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const SRC = process.env.SPEKTRA_ASSETS || "/home/zhang/harmony-spektralab/assets";
const OUT = path.resolve(import.meta.dirname, "../public/tools/film-color/data");
const TC_FULL = 192;
const TC_PACKED = 96;
const PRINT_SIDE = 33;

const f32 = (buf) => new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);

function packFilm(tc, curves, coupler, tcB) {
  const n = TC_PACKED;
  const step = TC_FULL / n;
  const down = new Float32Array(n * n * 3);
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let dy = 0; dy < step; dy++) {
          for (let dx = 0; dx < step; dx++) {
            sum += tc[(((x * step + dx) * TC_FULL) + (y * step + dy)) * 3 + c];
          }
        }
        down[(x * n + y) * 3 + c] = sum / (step * step);
      }
    }
  }

  let max = 0;
  for (let i = 0; i < down.length; i++) if (down[i] > max) max = down[i];
  max = max > 0 ? max : 1;

  const header = 4 + 2 + 2 + 4;
  const tcBytes = down.length * 2;
  const curveBytes = curves.length * 4;
  const couplerBytes = coupler.length * 4;
  const tcBBytes = tcB.length * 4;
  const buf = new ArrayBuffer(header + tcBytes + curveBytes + couplerBytes + tcBBytes);
  const view = new DataView(buf);
  let o = 0;
  for (const ch of "FLM1") view.setUint8(o++, ch.charCodeAt(0));
  view.setUint16(o, TC_PACKED, true); o += 2;
  view.setUint16(o, curves.length / 3, true); o += 2;
  view.setFloat32(o, max, true); o += 4;
  const u16 = new Uint16Array(buf, o, down.length);
  for (let i = 0; i < down.length; i++) {
    u16[i] = Math.max(0, Math.min(65535, Math.round((down[i] / max) * 65535)));
  }
  o += tcBytes;
  new Float32Array(buf, o, curves.length).set(curves); o += curveBytes;
  new Float32Array(buf, o, coupler.length).set(coupler); o += couplerBytes;
  new Float32Array(buf, o, tcB.length).set(tcB);
  return buf;
}

function packPaper(lut, axes) {
  const buf = new ArrayBuffer(8 + axes.length * 4 + lut.length);
  const view = new DataView(buf);
  let o = 0;
  for (const ch of "PPR1") view.setUint8(o++, ch.charCodeAt(0));
  view.setUint16(o, PRINT_SIDE, true); o += 2;
  view.setUint16(o, 0, true); o += 2;
  new Float32Array(buf, o, axes.length).set(axes); o += axes.length * 4;
  const u8 = new Uint8Array(buf, o, lut.length);
  for (let i = 0; i < lut.length; i++) {
    u8[i] = Math.max(0, Math.min(255, Math.round(Math.min(1, Math.max(0, lut[i])) * 255)));
  }
  return buf;
}

const flat = (rows) => {
  const out = [];
  for (const row of rows) for (const v of row) out.push(v);
  return new Float32Array(out);
};

const manifestSrc = JSON.parse(await readFile(path.join(SRC, "manifest.json"), "utf8"));
await mkdir(path.join(OUT, "films"), { recursive: true });
await mkdir(path.join(OUT, "papers"), { recursive: true });

let filmBytes = 0;
for (const f of manifestSrc.films) {
  const json = JSON.parse(await readFile(path.join(SRC, "films", `${f.id}.json`), "utf8"));
  const tc = f32(await readFile(path.join(SRC, "films", `${f.id}.bin`)));
  const buf = packFilm(tc, flat(json.curves), flat(json.couplerCurves), flat(json.tcB));
  await writeFile(path.join(OUT, "films", `${f.id}.bin`), Buffer.from(buf));
  filmBytes += buf.byteLength;
}

let paperBytes = 0;
for (const p of manifestSrc.papers) {
  const json = JSON.parse(await readFile(path.join(SRC, "papers", `${p.id}.json`), "utf8"));
  const lut = f32(await readFile(path.join(SRC, "papers", `${p.id}.bin`)));
  const buf = packPaper(lut, flat(json.axes));
  await writeFile(path.join(OUT, "papers", `${p.id}.bin`), Buffer.from(buf));
  paperBytes += buf.byteLength;
}

const manifest = {
  source: "SpektraLab / spektrafilm film profiles (Andrea Volpato, CC BY-SA 4.0)",
  films: manifestSrc.films.map((f) => ({
    id: f.id,
    name: f.name,
    type: f.type || "negative",
    targetPrint: f.targetPrint || "",
  })),
  papers: manifestSrc.papers.map((p) => ({
    id: p.id,
    name: p.name,
    pairedFilm: p.pairedFilm || "",
  })),
};
const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
await writeFile(path.join(OUT, "manifest.json"), manifestText);

console.log(`films: ${manifestSrc.films.length} (${(filmBytes / 1024).toFixed(0)} KB)`);
console.log(`papers: ${manifestSrc.papers.length} (${(paperBytes / 1024).toFixed(0)} KB)`);
console.log(`total: ${((filmBytes + paperBytes + Buffer.byteLength(manifestText)) / 1048576).toFixed(2)} MB`);
