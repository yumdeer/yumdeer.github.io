// ────────────────────────────────────────────────────────────────────────────
//  文章分类显示名 — 前台（博客列表 / 文章页）与后台（文章管理）共用一份映射，
//  改这里即全站同步。内置英文 slug 是历史路由值（photography/tech），
//  管理后台新建的自定义分类直接以中文值入库，无映射、原样显示。
//  分类可为空（未分类）：URL 段用 'none' 占位，显示层直接省略分类标签。
// ────────────────────────────────────────────────────────────────────────────
export const collLabel: Record<string, string> = {
  photography: '摄影随笔',
  tech: '技术',
};

// 空分类（未分类）显示 ''——模板里条件渲染，不显示空标签
export const collLabelOf = (c: string): string => (c ? collLabel[c] ?? c : '');

// 文章 URL 的分类段：空分类用 'none'（/blog/none/<slug>/）
export const collSlug = (c: string): string => c || 'none';
