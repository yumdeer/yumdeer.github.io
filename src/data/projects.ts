// ────────────────────────────────────────────────────────────────────────────
//  摄影项目元数据 — 每个条目对应 src/assets/projects/<slug>/ 下的一个文件夹。
//  把照片拖进文件夹，在这里登记标题即可上线；description 留空则不显示。
// ────────────────────────────────────────────────────────────────────────────

export interface ProjectMeta {
  slug: string; // src/assets/projects/ 下的文件夹名
  title: string; // 侧栏与项目页标题
  category: string; // 侧栏分组（如「作品」）
  year?: string; // 可选，显示在标题旁
  description?: string; // 项目页顶部的一段说明文字
}

export const projects: ProjectMeta[] = [
  {
    slug: 'digital',
    title: '数码',
    category: '作品',
    year: '2024',
    description: '数码摄影作品。占位示例照片，替换 src/assets/projects/digital/ 下的文件即可。',
  },
  {
    slug: 'analog',
    title: '胶片',
    category: '作品',
    year: '2024',
    description: '胶片摄影作品。占位示例照片，替换 src/assets/projects/analog/ 下的文件即可。',
  },
];
