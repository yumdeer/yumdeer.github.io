// 响应式尺寸描述符（从原 lib/projects.ts 抽出，供 SSR 页面复用）。
// 幻灯片长边上限 2400px：投影/高分屏足够清晰，文件体积可控。
export const SLIDE_SIZES = '(min-width: 769px) calc(100vw - 260px), 100vw';
// 首页精选网格：列宽（2/3/4 列响应式）。
export const GRID_SIZES =
  '(min-width: 1024px) 25vw, (min-width: 641px) 33vw, 50vw';
