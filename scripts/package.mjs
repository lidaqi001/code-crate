#!/usr/bin/env node
/**
 * 打包上架用 zip：只收 manifest.json、src、icons，排除测试、脚本与文档。
 * 打包前先跑自检，版本号不一致或工具注册表/目录不一致时直接失败。
 *
 * 用法：npm run package
 * 产物：dist/codecrate-<version>.zip（manifest.json 位于压缩包根目录）
 */

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

const check = spawnSync(process.execPath, [join(ROOT, 'scripts', 'check.mjs')], { stdio: 'inherit' });
if (check.status !== 0) fail('自检未通过，已停止打包');

const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));

const zipProbe = spawnSync('zip', ['-v'], { stdio: 'ignore' });
if (zipProbe.error || zipProbe.status !== 0) {
  fail('未找到 zip 命令（macOS / Linux 自带；Windows 请用 WSL 或先安装 zip）');
}

const zipPath = join(DIST, `codecrate-${manifest.version}.zip`);
const stage = join(DIST, `.stage-${process.pid}`);

rmSync(stage, { recursive: true, force: true });
rmSync(zipPath, { force: true });
mkdirSync(stage, { recursive: true });

const items = ['manifest.json', 'src', 'icons'];
for (const item of items) {
  const source = join(ROOT, item);
  if (!existsSync(source)) fail(`缺少打包内容：${item}`);
  cpSync(source, join(stage, item), { recursive: true });
}

const result = spawnSync('zip', ['-r', '-q', zipPath, ...items], { cwd: stage, stdio: 'inherit' });
rmSync(stage, { recursive: true, force: true });
if (result.status !== 0) fail('zip 打包失败');

const size = (statSync(zipPath).size / 1024).toFixed(0);
console.log(`✓ ${zipPath}（${size} KB，版本 ${manifest.version}）`);
