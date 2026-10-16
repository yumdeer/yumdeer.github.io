// ────────────────────────────────────────────────────────────────────────────
//  Markdown 渲染（文章存 D1，marked 渲染，不再走构建期 content 集合）。
//  支持 frontmatter — 管理后台粘贴带 frontmatter 的旧文也能解析。
//  frontmatter 切分手写（原 gray-matter 依赖链含 sprintf-js 漏洞，已移除），
//  YAML 解析用零依赖的 yaml 包。
// ────────────────────────────────────────────────────────────────────────────
import { marked } from 'marked';
import { parse as parseYaml } from 'yaml';

export interface ParsedArticle {
  title?: string;
  description?: string;
  pubDate?: string;
  draft?: boolean;
  cover?: string;
  coverAlt?: string;
  body: string;
}

// 切分 `---` 包裹的 YAML frontmatter（格式兼容 gray-matter）。
// 无 frontmatter 时返回空对象和原文；YAML 语法错误时抛出（与 gray-matter 一致）。
export function splitFrontmatter(raw: string): { data: Record<string, unknown>; content: string } {
  // 体部可选：兼容空 frontmatter（---\n---\n）
  const m = raw.match(/^---\r?\n(?:([\s\S]*?)\r?\n)?---(?:\r?\n|$)/);
  if (!m) return { data: {}, content: raw };
  const data = (parseYaml(m[1] ?? '') ?? {}) as Record<string, unknown>;
  return { data, content: raw.slice(m[0].length) };
}

// 解析带 frontmatter 的 Markdown（管理后台导入旧文 / publish 脚本迁移用）
export function parseMarkdown(raw: string): ParsedArticle {
  const { data, content } = splitFrontmatter(raw);
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
// 注意 marked v13+ 的 renderer.link 签名是 token 对象（此前是位置参数，
// 升级 marked 后旧写法会把 token 对象拼进 href，渲染出 [object Object]）。
export function renderMarkdown(md: string): string {
  const renderer = new marked.Renderer();
  renderer.link = function (token) {
    const href = token.href ?? '#';
    const external = /^(https?:)?\/\//.test(href);
    const attrs = external ? ' target="_blank" rel="noopener noreferrer"' : '';
    const title = token.title ? ` title="${token.title}"` : '';
    // 图片链接（[![alt](img)](url)）等内联子节点需递归渲染
    const text = token.tokens?.length
      ? this.parser.parseInline(token.tokens)
      : token.text;
    return `<a href="${href}"${title}${attrs}>${text}</a>`;
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
