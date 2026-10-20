import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseBlocks,
  parseInline,
  sanitizeUrl,
  isUrlBlocked,
  inlineToText,
  extractHeadings,
  toHtml,
  toHtmlDocument,
  escapeHtml
} from '../src/tools/markdown/logic.js';

/** 从标签字符串里提取属性名，用来证明没有属性注入。 */
function attributeNames(tagHtml) {
  const inner = tagHtml.replace(/^<[a-z0-9]+/i, '').replace(/\/?>$/, '');
  return [...inner.matchAll(/([a-zA-Z-]+)="/g)].map((match) => match[1]);
}

const firstBlock = (md) => parseBlocks(md)[0];

/* ── 块级解析 ─────────────────────────────────────────────── */

test('解析标题 1-6 级', () => {
  const blocks = parseBlocks('# 一级\n\n### 三级');
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].type, 'heading');
  assert.equal(blocks[0].level, 1);
  assert.equal(blocks[0].text, '一级');
  assert.equal(blocks[1].level, 3);
});

test('标题结尾的井号被忽略', () => {
  assert.equal(firstBlock('## 标题 ##').text, '标题');
});

test('解析段落并在空行处断开', () => {
  const blocks = parseBlocks('第一段\n仍然是第一段\n\n第二段');
  assert.equal(blocks.length, 2);
  assert.equal(inlineToText(blocks[0].inline), '第一段\n仍然是第一段');
  assert.equal(inlineToText(blocks[1].inline), '第二段');
});

test('解析围栏代码块并保留语言标记与原文', () => {
  const blocks = parseBlocks('```js\nconst a = 1;\n\nconst b = 2;\n```');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'code');
  assert.equal(blocks[0].lang, 'js');
  assert.equal(blocks[0].value, 'const a = 1;\n\nconst b = 2;');
});

test('未闭合的代码块也能解析到文件末尾', () => {
  const blocks = parseBlocks('```\ncode here');
  assert.equal(blocks[0].type, 'code');
  assert.equal(blocks[0].value, 'code here');
});

test('解析分隔线', () => {
  for (const input of ['---', '***', '___', ' - - - ']) {
    assert.equal(firstBlock(input).type, 'hr', input);
  }
});

test('解析无序列表与有序列表', () => {
  const ul = firstBlock('- a\n- b\n- c');
  assert.equal(ul.type, 'list');
  assert.equal(ul.ordered, false);
  assert.equal(ul.items.length, 3);

  const ol = firstBlock('1. a\n2. b');
  assert.equal(ol.ordered, true);
  assert.equal(ol.items.length, 2);
});

test('解析任务列表', () => {
  const list = firstBlock('- [x] 已完成\n- [ ] 未完成');
  assert.equal(list.items[0].task, true);
  assert.equal(list.items[0].checked, true);
  assert.equal(list.items[1].checked, false);
});

test('解析引用并可嵌套块级结构', () => {
  const quote = firstBlock('> 引用内容\n> 第二行');
  assert.equal(quote.type, 'blockquote');
  assert.equal(quote.blocks[0].type, 'paragraph');
  assert.equal(inlineToText(quote.blocks[0].inline), '引用内容\n第二行');
});

test('解析 GFM 表格与对齐方式', () => {
  const blocks = parseBlocks('| 名称 | 数量 | 备注 |\n| :--- | ---: | :---: |\n| a | 1 | x |\n| b | 2 | y |');
  assert.equal(blocks.length, 1);
  const table = blocks[0];
  assert.equal(table.type, 'table');
  assert.deepEqual(table.aligns, ['left', 'right', 'center']);
  assert.equal(table.headers.length, 3);
  assert.equal(inlineToText(table.headers[0]), '名称');
  assert.equal(table.rows.length, 2);
  assert.equal(inlineToText(table.rows[1][2]), 'y');
});

/* ── 行内解析 ─────────────────────────────────────────────── */

test('解析粗体、斜体与删除线', () => {
  const nodes = parseInline('**粗** 和 *斜* 和 ~~删~~');
  const types = nodes.map((node) => node.type);
  assert.ok(types.includes('strong'));
  assert.ok(types.includes('em'));
  assert.ok(types.includes('del'));
});

test('行内代码内部不再解析其他标记', () => {
  const nodes = parseInline('`**not bold**`');
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].type, 'code');
  assert.equal(nodes[0].value, '**not bold**');
});

test('反斜杠转义阻止标记生效', () => {
  const nodes = parseInline('\\*not italic\\*');
  assert.equal(inlineToText(nodes), '*not italic*');
  assert.equal(nodes.every((node) => node.type === 'text'), true);
});

test('解析链接与图片', () => {
  const nodes = parseInline('[文档](https://example.com) ![图](https://example.com/a.png)');
  const link = nodes.find((node) => node.type === 'link');
  const image = nodes.find((node) => node.type === 'image');
  assert.equal(link.href, 'https://example.com');
  assert.equal(inlineToText(link.children), '文档');
  assert.equal(image.src, 'https://example.com/a.png');
  assert.equal(image.alt, '图');
});

test('链接带标题时只取地址', () => {
  const [link] = parseInline('[文档](https://example.com "标题")');
  assert.equal(link.href, 'https://example.com');
});

test('换行解析为 br 节点', () => {
  const nodes = parseInline('第一行\n第二行');
  assert.ok(nodes.some((node) => node.type === 'br'));
});

/* ── 安全：URL 白名单 ─────────────────────────────────────── */

test('sanitizeUrl 放行安全协议与相对地址', () => {
  assert.equal(sanitizeUrl('https://example.com'), 'https://example.com');
  assert.equal(sanitizeUrl('http://example.com'), 'http://example.com');
  assert.equal(sanitizeUrl('mailto:a@b.com'), 'mailto:a@b.com');
  assert.equal(sanitizeUrl('tel:+8613800138000'), 'tel:+8613800138000');
  assert.equal(sanitizeUrl('#section'), '#section');
  assert.equal(sanitizeUrl('/path/page'), '/path/page');
  assert.equal(sanitizeUrl('./relative'), './relative');
});

test('sanitizeUrl 拦截脚本类协议', () => {
  for (const url of [
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    '  javascript:alert(1)',
    'java\tscript:alert(1)',
    'java\nscript:alert(1)',
    'jav\u0000ascript:alert(1)',
    'vbscript:msgbox(1)',
    'data:text/html;base64,PHNjcmlwdD4=',
    'file:///etc/passwd'
  ]) {
    assert.equal(sanitizeUrl(url), null, `未拦截：${url}`);
    assert.equal(isUrlBlocked(url), true, `未标记：${url}`);
  }
});

test('markdown 链接中的 javascript: 被拦截并保留可读文本', () => {
  const [link] = parseInline('[点我](javascript:alert(1))');
  assert.equal(link.type, 'link');
  assert.equal(link.href, null);
  assert.equal(link.blocked, true);
  assert.equal(inlineToText(link.children), '点我');
});

test('markdown 图片中的危险协议被拦截', () => {
  const [image] = parseInline('![x](javascript:alert(1))');
  assert.equal(image.src, null);
  assert.equal(image.blocked, true);
});

test('toHtml 对危险链接不输出 href', () => {
  const html = toHtml(parseBlocks('[点我](javascript:alert(1))'));
  assert.equal(html.includes('href='), false);
  assert.equal(html.includes('javascript'), false);
  assert.match(html, /已拦截不安全链接/);
});

/* ── 安全：属性注入回归（旧版本的 XSS 载荷） ──────────────── */

test('旧版 XSS 载荷不再产生属性注入', () => {
  // 这正是旧实现被攻破的输入：alt 里带引号 + onerror
  const payload = '![" onerror="alert(1)](x)';
  const blocks = parseBlocks(payload);
  const image = blocks[0].inline[0];

  assert.equal(image.type, 'image');
  assert.equal(image.src, 'x');
  // alt 是数据，不是 HTML —— 引号不可能逃逸出属性
  assert.equal(image.alt, '" onerror="alert(1)');

  const html = toHtml(blocks);
  // 解析出的属性必须只有这三个，绝不能多出 onerror
  const tag = html.match(/<img[^>]*>/)[0];
  assert.deepEqual(attributeNames(tag), ['src', 'alt', 'loading']);
  assert.equal(attributeNames(tag).includes('onerror'), false);
});

test('原文中的 HTML 标签只会作为纯文本出现', () => {
  const blocks = parseBlocks('<script>alert(1)</script>');
  const html = toHtml(blocks);
  assert.equal(html.includes('<script>'), false);
  assert.match(html, /&lt;script&gt;/);
});

test('alt 与链接文本中的引号和尖括号都被转义', () => {
  const html = toHtml(parseBlocks('![a"b<c>](https://e.com)'));
  assert.equal(html.includes('<c>'), false);
  const tag = html.match(/<img[^>]*>/)[0];
  assert.deepEqual(attributeNames(tag), ['src', 'alt', 'loading']);
});

test('代码块内容不会被当作 HTML 执行', () => {
  const html = toHtml(parseBlocks('```html\n<img src=x onerror=alert(1)>\n```'));
  assert.equal(html.includes('<img'), false);
  assert.match(html, /&lt;img/);
});

test('escapeHtml 覆盖全部敏感字符', () => {
  assert.equal(escapeHtml('<>&"\''), '&lt;&gt;&amp;&quot;&#39;');
});

/* ── 导出 ─────────────────────────────────────────────────── */

test('toHtml 生成主要块级标签', () => {
  const html = toHtml(parseBlocks('# 标题\n\n段落\n\n- a\n- b\n\n> 引用\n\n---'));
  for (const tag of ['<h1>', '<p>', '<ul>', '<li>', '<blockquote>', '<hr>']) {
    assert.ok(html.includes(tag), `缺少 ${tag}`);
  }
});

test('toHtml 输出带语言类的代码块', () => {
  const html = toHtml(parseBlocks('```js\nx\n```'));
  assert.match(html, /<code class="language-js">/);
});

test('toHtml 处理表格对齐与缺失单元格', () => {
  const html = toHtml(parseBlocks('| a | b |\n| --- | --- |\n| 1 |'));
  assert.match(html, /text-align:left/);
  assert.equal((html.match(/<td/g) || []).length, 2);
});

test('toHtmlDocument 产出完整可打开的文档', () => {
  const doc = toHtmlDocument(parseBlocks('# 标题'), '我的标题');
  assert.match(doc, /^<!DOCTYPE html>/);
  assert.match(doc, /<title>我的标题<\/title>/);
  assert.match(doc, /<h1>标题<\/h1>/);
});

test('空输入不产生任何块', () => {
  assert.deepEqual(parseBlocks(''), []);
  assert.deepEqual(parseBlocks('   \n\n  '), []);
  assert.equal(toHtml([]), '');
});

/* ── 目录 ─────────────────────────────────────────────────── */

test('提取标题生成目录，含引用内的标题', () => {
  const headings = extractHeadings(parseBlocks('# 一\n\n## 二\n\n> ### 三\n\n段落'));
  assert.deepEqual(headings.map((h) => h.text), ['一', '二', '三']);
  assert.deepEqual(headings.map((h) => h.level), [1, 2, 3]);
});

test('inlineToText 还原纯文本', () => {
  assert.equal(inlineToText(parseInline('**粗** 与 `码` 与 [链](https://a.com)')), '粗 与 码 与 链');
});
