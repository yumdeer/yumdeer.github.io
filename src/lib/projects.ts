// ────────────────────────────────────────────────────────────────────────────
//  项目照片发现与渲染 — 元数据跟内容走：
//    • 照片：src/assets/projects/<slug>/*.{jpg,png,webp,avif}，按文件名排序
//    • 元数据：src/assets/projects/<slug>/meta.json（title/category/year/description）
//      无 meta.json 的文件夹使用默认值（title=slug, category=作品）。
//  新增项目 = 建文件夹 + 放照片（+ 可选 meta.json），无需改任何代码。
//  经 Astro 图片管线生成响应式 WebP（构建时压缩，国内加载友好）。
// ────────────────────────────────────────────────────────────────────────────
import type { ImageMetadata } from 'astro';
import { getImage } from 'astro:assets';

// 幻灯片长边上限 2400px：投影/高分屏足够清晰，文件体积可控。
const MAX_WEB = 2400;
const WIDTHS = [640, 1080, 1600, 2048, 2400];
// 内容区宽度：桌面端扣除 260px 侧栏，移动端全屏。
export const SLIDE_SIZES = '(min-width: 769px) calc(100vw - 260px), 100vw';
// 首页精选网格：列宽（2/3/4 列响应式）。
export const GRID_SIZES =
  '(min-width: 1024px) 25vw, (min-width: 641px) 33vw, 50vw';

export interface ProjectMeta {
  slug: string; // src/assets/projects/ 下的文件夹名
  title: string; // 侧栏与项目页标题
  category: string; // 侧栏分组（如「作品」）
  year?: string; // 可选，显示在标题旁
  description?: string; // 项目页顶部的一段说明文字
}

export interface Slide {
  src: string;
  srcset: string;
  w: number;
  h: number;
  alt: string;
}

export interface Project extends ProjectMeta {
  photos: Slide[];
}

const files = import.meta.glob<{ default: ImageMetadata }>(
  '../assets/projects/*/*.{jpg,jpeg,png,webp,avif,JPG,JPEG,PNG,WEBP,AVIF}',
  { eager: true },
);

const metas = import.meta.glob<{ default: Record<string, unknown> }>(
  '../assets/projects/*/meta.json',
  { eager: true },
) as Record<string, { default: Record<string, unknown> }>;

// 文件名 → 可读标题："01-snowy-harbor.jpg" → "Snowy harbor"
export function captionFromFilename(name: string, index = 0): string {
  const stem = (name.split('/').pop() ?? name).replace(/\.[^.]+$/, '');
  const words = stem.replace(/^[\s\d_-]+/, '').replace(/[-_]+/g, ' ').trim();
  if (!words) return `Photograph ${index + 1}`;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// 从图片路径提取所有项目 slug（与 meta.json 无关，有照片即是项目）
export function getProjectSlugs(): string[] {
  return [
    ...new Set(
      Object.keys(files)
        .map((p) => p.split('/projects/')[1]?.split('/')[0])
        .filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

// 同步读取项目元数据（Layout 侧栏用）
export function getProjectMetas(): ProjectMeta[] {
  return getProjectSlugs().map((slug) => {
    const meta = metas[`../assets/projects/${slug}/meta.json`]?.default ?? {};
    return {
      slug,
      title: typeof meta.title === 'string' ? meta.title : slug,
      category: typeof meta.category === 'string' ? meta.category : '作品',
      year: typeof meta.year === 'string' ? meta.year : undefined,
      description:
        typeof meta.description === 'string' ? meta.description : undefined,
    };
  });
}

async function renderSlide(meta: ImageMetadata, alt: string): Promise<Slide> {
  const cap = Math.min(MAX_WEB, meta.width || MAX_WEB);
  const widths = WIDTHS.filter((w) => w <= cap);
  if (!widths.includes(cap)) widths.push(cap);
  widths.sort((a, b) => a - b);

  const renditions = await Promise.all(
    widths.map((w) => getImage({ src: meta, width: w, format: 'webp', quality: 80 })),
  );
  const srcset = renditions.map((r) => `${r.src} ${r.attributes.width}w`).join(', ');
  const largest = renditions[renditions.length - 1];

  return {
    src: largest.src,
    srcset,
    w: meta.width,
    h: meta.height,
    alt,
  };
}

function photosFor(slug: string) {
  return Object.entries(files)
    .filter(([path]) => path.includes(`/projects/${slug}/`))
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
}

export async function getProjects(): Promise<Project[]> {
  const metasSync = getProjectMetas();
  return Promise.all(
    metasSync.map(async (meta) => {
      const entries = photosFor(meta.slug);
      const photos = await Promise.all(
        entries.map(([path, mod], i) =>
          renderSlide(mod.default, captionFromFilename(path, i)),
        ),
      );
      return { ...meta, photos };
    }),
  );
}

export async function getProject(slug: string): Promise<Project | undefined> {
  return (await getProjects()).find((p) => p.slug === slug);
}
