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
  name: 'Yumdeer',
  // Optional second-script name (e.g. a Chinese 中文名) shown under the brand and
  // in a couple of prose pages. Leave it '' to hide it everywhere. See the README
  // for how to self-host a font subset so it renders identically on every device.
  nameZh: '花鹿',
  title: 'Yumdeer · 花鹿摄影集',
  description:
    '花鹿的摄影集与博客 — 数码与胶片画廊、按月照片日历，以及摄影随笔。',
};

// Left-hand navigation. "Digital" is the home page and shows by default.
export const nav: NavItem[] = [
  { label: 'Digital', href: '/' },
  { label: 'Analog', href: '/analog' },
  { label: 'Calendar', href: '/calendar' },
  { label: 'Tech Blog', href: '/blog/tech' },
  { label: 'Photo Blog', href: '/blog/photography' },
  { label: 'About', href: '/about' },
  { label: 'Contact', href: '/contact' },
  { label: 'License', href: '/license' },
];

// Social / external links shown in the sidebar and on the contact page. Replace
// the placeholders with your own. If you drop or add one, also update the
// matching <Icon> in Sidebar.astro and the list in Contact.astro.
export const social = {
  instagram: 'https://www.instagram.com/yumdeer',
  linkedin: 'https://www.linkedin.com/in/yumdeer',
  github: 'https://github.com/yumdeer',
};
