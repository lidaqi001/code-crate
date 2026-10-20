/* 文本处理 —— 纯逻辑层。
   全部为纯函数：接收文本、返回新文本，便于测试与撤销。 */

import {
  toCamelCase,
  toPascalCase,
  toSnakeCase,
  toKebabCase,
  toConstantCase,
  toTitleCase,
  toSentenceCase,
  toAlternatingCase,
  invertCase
} from '../../core/textcase.js';

export const CASE_OPS = [
  { id: 'upper', label: '全部大写', run: (text) => text.toUpperCase() },
  { id: 'lower', label: '全部小写', run: (text) => text.toLowerCase() },
  { id: 'title', label: '每词首字母大写', run: toTitleCase },
  { id: 'sentence', label: '句首大写', run: toSentenceCase },
  { id: 'camel', label: 'camelCase', run: toCamelCase },
  { id: 'pascal', label: 'PascalCase', run: toPascalCase },
  { id: 'snake', label: 'snake_case', run: toSnakeCase },
  { id: 'kebab', label: 'kebab-case', run: toKebabCase },
  { id: 'constant', label: 'CONSTANT_CASE', run: toConstantCase },
  { id: 'invert', label: '反转大小写', run: invertCase },
  { id: 'alternating', label: '交替大小写', run: toAlternatingCase }
];

const LINE_BREAK = /\r\n?|\n/g;

export function normalizeNewlines(text) {
  return String(text ?? '').replace(LINE_BREAK, '\n');
}

export function toLineArray(text) {
  return normalizeNewlines(text).split('\n');
}

/* ── 排序 / 去重 ──────────────────────────────────────────── */

export const SORT_MODES = [
  { id: 'text', label: '按文本' },
  { id: 'length', label: '按长度' },
  { id: 'number', label: '按数值' }
];

/**
 * 排序行。
 * @param {'asc'|'desc'} order
 * @param {'text'|'length'|'number'} by
 */
export function sortLines(text, { order = 'asc', by = 'text', locale = 'zh-CN' } = {}) {
  const lines = toLineArray(text);
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'variant' });
  const direction = order === 'desc' ? -1 : 1;

  const compare = (a, b) => {
    if (by === 'length') {
      const diff = [...a].length - [...b].length;
      return diff !== 0 ? diff * direction : collator.compare(a, b) * direction;
    }
    if (by === 'number') {
      const numA = firstNumber(a);
      const numB = firstNumber(b);
      if (numA === null && numB === null) return collator.compare(a, b) * direction;
      if (numA === null) return 1; // 无数字的行始终排在最后
      if (numB === null) return -1;
      return (numA - numB) * direction;
    }
    return collator.compare(a, b) * direction;
  };

  return [...lines].sort(compare).join('\n');
}

function firstNumber(line) {
  const match = /-?\d+(\.\d+)?/.exec(String(line));
  if (!match) return null;
  const value = Number(match[0]);
  return Number.isFinite(value) ? value : null;
}

/**
 * 去重（保留首次出现的顺序）。
 * @param {{ caseSensitive?: boolean, trim?: boolean }} options
 */
export function dedupeLines(text, { caseSensitive = true, trim = false } = {}) {
  const seen = new Set();
  const out = [];
  for (const line of toLineArray(text)) {
    const key = trim ? line.trim() : line;
    const normalized = caseSensitive ? key : key.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(line);
  }
  return out.join('\n');
}

export function reverseLines(text) {
  return toLineArray(text).reverse().join('\n');
}

/** 使用密码学随机源洗牌，避免 Math.random 的可预测性。 */
export function shuffleLines(text, rng) {
  const lines = toLineArray(text);
  const random = rng || cryptoRandom;
  for (let i = lines.length - 1; i > 0; i -= 1) {
    const j = random(i + 1);
    [lines[i], lines[j]] = [lines[j], lines[i]];
  }
  return lines.join('\n');
}

function cryptoRandom(max) {
  const range = max;
  const limit = Math.floor(0x100000000 / range) * range;
  const buffer = new Uint32Array(1);
  let value;
  do {
    if (globalThis.crypto && globalThis.crypto.getRandomValues) globalThis.crypto.getRandomValues(buffer);
    else buffer[0] = Math.floor(Math.random() * 0x100000000);
    value = buffer[0];
  } while (value >= limit);
  return value % range;
}

/* ── 行级编辑 ─────────────────────────────────────────────── */

export function removeEmptyLines(text, { trimFirst = true } = {}) {
  return toLineArray(text)
    .filter((line) => (trimFirst ? line.trim() : line) !== '')
    .join('\n');
}

export function trimLines(text) {
  return toLineArray(text).map((line) => line.trim()).join('\n');
}

export function addAffix(text, { prefix = '', suffix = '' } = {}) {
  return toLineArray(text).map((line) => `${prefix}${line}${suffix}`).join('\n');
}

export function numberLines(text, { start = 1, separator = '. ', pad = false } = {}) {
  const lines = toLineArray(text);
  const width = String(start + lines.length - 1).length;
  return lines
    .map((line, index) => {
      const number = start + index;
      const label = pad ? String(number).padStart(width, '0') : String(number);
      return `${label}${separator}${line}`;
    })
    .join('\n');
}

/** 按正则保留（或剔除）匹配的行。 */
export function filterLines(text, pattern, { invert = false, flags = '' } = {}) {
  if (!pattern) return String(text ?? '');
  let regex;
  try {
    regex = new RegExp(pattern, flags.replace(/[gy]/g, ''));
  } catch (error) {
    throw new Error(`正则无效：${error.message}`);
  }
  return toLineArray(text)
    .filter((line) => (invert ? !regex.test(line) : regex.test(line)))
    .join('\n');
}

export function joinLines(text, separator = ', ') {
  return toLineArray(text).join(separator);
}

export function splitToLines(text, separator = ',') {
  if (!separator) return String(text ?? '');
  return String(text ?? '').split(separator).join('\n');
}

/** 按指定宽度软换行（不切断单词，超长单词单独成行）。 */
export function wrapText(text, width = 80) {
  const limit = Math.max(1, Math.floor(width));
  return normalizeNewlines(text)
    .split('\n')
    .map((line) => {
      if ([...line].length <= limit) return line;
      const words = line.split(' ');
      const out = [];
      let current = '';
      for (const word of words) {
        const candidate = current ? `${current} ${word}` : word;
        if ([...candidate].length <= limit) {
          current = candidate;
        } else {
          if (current) out.push(current);
          current = word;
        }
      }
      if (current) out.push(current);
      return out.join('\n');
    })
    .join('\n');
}

/* ── 空白与清理 ───────────────────────────────────────────── */

export function collapseSpaces(text) {
  return String(text ?? '')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ ?\n ?/g, '\n');
}

export function removeAllSpaces(text) {
  return String(text ?? '').replace(/\s+/g, '');
}

export function removeLineBreaks(text, replacement = ' ') {
  return normalizeNewlines(text).replace(/\n+/g, replacement);
}

/** 合并多余空行，最多保留一个空行。 */
export function collapseBlankLines(text) {
  return normalizeNewlines(text).replace(/\n{3,}/g, '\n\n');
}

export function stripHtmlTags(text) {
  return String(text ?? '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/gi, '&');
}

export function removePunctuation(text) {
  return String(text ?? '').replace(/[\u3000-\u303f\uff00-\uffef!-/:-@[-`{-~]/g, '');
}

/* ── 转义 ─────────────────────────────────────────────────── */

export const ESCAPE_OPS = [
  { id: 'regex', label: '转义正则特殊字符', run: escapeRegExp, hint: '把文本安全地放进 new RegExp()' },
  { id: 'shell', label: '转义为 Shell 参数', run: escapeShellArg, hint: '单引号包裹，可安全传给命令行' },
  { id: 'csv', label: '转义为 CSV 字段', run: escapeCsvField, hint: '按 RFC 4180 加引号并转义双引号' },
  { id: 'html', label: '转义 HTML 实体', run: escapeHtmlText, hint: '转义 & < > " \'' },
  { id: 'sql', label: '转义 SQL 字符串', run: (text) => `'${String(text).replace(/'/g, "''")}'`, hint: '单引号包裹并把单引号翻倍' }
];

export function escapeRegExp(text) {
  return String(text ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function escapeShellArg(text) {
  return `'${String(text ?? '').replace(/'/g, `'\\''`)}'`;
}

export function escapeCsvField(text) {
  const value = String(text ?? '');
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function escapeHtmlText(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ── 统计 ─────────────────────────────────────────────────── */

const CJK_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/g;

/**
 * 文本统计。字符数按 Unicode 码点计算，因此 emoji 与中文都算 1 个字符。
 */
export function textStats(text) {
  const source = String(text ?? '');
  const lines = source === '' ? 0 : source.split(/\r\n?|\n/).length;

  return {
    chars: [...source].length,
    charsNoSpaces: [...source.replace(/\s/g, '')].length,
    words: (source.match(/[A-Za-z0-9_']+/g) || []).length,
    cjk: (source.match(CJK_RE) || []).length,
    lines,
    paragraphs: source.trim() === '' ? 0 : source.trim().split(/\n\s*\n/).length,
    bytes: new TextEncoder().encode(source).length,
    longestLine: source.split(/\r\n?|\n/).reduce((max, line) => Math.max(max, [...line].length), 0),
    emptyLines: source === '' ? 0 : source.split(/\r\n?|\n/).filter((line) => line.trim() === '').length
  };
}
