// ────────────────────────────────────────────────────────────────────────────
//  Site configuration — edit these values to make the template your own.
//  Almost everything visitor-facing (titles, the brand, SEO, JSON-LD, llms.txt)
//  is derived from this file, so start here.
// ────────────────────────────────────────────────────────────────────────────

export interface NavItem {
  label: string;
  href: string;
}

export const site = {
  name: 'flowerdeer',
  // Optional second-script name (e.g. a Chinese 中文名) shown under the brand and
  // in a couple of prose pages. Leave it '' to hide it everywhere. See the README
  // for how to self-host a font subset so it renders identically on every device.
  nameZh: '张鹿溪',
  title: '张鹿溪摄影集',
  description:
    '张鹿溪的摄影集与博客 — 数码与胶片画廊、按月照片日历，以及摄影随笔。',
};

// 侧栏导航由 Layout.astro 根据项目数据自动生成（作品 / 随笔 / 关于）。

// 社交/外部链接 — 同步自旧 hexo 站（个人介绍页"撩一撩"区块），
// 在艺术家简介页（INFO）默认文案中引用。
export const social = {
  github: 'https://github.com/yumdeer',
  xiaohongshu: 'https://xhslink.cn/o/99HWCWNGopf',
  // 网易云个人主页：旧版 music.163.com/#/user/home 网页端已 404，
  // 现用移动版入口（SSR 渲染，桌面浏览器可正常打开）
  music: 'https://y.music.163.com/m/user?id=369837843',
};
