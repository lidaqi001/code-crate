/* Markdown 界面层。
   关键：预览完全通过 DOM API 构建（节点树 -> 元素），从不使用 innerHTML，
   因此解析结果里的引号、尖括号都不可能变成标签或属性。 */

import { h, mount, clear, $, debounce } from '../../core/dom.js';
import { mountTool } from '../../core/app.js';
import { icon } from '../../core/icons.js';
import { copyButton, createFold, downloadText } from '../../core/widgets.js';
import { read, write } from '../../core/storage.js';
import * as toast from '../../core/toast.js';
import * as logic from './logic.js';

const STORAGE_ID = 'markdown';

const SAMPLE = `# 码匣 Markdown 预览

支持 **粗体**、*斜体*、~~删除线~~、\`行内代码\` 与 [链接](https://example.com)。

## 列表

- 无序项
- [x] 已完成的任务
- [ ] 待办的任务

1. 有序项一
2. 有序项二

## 表格

| 工具 | 状态 | 说明 |
| :--- | :---: | ---: |
| JSON | ✅ | 已完成 |
| 正则 | ✅ | 已完成 |
| 二维码 | ⏳ | 规划中 |

## 代码

\`\`\`js
const list = [1, 2, 3];
console.log(list.map((n) => n * 2));
\`\`\`

> 引用块里的内容
> 可以有多行

---

安全说明：原文中的 HTML 标签会被当作纯文本显示，\`javascript:\` 链接会被拦截。
`;

const els = {};
const state = {
  mode: read(`${STORAGE_ID}:mode`, 'preview')
};

/* ── 节点树 -> DOM ────────────────────────────────────────── */

function renderInline(nodes) {
  return (nodes || []).map((node) => {
    switch (node.type) {
      case 'text':
        return document.createTextNode(node.value);
      case 'code':
        return h('code', {}, node.value);
      case 'strong':
        return h('strong', {}, renderInline(node.children));
      case 'em':
        return h('em', {}, renderInline(node.children));
      case 'del':
        return h('del', {}, renderInline(node.children));
      case 'br':
        return h('br');
      case 'link':
        if (!node.href) {
          return h('span', {}, renderInline(node.children), h('span', { class: 'blocked' }, '（已拦截不安全链接）'));
        }
        return h('a', { href: node.href, target: '_blank', rel: 'noopener noreferrer' }, renderInline(node.children));
      case 'image':
        if (!node.src) {
          return h('span', { class: 'blocked' }, `（已拦截不安全图片：${node.alt || ''}）`);
        }
        return h('img', { src: node.src, alt: node.alt || '', loading: 'lazy' });
      default:
        return null;
    }
  });
}

function renderBlocks(blocks, headingCounter) {
  return blocks.map((block) => {
    switch (block.type) {
      case 'heading': {
        const id = `md-h-${headingCounter.next++}`;
        return h(`h${block.level}`, { id }, renderInline(block.inline));
      }
      case 'paragraph':
        return h('p', {}, renderInline(block.inline));
      case 'code':
        return h('pre', {}, h('code', { class: block.lang ? `language-${block.lang}` : undefined }, block.value));
      case 'hr':
        return h('hr');
      case 'blockquote':
        return h('blockquote', {}, renderBlocks(block.blocks, headingCounter));
      case 'list': {
        const items = block.items.map((item) => h('li', { class: item.task ? 'task' : undefined },
          item.task ? h('input', { type: 'checkbox', disabled: true, checked: item.checked }) : null,
          renderInline(item.inline)
        ));
        return h(block.ordered ? 'ol' : 'ul', {}, items);
      }
      case 'table': {
        const head = h('tr', {}, block.headers.map((cell, index) =>
          h('th', { style: { textAlign: block.aligns[index] || 'left' } }, renderInline(cell))
        ));
        const body = block.rows.map((row) => h('tr', {},
          block.headers.map((_unused, index) =>
            h('td', { style: { textAlign: block.aligns[index] || 'left' } }, renderInline(row[index] || []))
          )
        ));
        return h('table', {}, h('thead', {}, head), h('tbody', {}, body));
      }
      default:
        return null;
    }
  });
}

/* ── 各视图 ───────────────────────────────────────────────── */

function renderPreview(container, blocks) {
  const counter = { next: 0 };
  container.appendChild(h('div', { class: 'md-preview' }, renderBlocks(blocks, counter)));
}

function renderHtml(container, blocks) {
  container.appendChild(h('pre', { class: 'html-source', text: logic.toHtml(blocks) }));
}

function renderToc(container, blocks) {
  const headings = logic.extractHeadings(blocks);
  if (!headings.length) {
    container.appendChild(h('div', { class: 'empty' }, '文档里还没有标题'));
    return;
  }
  const list = h('ul', { class: 'toc-list' });
  headings.forEach((heading, index) => {
    const item = h('li', {
      class: 'toc-item',
      title: '点击定位到该标题',
      onclick: () => {
        if (state.mode !== 'preview') {
          switchMode('preview', { silent: true });
        }
        const target = document.getElementById(`md-h-${index}`);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    },
      h('span', { class: 'toc-level', text: `H${heading.level}` }),
      h('span', { text: heading.text })
    );
    item.style.paddingLeft = `${8 + (heading.level - 1) * 14}px`;
    list.appendChild(item);
  });
  container.appendChild(list);
}

/* ── 工具栏 ───────────────────────────────────────────────── */

function surround(before, after = before, placeholder = '文本') {
  expandForEdit();
  const area = els.editor;
  const start = area.selectionStart;
  const end = area.selectionEnd;
  const selected = area.value.slice(start, end) || placeholder;
  area.setRangeText(`${before}${selected}${after}`, start, end, 'end');
  area.setSelectionRange(start + before.length, start + before.length + selected.length);
  area.focus();
  refresh();
}

function prefixLine(prefix, { placeholder = '内容' } = {}) {
  expandForEdit();
  const area = els.editor;
  const start = area.value.lastIndexOf('\n', Math.max(0, area.selectionStart - 1)) + 1;
  const end = area.selectionEnd;
  const lineEnd = area.value.indexOf('\n', start);
  const stop = lineEnd === -1 ? area.value.length : lineEnd;
  const line = area.value.slice(start, end === start ? stop : end) || placeholder;
  const replaced = line
    .split('\n')
    .map((entry) => `${prefix}${entry}`)
    .join('\n');
  area.setRangeText(replaced, start, end === start ? stop : end, 'end');
  area.focus();
  refresh();
}

function insertBlock(text) {
  expandForEdit();
  const area = els.editor;
  const start = area.selectionStart;
  const needsLeadingBreak = start > 0 && area.value[start - 1] !== '\n';
  const snippet = `${needsLeadingBreak ? '\n\n' : ''}${text}\n`;
  area.setRangeText(snippet, start, area.selectionEnd, 'end');
  area.focus();
  refresh();
}

const TOOLBAR = [
  { label: 'B', title: '粗体 (Ctrl+B)', run: () => surround('**') },
  { label: 'I', title: '斜体', run: () => surround('*') },
  { label: 'S', title: '删除线', run: () => surround('~~') },
  { label: '‹›', title: '行内代码', run: () => surround('`', '`', 'code') },
  { divider: true },
  { label: 'H1', title: '一级标题', run: () => prefixLine('# ') },
  { label: 'H2', title: '二级标题', run: () => prefixLine('## ') },
  { label: 'H3', title: '三级标题', run: () => prefixLine('### ') },
  { divider: true },
  { label: '•', title: '无序列表', run: () => prefixLine('- ') },
  { label: '1.', title: '有序列表', run: () => prefixLine('1. ') },
  { label: '☑', title: '任务列表', run: () => prefixLine('- [ ] ') },
  { label: '❝', title: '引用', run: () => prefixLine('> ') },
  { divider: true },
  { label: '🔗', title: '链接', run: () => surround('[', '](https://example.com)', '链接文字') },
  { label: '🖼', title: '图片', run: () => surround('![', '](https://example.com/image.png)', '替代文字') },
  { label: '—', title: '分隔线', run: () => insertBlock('---') },
  { label: '▦', title: '表格', run: () => insertBlock('| 列 1 | 列 2 |\n| --- | --- |\n| 内容 | 内容 |') },
  { label: '{ }', title: '代码块', run: () => insertBlock('```js\nconsole.log("hello");\n```') }
];

function renderToolbar() {
  const toolbar = els.toolbar;
  clear(toolbar);
  for (const item of TOOLBAR) {
    if (item.divider) {
      toolbar.appendChild(h('span', { class: 'divider' }));
      continue;
    }
    const button = h('button', {
      class: 'btn btn-icon',
      type: 'button',
      title: item.title,
      'aria-label': item.title
    }, item.label);
    button.addEventListener('click', item.run);
    toolbar.appendChild(button);
  }
}

/* ── 折叠编辑区 ───────────────────────────────────────────── */

/* 折叠状态下改文本是看不见的（命令面板仍可触发），先把编辑区放出来 */
function expandForEdit() {
  if (els.fold.get()) els.fold.set(false);
}

/* ── 输出与状态 ───────────────────────────────────────────── */

function renderActions(blocks) {
  const box = $('#actions');
  clear(box);

  const add = (label, run, iconName) => {
    const button = h('button', { class: 'btn btn-sm', type: 'button' }, icon(iconName, 12), h('span', { text: label }));
    button.addEventListener('click', run);
    box.appendChild(button);
  };

  add('复制 HTML', async () => {
    const { copy } = await import('../../core/clipboard.js');
    if (await copy(logic.toHtml(blocks))) toast.ok('HTML 已复制');
    else toast.fail('复制失败');
  }, 'copy');

  add('下载 .html', () => {
    downloadText('markdown.html', logic.toHtmlDocument(blocks, 'Markdown 导出'), 'text/html;charset=utf-8');
    toast.ok('已导出 HTML');
  }, 'download');

  add('下载 .md', () => {
    downloadText('document.md', els.editor.value, 'text/markdown;charset=utf-8');
    toast.ok('已导出 Markdown');
  }, 'download');
}

const MODE_HINTS = {
  preview: '预览通过 DOM 节点构建，原文中的 HTML 标签只会显示为文本',
  html: '导出的 HTML 已逐处转义，危险链接不会出现在 href 中',
  toc: '点击目录项可跳转到预览中的对应标题'
};

function renderOutput(blocks) {
  for (const tab of els.modes.querySelectorAll('[role="tab"]')) {
    tab.setAttribute('aria-selected', String(tab.dataset.mode === state.mode));
  }

  const box = $('#output');
  clear(box);

  if (!blocks.length) {
    box.appendChild(h('div', { class: 'empty' }, '输入 Markdown 后在此查看结果'));
  } else if (state.mode === 'html') {
    renderHtml(box, blocks);
  } else if (state.mode === 'toc') {
    renderToc(box, blocks);
  } else {
    renderPreview(box, blocks);
  }

  renderActions(blocks);
  els.outputStatus.textContent = MODE_HINTS[state.mode] || '';
}

function refresh() {
  const text = els.editor.value;
  write(`${STORAGE_ID}:text`, text);
  const blocks = logic.parseBlocks(text);
  const stats = logic.extractHeadings(blocks);
  const lines = text === '' ? 0 : text.split('\n').length;
  els.editorStatus.textContent = `${lines} 行 · ${[...text].length} 字符 · ${blocks.length} 个块 · ${stats.length} 个标题`;
  renderOutput(blocks);
}

function switchMode(mode, { silent = false } = {}) {
  state.mode = mode;
  write(`${STORAGE_ID}:mode`, mode);
  if (!silent) refresh();
}

/* ── 初始化 ───────────────────────────────────────────────── */

function init() {
  els.editor = $('#editor');
  els.toolbar = $('#toolbar');
  els.modes = $('#modes');
  els.editorStatus = $('#editor-status');
  els.outputStatus = $('#output-status');

  els.editor.value = read(`${STORAGE_ID}:text`, '') || SAMPLE;
  if (!['preview', 'html', 'toc'].includes(state.mode)) state.mode = 'preview';

  els.editor.addEventListener('input', debounce(refresh, 200));
  els.editor.addEventListener('keydown', (event) => {
    const mod = event.ctrlKey || event.metaKey;
    if (mod && event.key.toLowerCase() === 'b') {
      event.preventDefault();
      surround('**');
    }
    if (mod && event.key.toLowerCase() === 'i') {
      event.preventDefault();
      surround('*');
    }
    // 编辑区内按下 Tab 插入两个空格而不是切换焦点
    if (event.key === 'Tab' && !event.shiftKey) {
      event.preventDefault();
      const area = els.editor;
      area.setRangeText('  ', area.selectionStart, area.selectionEnd, 'end');
      refresh();
    }
  });

  for (const tab of els.modes.querySelectorAll('[role="tab"]')) {
    tab.addEventListener('click', () => switchMode(tab.dataset.mode));
  }

  renderToolbar();

  els.fold = createFold({
    layout: $('#md-layout'),
    head: $('#editor-head'),
    storageKey: `${STORAGE_ID}:folded`,
    noun: '编辑区',
    controls: 'editor-body'
  });

  mountTool({
    actions: [
      { id: 'mode-preview', label: '查看预览', icon: 'markdown', primary: true, keywords: 'preview 预览', run: () => switchMode('preview') },
      { id: 'mode-html', label: '查看 HTML 源码', icon: 'codec', keywords: 'html 源码', run: () => switchMode('html') },
      { id: 'mode-toc', label: '查看目录', icon: 'text', keywords: 'toc 目录 大纲', run: () => switchMode('toc') },
      {
        id: 'fold-editor',
        label: '折叠或展开编辑区',
        icon: 'collapse',
        keywords: 'fold collapse 折叠 展开 收起 编辑区 侧栏',
        run: () => {
          els.fold.set(!els.fold.get());
          els.fold.button.focus();
        }
      },
      { id: 'bold', label: '加粗选中文本', icon: 'text', keywords: 'bold 粗体', run: () => surround('**') },
      { id: 'code-block', label: '插入代码块', icon: 'codec', keywords: 'code 代码块', run: () => insertBlock('```js\nconsole.log(1);\n```') },
      { id: 'table', label: '插入表格', icon: 'sliders', keywords: 'table 表格', run: () => insertBlock('| 列 1 | 列 2 |\n| --- | --- |\n| 内容 | 内容 |') },
      {
        id: 'download-html',
        label: '导出为 HTML 文件',
        icon: 'download',
        keywords: 'download 导出 html',
        run: () => {
          downloadText('markdown.html', logic.toHtmlDocument(logic.parseBlocks(els.editor.value), 'Markdown 导出'), 'text/html;charset=utf-8');
          toast.ok('已导出 HTML');
        }
      }
    ]
  });

  refresh();
}

init();
