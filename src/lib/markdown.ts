// ────────────────────────────────────────────────────────────────────────────
//  Markdown 渲染（文章存 D1，marked 渲染，不再走构建期 content 集合）。
//  支持 frontmatter（gray-matter）— 管理后台粘贴带 frontmatter 的旧文也能解析。
// ────────────────────────────────────────────────────────────────────────────
import { marked } from 'marked';
import matter from 'gray-matter';

export interface ParsedArticle {
  title?: string;
  description?: string;
  pubDate?: string;
  draft?: boolean;
  cover?: string;
  coverAlt?: string;
  body: string;
}

// 解析带 frontmatter 的 Markdown（管理后台导入旧文 / publish 脚本迁移用）
export function parseMarkdown(raw: string): ParsedArticle {
  const { data, content } = matter(raw);
  return {
    title: typeof data.title === 'string' ? data.title : undefined,
    description: typeof data.description === 'string' ? data.description : undefined,
    pubDate: data.pubDate instanceof Date ? data.pubDate.toISOString().slice(0, 10)
      : typeof data.pubDate === 'string' ? data.pubDate.slice(0, 10) : undefined,
    draft: data.draft === true,
    cover: typeof data.cover === 'string' ? data.cover : undefined,
    coverAlt: typeof data.coverAlt === 'string' ? data.coverAlt : undefined,
    body: content.trim(),
  };
}

// 渲染为 HTML。链接加 target=_blank + noopener（外链安全）。
export function renderMarkdown(md: string): string {
  const renderer = new marked.Renderer();
  const origLink = renderer.link.bind(renderer);
  renderer.link = (href: string | null, title: string | null, text: string) => {
    const external = /^https?:\/\//.test(href ?? '');
    const attrs = external ? ' target="_blank" rel="noopener noreferrer"' : '';
    const t = title ? ` title="${title}"` : '';
    return `<a href="${href ?? '#'}"${t}${attrs}>${text}</a>`;
  };
  marked.use({ renderer, gfm: true, breaks: false });
  return marked.parse(md, { async: false }) as string;
}

// 旧 MDX 文章里的组件语法降级为纯 Markdown（迁移用）：
//   <Photo src="x.jpg" caption="..." />      → ![...](...)
//   <Gallery photos={["a.jpg","b.jpg"]} />   → 逐张图片
export function mdxToMarkdown(body: string): string {
  return body
    .replace(/^import .*$/gm, '')
    .replace(
      /<Photo\s+src="([^"]+)"\s*(?:caption="([^"]*)")?\s*\/>/g,
      (_m, src: string, cap?: string) => `![${cap ?? ''}](${src})`,
    )
    .replace(
      /<Gallery\s+photos=\{\[(.*?)\]\}\s*\/>/g,
      (_m, list: string) =>
        (list.match(/"([^"]+)"/g) ?? [])
          .map((s) => s.replace(/^"|"$/g, ''))
          .map((src) => `![](${src})`)
          .join('\n\n'),
    )
    .trim();
}
