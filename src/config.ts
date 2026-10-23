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
  email: 'mailto:875205504@qq.com',
};

// 「INFO · 艺术家简介」默认文案 — 同步自旧 hexo 站。
// 前后台编辑器共用：未保存过自定义简介时，编辑框预填这份源码，
// 保证「编辑框所见 = 前台所显」，修改即全量替换（不会追加/丢失）。
export const DEFAULT_ABOUT_MD = `我是 ${site.nameZh}（Jeff.Chal），It's Habitat with Love ♥

有人说，林深时见鹿，海蓝时见鲸，梦醒时见你。
可实际，林深时雾起，海蓝时潮涌，梦醒时夜续。
未见鹿，未见鲸，未见你。
最后形同陌路的两人，到现在你是否还想起。
虽隔千里，任愿你有好运触手可及。

[GitHub](${social.github}) · [小红书](${social.xiaohongshu}) · [网易云音乐](${social.music}) · [875205504@qq.com](${social.email})`;
