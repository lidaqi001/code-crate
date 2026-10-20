/* Markdown 解析 —— 纯逻辑层。
 *
 * 设计要点（这是旧版本出安全问题的地方）：
 * 解析结果是一棵**节点树**，不是 HTML 字符串。界面层用 DOM API 与 textContent
 * 把它渲染出来，因此「属性注入」在结构上就不可能发生。
 * 只有在导出 HTML 时才生成字符串，那时会用 escapeHtml 逐处转义。
 *
 * 链接与图片地址还会经过协议白名单过滤，javascript: / data: / vbscript: 一律拦截。
 */

const ESCAPABLE = '\\`*_{}[]()#+-.!|>~';

const SAFE_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:']);

/**
 * 过滤不安全的 URL。
 * @returns {string|null} 安全 URL，或 null（表示已拦截）
 */
export function sanitizeUrl(raw) {
  const url = String(raw ?? '').trim();
  if (!url) return null;

  // 攻击者常用控制字符/空白拆分协议名（java\tscript:），先压缩再判断
  const compact = url.replace(/[\u0000-\u0020\u007f]+/g, '');
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(compact);

  if (scheme) {
    const normalized = `${scheme[1].toLowerCase()}:`;
    return SAFE_SCHEMES.has(normalized) ? url : null;
  }

  // 相对路径、锚点、协议相对地址都放行（不构成脚本执行）
  return url;
}

export function isUrlBlocked(raw) {
  const url = String(raw ?? '').trim();
  if (!url) return false;
  return sanitizeUrl(url) === null;
}

/* ── 行内解析 ─────────────────────────────────────────────── */

function matchInlineLink(text, start) {
  if (text[start] !== '[') return null;
  const close = text.indexOf(']', start + 1);
  if (close < 0) return null;
  if (text[close + 1] !== '(') return null;
  const paren = text.indexOf(')', close + 2);
  if (paren < 0) return null;

  const label = text.slice(start + 1, close);
  let target = text.slice(close + 2, paren).trim();
  // 去掉可选标题：url "title"
  const withTitle = /^(\S+)\s+["'(].*["')]$/.exec(target);
  if (withTitle) target = withTitle[1];

  return { label, target, end: paren + 1 };
}

/**
 * 解析行内标记。
 * @returns {Array<object>} 行内节点数组
 */
export function parseInline(text) {
  const source = String(text ?? '');
  const nodes = [];
  let buffer = '';
  let i = 0;

  const flush = () => {
    if (buffer) {
      nodes.push({ type: 'text', value: buffer });
      buffer = '';
    }
  };

  while (i < source.length) {
    const char = source[i];

    // 反斜杠转义
    if (char === '\\' && i + 1 < source.length && ESCAPABLE.includes(source[i + 1])) {
      buffer += source[i + 1];
      i += 2;
      continue;
    }

    // 行内代码（最高优先级，内部不再解析）
    if (char === '`') {
      const end = source.indexOf('`', i + 1);
      if (end > i) {
        flush();
        nodes.push({ type: 'code', value: source.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    // 图片 ![alt](src)
    if (char === '!' && source[i + 1] === '[') {
      const match = matchInlineLink(source, i + 1);
      if (match) {
        flush();
        nodes.push({
          type: 'image',
          alt: match.label,
          src: sanitizeUrl(match.target),
          blocked: isUrlBlocked(match.target)
        });
        i = match.end;
        continue;
      }
    }

    // 链接 [text](href)
    if (char === '[') {
      const match = matchInlineLink(source, i);
      if (match) {
        flush();
        nodes.push({
          type: 'link',
          href: sanitizeUrl(match.target),
          blocked: isUrlBlocked(match.target),
          children: parseInline(match.label)
        });
        i = match.end;
        continue;
      }
    }

    // 粗体 **text**
    if (source.startsWith('**', i)) {
      const end = source.indexOf('**', i + 2);
      if (end > i + 1) {
        flush();
        nodes.push({ type: 'strong', children: parseInline(source.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }

    // 删除线 ~~text~~
    if (source.startsWith('~~', i)) {
      const end = source.indexOf('~~', i + 2);
      if (end > i + 1) {
        flush();
        nodes.push({ type: 'del', children: parseInline(source.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }

    // 斜体 *text*（避免把 ** 误判进来）
    if (char === '*' && source[i + 1] !== '*') {
      const end = source.indexOf('*', i + 1);
      if (end > i) {
        flush();
        nodes.push({ type: 'em', children: parseInline(source.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }

    // 下划线斜体 _text_
    if (char === '_') {
      const end = source.indexOf('_', i + 1);
      if (end > i) {
        flush();
        nodes.push({ type: 'em', children: parseInline(source.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }

    // 硬换行
    if (char === '\n') {
      flush();
      nodes.push({ type: 'br' });
      i += 1;
      continue;
    }

    buffer += char;
    i += 1;
  }

  flush();
  return nodes;
}

/** 把行内节点还原为纯文本（用于统计、目录等）。 */
export function inlineToText(nodes) {
  return (nodes || [])
    .map((node) => {
      if (node.type === 'text' || node.type === 'code') return node.value;
      if (node.children) return inlineToText(node.children);
      if (node.type === 'image') return node.alt || '';
      if (node.type === 'br') return '\n';
      return '';
    })
    .join('');
}

/* ── 块级解析 ─────────────────────────────────────────────── */

const HEADING_RE = /^(#{1,6})\s+(.*?)(?:\s+#+)?$/;
const FENCE_RE = /^```\s*([\w+#.-]*)\s*$/;
// 分隔线允许字符之间带空格（CommonMark 的 - - - 与 --- 等价）
const HR_RE = /^\s*(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/;
const QUOTE_RE = /^\s*>\s?(.*)$/;
const UL_RE = /^\s*[-*+]\s+(.*)$/;
const OL_RE = /^\s*(\d+)[.)]\s+(.*)$/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?\s*$/;
const TASK_RE = /^\[([ xX])\]\s+(.*)$/;

function splitTableRow(line) {
  return line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function parseAlignment(separatorLine) {
  return splitTableRow(separatorLine).map((cell) => {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    return 'left';
  });
}

/**
 * 解析 Markdown 为块级节点树。
 * @returns {Array<object>}
 */
export function parseBlocks(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 空行
    if (line.trim() === '') {
      i += 1;
      continue;
    }

    // 围栏代码块
    const fence = FENCE_RE.exec(line);
    if (fence) {
      const lang = fence[1] || '';
      const code = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        code.push(lines[i]);
        i += 1;
      }
      i += 1; // 跳过结束围栏（或文件末尾）
      blocks.push({ type: 'code', lang, value: code.join('\n') });
      continue;
    }

    // 标题
    const heading = HEADING_RE.exec(line);
    if (heading) {
      blocks.push({
        type: 'heading',
        level: heading[1].length,
        text: heading[2],
        inline: parseInline(heading[2])
      });
      i += 1;
      continue;
    }

    // 分隔线
    if (HR_RE.test(line)) {
      blocks.push({ type: 'hr' });
      i += 1;
      continue;
    }

    // 表格：当前行含 | 且下一行是分隔行
    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1])) {
      const headers = splitTableRow(line).map(parseInline);
      const aligns = parseAlignment(lines[i + 1]);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(splitTableRow(lines[i]).map(parseInline));
        i += 1;
      }
      blocks.push({ type: 'table', headers, aligns, rows });
      continue;
    }

    // 引用
    if (QUOTE_RE.test(line)) {
      const inner = [];
      while (i < lines.length && QUOTE_RE.test(lines[i])) {
        inner.push(QUOTE_RE.exec(lines[i])[1]);
        i += 1;
      }
      blocks.push({ type: 'blockquote', blocks: parseBlocks(inner.join('\n')) });
      continue;
    }

    // 列表
    if (UL_RE.test(line) || OL_RE.test(line)) {
      const ordered = OL_RE.test(line);
      const items = [];
      while (i < lines.length && (ordered ? OL_RE.test(lines[i]) : UL_RE.test(lines[i]))) {
        const raw = ordered ? OL_RE.exec(lines[i])[2] : UL_RE.exec(lines[i])[1];
        const task = TASK_RE.exec(raw);
        if (task) {
          items.push({ task: true, checked: task[1].toLowerCase() === 'x', inline: parseInline(task[2]) });
        } else {
          items.push({ task: false, inline: parseInline(raw) });
        }
        i += 1;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    // 段落：持续收集直到空行或新的块级结构
    const paragraph = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !HEADING_RE.test(lines[i]) &&
      !FENCE_RE.test(lines[i]) &&
      !HR_RE.test(lines[i]) &&
      !QUOTE_RE.test(lines[i]) &&
      !UL_RE.test(lines[i]) &&
      !OL_RE.test(lines[i])
    ) {
      paragraph.push(lines[i]);
      i += 1;
    }
    if (paragraph.length) {
      blocks.push({ type: 'paragraph', inline: parseInline(paragraph.join('\n')) });
    }
  }

  return blocks;
}

/* ── 目录 ─────────────────────────────────────────────────── */

export function extractHeadings(blocks) {
  const headings = [];
  const walk = (list) => {
    for (const block of list) {
      if (block.type === 'heading') {
        headings.push({ level: block.level, text: inlineToText(block.inline) });
      } else if (block.type === 'blockquote') {
        walk(block.blocks);
      }
    }
  };
  walk(blocks);
  return headings;
}

/* ── 导出 HTML（唯一需要拼字符串的地方，逐处转义） ─────────── */

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inlineToHtml(nodes) {
  return (nodes || [])
    .map((node) => {
      switch (node.type) {
        case 'text':
          return escapeHtml(node.value);
        case 'code':
          return `<code>${escapeHtml(node.value)}</code>`;
        case 'strong':
          return `<strong>${inlineToHtml(node.children)}</strong>`;
        case 'em':
          return `<em>${inlineToHtml(node.children)}</em>`;
        case 'del':
          return `<del>${inlineToHtml(node.children)}</del>`;
        case 'br':
          return '<br>';
        case 'link':
          // href 已在解析阶段过滤，仍再次确认非空才输出
          return node.href
            ? `<a href="${escapeHtml(node.href)}" target="_blank" rel="noopener noreferrer">${inlineToHtml(node.children)}</a>`
            : `${inlineToHtml(node.children)}<span class="blocked-link">（已拦截不安全链接）</span>`;
        case 'image':
          return node.src
            ? `<img src="${escapeHtml(node.src)}" alt="${escapeHtml(node.alt || '')}" loading="lazy">`
            : `<span class="blocked-link">（已拦截不安全图片：${escapeHtml(node.alt || '')}）</span>`;
        default:
          return '';
      }
    })
    .join('');
}

export function toHtml(blocks) {
  return blocks
    .map((block) => {
      switch (block.type) {
        case 'heading':
          return `<h${block.level}>${inlineToHtml(block.inline)}</h${block.level}>`;
        case 'paragraph':
          return `<p>${inlineToHtml(block.inline)}</p>`;
        case 'code':
          return `<pre><code${block.lang ? ` class="language-${escapeHtml(block.lang)}"` : ''}>${escapeHtml(block.value)}</code></pre>`;
        case 'hr':
          return '<hr>';
        case 'blockquote':
          return `<blockquote>\n${toHtml(block.blocks)}\n</blockquote>`;
        case 'list': {
          const tag = block.ordered ? 'ol' : 'ul';
          const items = block.items
            .map((item) => {
              if (item.task) {
                return `<li class="task"><input type="checkbox" disabled${item.checked ? ' checked' : ''}> ${inlineToHtml(item.inline)}</li>`;
              }
              return `<li>${inlineToHtml(item.inline)}</li>`;
            })
            .join('\n');
          return `<${tag}>\n${items}\n</${tag}>`;
        }
        case 'table': {
          const head = block.headers.map((cell, index) => `<th style="text-align:${block.aligns[index] || 'left'}">${inlineToHtml(cell)}</th>`).join('');
          const body = block.rows
            .map((row) => `<tr>${block.headers.map((_h, index) => `<td style="text-align:${block.aligns[index] || 'left'}">${inlineToHtml(row[index] || [])}</td>`).join('')}</tr>`)
            .join('\n');
          return `<table>\n<thead><tr>${head}</tr></thead>\n<tbody>\n${body}\n</tbody>\n</table>`;
        }
        default:
          return '';
      }
    })
    .join('\n');
}

/** 生成可直接打开的独立 HTML 文档。 */
export function toHtmlDocument(blocks, title = 'Markdown 导出') {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body { max-width: 760px; margin: 40px auto; padding: 0 20px; line-height: 1.7;
         font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", Roboto, sans-serif; color: #1f2328; }
  pre { background: #f6f8fa; padding: 12px; border-radius: 6px; overflow: auto; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.9em; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #d0d7de; padding: 6px 10px; }
  blockquote { margin: 0; padding-left: 14px; border-left: 3px solid #d0d7de; color: #57606a; }
  img { max-width: 100%; }
  .blocked-link { color: #cf222e; font-size: 0.85em; }
</style>
</head>
<body>
${toHtml(blocks)}
</body>
</html>`;
}
