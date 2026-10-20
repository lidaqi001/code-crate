#!/usr/bin/env node
/**
 * 码匣 CodeCrate 静态自检。把「说好的约束」变成可执行的检查，避免重蹈旧项目覆辙：
 *   1. manifest 合法且引用的文件真实存在
 *   2. 注册表与 src/tools 目录双向一致（无死链、无漏登记）
 *   3. 每个工具的 index.html / ui.js / logic.js 齐全
 *   4. HTML 里的本地 href/src 全部可解析
 *   5. 源码中不出现 innerHTML / outerHTML / document.write / eval / new Function 等注入入口
 *   6. 所有 .js 通过语法检查（含 ESM）
 *   7. 注册表使用的图标都已定义
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { basename, dirname, join, resolve, relative } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const notes = [];

const fail = (message) => problems.push(message);
const note = (message) => notes.push(message);

/* ── 遍历工具 ─────────────────────────────────────────────── */

function walk(dir, filter, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, filter, acc);
    else if (filter(full)) acc.push(full);
  }
  return acc;
}

const rel = (p) => relative(ROOT, p);

/* 这些目录不参与源码检查：本地保留的旧版扩展、构建产物、工具索引 */
const IGNORED_DIRS = ['node_modules', 'edge-extension', 'dist', '.git', '.codegraph'];
const ignored = (file) => {
  const path = rel(file);
  return IGNORED_DIRS.some((dir) => path === dir || path.startsWith(`${dir}/`));
};

/* ── 1. manifest ──────────────────────────────────────────── */

const manifestPath = join(ROOT, 'manifest.json');
if (!existsSync(manifestPath)) {
  fail('缺少 manifest.json');
} else {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    fail(`manifest.json 不是合法 JSON：${error.message}`);
  }

  if (manifest) {
    if (manifest.manifest_version !== 3) fail('manifest_version 必须是 3');
    for (const field of ['name', 'version', 'description']) {
      if (!manifest[field]) fail(`manifest 缺少字段 ${field}`);
    }
    if (!manifest.action || !manifest.action.default_popup) fail('manifest 缺少 action.default_popup');

    const referenced = [
      manifest.action?.default_popup,
      manifest.background?.service_worker,
      ...Object.values(manifest.icons || {}),
      ...Object.values(manifest.action?.default_icon || {})
    ].filter(Boolean);

    for (const file of referenced) {
      if (!existsSync(join(ROOT, file))) fail(`manifest 引用了不存在的文件：${file}`);
    }

    const packagePath = join(ROOT, 'package.json');
    if (existsSync(packagePath)) {
      try {
        const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
        if (pkg.version && pkg.version !== manifest.version) {
          fail(`版本号不一致：manifest.json ${manifest.version} ≠ package.json ${pkg.version}`);
        }
      } catch (error) {
        fail(`package.json 不是合法 JSON：${error.message}`);
      }
    }

    const permissions = manifest.permissions || [];
    if (permissions.length) {
      note(`已声明权限：${permissions.join(', ')}（目标为零权限，请确认必要性）`);
    } else {
      note('权限：无（零权限）');
    }

    if (manifest.content_security_policy?.extension_pages?.includes('unsafe-eval')) {
      fail('CSP 里出现 unsafe-eval');
    }
    if (manifest.web_accessible_resources?.length) {
      note('存在 web_accessible_resources，确认是否确有必要向网页暴露');
    }
  }
}

/* ── 2 & 3. 注册表与目录一致性 ────────────────────────────── */

const registry = await import(pathToFileURL(join(ROOT, 'src/core/registry.js')).href);
const icons = await import(pathToFileURL(join(ROOT, 'src/core/icons.js')).href);

for (const problem of registry.validateRegistry()) fail(`注册表：${problem}`);

const toolsDir = join(ROOT, 'src/tools');
const toolDirs = existsSync(toolsDir)
  ? readdirSync(toolsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
  : [];

const registeredIds = registry.TOOLS.map((tool) => tool.id);

for (const tool of registry.TOOLS) {
  const dir = join(toolsDir, tool.id);
  if (!existsSync(dir)) {
    fail(`注册表登记了 ${tool.id}，但 src/tools/${tool.id} 不存在`);
    continue;
  }
  for (const file of ['index.html', 'ui.js', 'logic.js']) {
    if (!existsSync(join(dir, file))) fail(`${tool.id} 缺少 ${file}`);
  }
  if (!existsSync(join(ROOT, tool.path))) fail(`${tool.id} 的 path 指向不存在的文件：${tool.path}`);
  if (!icons.ICON_NAMES.includes(tool.icon)) fail(`${tool.id} 使用了未定义的图标：${tool.icon}`);
}

for (const dir of toolDirs) {
  if (!registeredIds.includes(dir)) fail(`src/tools/${dir} 未登记到注册表（会成为死链）`);
}

/* ── 4. HTML 本地引用 ─────────────────────────────────────── */

const htmlFiles = walk(ROOT, (p) => p.endsWith('.html')).filter((p) => !ignored(p));

for (const file of htmlFiles) {
  const html = readFileSync(file, 'utf8');
  const refs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]);
  for (const ref of refs) {
    if (/^(https?:|data:|mailto:|#)/.test(ref)) continue;
    const target = resolve(dirname(file), ref.split('?')[0]);
    if (!existsSync(target)) fail(`${rel(file)} 引用了不存在的资源：${ref}`);
  }
}

/* ── 5. 危险 API ──────────────────────────────────────────── */

const jsFiles = walk(ROOT, (p) => p.endsWith('.js')).filter(
  (p) => !ignored(p) && !rel(p).startsWith('scripts')
);

const FORBIDDEN = [
  { pattern: /\.innerHTML\s*=/, label: 'innerHTML 赋值' },
  { pattern: /\.outerHTML\s*=/, label: 'outerHTML 赋值' },
  { pattern: /document\.write\s*\(/, label: 'document.write' },
  { pattern: /[^.\w]eval\s*\(/, label: 'eval' },
  { pattern: /new\s+Function\s*\(/, label: 'new Function' },
  { pattern: /\.insertAdjacentHTML\s*\(/, label: 'insertAdjacentHTML' },
  { pattern: /\bsrcdoc\s*=/, label: 'srcdoc 赋值' },
  { pattern: /\bsetAttribute\s*\(\s*['"`]on[a-z]/i, label: 'on* 事件属性' },
  { pattern: /\b(?:href|src)\s*=\s*['"`]\s*javascript:/i, label: 'javascript: URL' }
];

for (const file of jsFiles) {
  const source = readFileSync(file, 'utf8');
  for (const { pattern, label } of FORBIDDEN) {
    if (pattern.test(source)) fail(`${rel(file)} 使用了禁止的 ${label}`);
  }
}

/* ── 5b. ESM 导入路径可解析 ───────────────────────────────── */
/* 语法检查不会发现写错的 import 路径，而这类错误只在运行时才暴露。 */

for (const file of jsFiles) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*)['"](\.[^'"]+)['"]/g)) {
    const target = resolve(dirname(file), match[1]);
    if (!existsSync(target)) fail(`${rel(file)} 导入了不存在的模块：${match[1]}`);
  }
}

/* ── 6. 语法检查 ──────────────────────────────────────────── */

for (const file of jsFiles) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (error) {
    fail(`${rel(file)} 语法检查失败：${String(error.stderr || error.message).split('\n')[0]}`);
  }
}

/* ── 7. 图标被引用但未定义（UI 里的 icon('x') 调用） ───────── */

for (const file of jsFiles) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(/\bicon\(\s*'([a-zA-Z0-9_-]+)'/g)) {
    if (!icons.ICON_NAMES.includes(match[1])) {
      fail(`${rel(file)} 调用了未定义的图标：${match[1]}`);
    }
  }
}

/* ── 8. ui.js 里 els.X 必须先赋值再使用 ───────────────────── */
/* 这类遗漏只在运行时才暴露（els.foo 为 undefined 后取属性直接抛错），
   而且 id 引用检查发现不了，所以单独作为一条硬性约束。 */

const uiFiles = jsFiles.filter((file) => rel(file).endsWith('/ui.js') || rel(file).endsWith('popup.js'));

for (const file of uiFiles) {
  const source = readFileSync(file, 'utf8');
  if (!source.includes('els.')) continue;

  // 同时覆盖 els.foo 与 el 别名（popup.js 使用 el.foo）
  const used = new Set([...source.matchAll(/\bels\.([a-zA-Z0-9_]+)/g)].map((match) => match[1]));
  const assigned = new Set([...source.matchAll(/\bels\.([a-zA-Z0-9_]+)\s*=[^=]/g)].map((match) => match[1]));

  for (const key of used) {
    if (!assigned.has(key)) fail(`${rel(file)} 使用了 els.${key} 但从未赋值（运行时会抛 TypeError）`);
  }
}

/* ── 9. 每个工具页必须引入主题预置脚本 ────────────────────── */

for (const file of htmlFiles) {
  const html = readFileSync(file, 'utf8');
  if (!rel(file).startsWith('src/tools/')) continue;
  if (!html.includes('theme-init.js')) fail(`${rel(file)} 缺少 theme-init.js，会出现首屏主题闪烁`);
  if (!html.includes('data-tool=')) fail(`${rel(file)} 的 body 缺少 data-tool 属性`);
}

/* ── 9b. $() 查找的元素必须真实存在 ───────────────────────── */
/* 页面元素要么写在 HTML 里，要么由 h() 动态创建（带 id 属性）。
   凭空查找一个不存在的 id 一定是写错了名字。 */

for (const file of uiFiles) {
  const source = readFileSync(file, 'utf8');
  const directory = dirname(file);
  const htmlPath = [
    join(directory, `${basename(file, '.js')}.html`),
    join(directory, 'index.html')
  ].find((candidate) => existsSync(candidate));
  const html = htmlPath ? readFileSync(htmlPath, 'utf8') : '';

  const lookups = new Set([
    ...[...source.matchAll(/\$\(\s*['"]#([A-Za-z0-9_-]+)['"]/g)].map((match) => match[1]),
    ...[...source.matchAll(/\$\(\s*`#([A-Za-z0-9_-]+)`/g)].map((match) => match[1])
  ]);

  for (const id of lookups) {
    if (html.includes(`id="${id}"`)) continue;
    // 动态创建：允许 id: 'x' / id: "x" / id: `x`
    const created =
      source.includes(`id: '${id}'`) ||
      source.includes(`id: "${id}"`) ||
      source.includes(`id: \`${id}\``);
    if (!created) fail(`${rel(file)} 查找了不存在的 #${id}（HTML 与动态创建里都没有）`);
  }
}

/* ── 10. 无障碍与设计系统基线 ─────────────────────────────── */

for (const file of htmlFiles) {
  const html = readFileSync(file, 'utf8');
  if (!html.includes('lang=')) fail(`${rel(file)} 的 <html> 缺少 lang 属性`);

  if (!rel(file).startsWith('src/tools/')) continue;
  // 设计令牌与基础组件决定焦点可见性、减少动效等无障碍行为
  if (!html.includes('tokens.css')) fail(`${rel(file)} 缺少 tokens.css`);
  if (!html.includes('base.css')) fail(`${rel(file)} 缺少 base.css`);
  if (!html.includes('name="color-scheme"')) fail(`${rel(file)} 缺少 color-scheme meta`);

  // 标签页必须成对出现 role="tablist" / role="tab"
  const tabs = (html.match(/role="tab"/g) || []).length;
  const tablists = (html.match(/role="tablist"/g) || []).length;
  if (tabs && !tablists) fail(`${rel(file)} 有 role="tab" 但没有 role="tablist"`);
}

// 自动关联 label 的能力不能被移除
const domSource = readFileSync(join(ROOT, 'src/core/dom.js'), 'utf8');
if (!domSource.includes('associateFieldLabel')) {
  fail('src/core/dom.js 缺少 .field 的 label 自动关联逻辑（无障碍回归）');
}

/* ── 汇总 ─────────────────────────────────────────────────── */

const toolCount = registry.TOOLS.length;
const stat = statSync(join(ROOT, 'manifest.json'));

console.log(`码匣 CodeCrate 自检 — 工具 ${toolCount} 个，HTML ${htmlFiles.length} 个，JS ${jsFiles.length} 个`);
for (const entry of notes) console.log(`  · ${entry}`);
void stat;

if (problems.length) {
  console.error(`\n发现 ${problems.length} 个问题：`);
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  process.exit(1);
}

console.log('\n✓ 全部检查通过');
