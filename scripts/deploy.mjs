#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────────────────
//  部署脚本 — 构建 + 同步 dist 到 gh-pages 分支 + 推送。
//  用法：npm run deploy [-- --msg "Deploy: xxx"]
// ────────────────────────────────────────────────────────────────────────────
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(cmd) {
  execSync(cmd, { stdio: 'inherit', cwd: ROOT });
}

const msgArg = process.argv.indexOf('--msg');
const msg = msgArg > -1 ? process.argv[msgArg + 1] : `Deploy site rebuild ${new Date().toISOString().slice(0, 10)}`;

console.log('构建站点…');
run('npm run build');

const WT = '/tmp/deploy-gh-pages';
run(`git worktree add ${WT} gh-pages 2>/dev/null || git -C ${WT} checkout gh-pages`);
// 同步构建产物（保留 .git）
run(`rsync -a --delete --exclude .git dist/ ${WT}/`);
run(`git -C ${WT} add -A`);
run(`git -C ${WT} commit -m ${JSON.stringify(msg)}`);
run(`git -C ${WT} push origin gh-pages`);
run(`git worktree remove ${WT}`);
console.log('✓ gh-pages 已部署（GitHub Pages CDN 生效约需 1-2 分钟）');
