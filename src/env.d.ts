// cloudflare:workers 模块由 @astrojs/cloudflare 适配器提供（v14 起访问
// Workers 绑定的官方入口；dev 下代理到 platformProxy 的模拟绑定）。
// 绑定的具体形状在 src/lib/db.ts 里集中 cast，这里只做存在性声明。
declare module 'cloudflare:workers' {
  export const env: Record<string, any>;
}
