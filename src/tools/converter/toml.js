/* TOML 解析与序列化 —— 纯逻辑层。
 *
 * 支持 TOML 1.0 的常用部分：
 *   键值对 / 点分键 / 带引号的键 / [表] / [[数组表]] /
 *   基本字符串与字面字符串（含三引号多行）/ 整数（含 0x 0o 0b 与下划线）/ 浮点 / 布尔 /
 *   数组（可跨行）/ 内联表
 *
 * 两个明确的边界（界面上会提示）：
 * 1. 日期时间按 RFC 3339 识别，但以**字符串**形式返回，因此 TOML → JSON → TOML
 *    会让日期变成带引号的字符串。这样选是为了让 JSON 输出保持可读且不引入特殊对象。
 * 2. TOML 没有 null，序列化遇到 null 会直接报错并指出位置，而不是静默丢弃数据。
 */

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const BARE_KEY_RE = /^[A-Za-z0-9_-]+$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}([Tt ]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})?)?$/;
const TIME_RE = /^\d{2}:\d{2}:\d{2}(\.\d+)?$/;

/** 去掉行尾注释：只有出现在字符串外的 # 才算注释。 */
export function stripTomlComment(line) {
  let inBasic = false;
  let inLiteral = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (inBasic) {
      if (char === '\\') i += 1;
      else if (char === '"') inBasic = false;
      continue;
    }
    if (inLiteral) {
      if (char === "'") inLiteral = false;
      continue;
    }
    if (char === '"') inBasic = true;
    else if (char === "'") inLiteral = true;
    else if (char === '#') return line.slice(0, i);
  }
  return line;
}

/** 去掉字符串之外的 # 注释；多行字符串内部的 # 原样保留。 */
function stripCommentsOutsideStrings(text) {
  const source = String(text);
  let out = '';
  let quote = null;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];

    if (quote === '"""' || quote === "'''") {
      if (char === '\\' && quote === '"""') {
        out += char + (source[i + 1] ?? '');
        i += 1;
        continue;
      }
      if (char === quote[0] && source[i + 1] === quote[0] && source[i + 2] === quote[0]) {
        out += quote;
        i += 2;
        quote = null;
        continue;
      }
      out += char;
      continue;
    }

    if (quote === '"' || quote === "'") {
      if (char === '\\' && quote === '"') {
        out += char + (source[i + 1] ?? '');
        i += 1;
        continue;
      }
      if (char === quote) {
        out += char;
        quote = null;
        continue;
      }
      out += char;
      continue;
    }

    if (char === '#') {
      while (i < source.length && source[i] !== '\n') i += 1;
      if (i < source.length) out += '\n';
      continue;
    }

    if (char === '"' || char === "'") {
      if (source[i + 1] === char && source[i + 2] === char) {
        out += char.repeat(3);
        i += 2;
        quote = char.repeat(3);
        continue;
      }
      out += char;
      quote = char;
      continue;
    }

    out += char;
  }

  return out;
}

function countUnclosed(text) {
  let depth = 0;
  let inBasic = false;
  let inLiteral = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inBasic) {
      if (char === '\\') i += 1;
      else if (char === '"') inBasic = false;
      continue;
    }
    if (inLiteral) {
      if (char === "'") inLiteral = false;
      continue;
    }
    if (char === '"') inBasic = true;
    else if (char === "'") inLiteral = true;
    else if (char === '[' || char === '{') depth += 1;
    else if (char === ']' || char === '}') depth -= 1;
  }
  return depth;
}

export function resolveTomlScalar(token, lineIndex, fail) {
  const text = token.trim();
  if (text === '') fail('缺少值', lineIndex);

  if (text === 'true') return true;
  if (text === 'false') return false;

  if (text === 'inf' || text === '+inf') return Infinity;
  if (text === '-inf') return -Infinity;
  if (text === 'nan' || text === '+nan' || text === '-nan') return NaN;

  if (/^[+-]?0x[0-9a-fA-F](_?[0-9a-fA-F])*$/.test(text)) {
    return Number.parseInt(text.replace(/_/g, '').replace(/^\+/, ''), 16);
  }
  if (/^[+-]?0o[0-7](_?[0-7])*$/.test(text)) {
    return Number.parseInt(text.replace(/_/g, '').replace(/^\+/, '').slice(2), 8);
  }
  if (/^[+-]?0b[01](_?[01])*$/.test(text)) {
    return Number.parseInt(text.replace(/_/g, '').replace(/^\+/, '').slice(2), 2);
  }
  if (/^[+-]?\d(_?\d)*$/.test(text)) return Number(text.replace(/_/g, ''));

  if (/^[+-]?(\d(_?\d)*)?\.?\d(_?\d)*([eE][+-]?\d(_?\d)*)?$/.test(text) && /[.eE]/.test(text)) {
    return Number(text.replace(/_/g, ''));
  }

  // 日期与时间按 RFC 3339 识别，但以字符串返回（见文件头说明）
  if (DATETIME_RE.test(text) || TIME_RE.test(text)) return text;

  fail(`无法识别的值：${text}`, lineIndex);
  return null;
}

class ValueParser {
  constructor(text, lineIndex, fail) {
    this.text = text;
    this.index = 0;
    this.lineIndex = lineIndex;
    this.fail = fail;
  }

  atEnd() {
    return this.index >= this.text.length;
  }

  skip() {
    while (this.index < this.text.length && /\s/.test(this.text[this.index])) this.index += 1;
  }

  parseValue() {
    this.skip();
    const char = this.text[this.index];
    if (char === '[') return this.parseArray();
    if (char === '{') return this.parseInlineTable();
    if (char === '"' || char === "'") return this.parseString();
    return this.parseBare();
  }

  parseBare() {
    const start = this.index;
    while (this.index < this.text.length && !/[,\]}[\]]/.test(this.text[this.index])) this.index += 1;
    const token = this.text.slice(start, this.index).trim();
    return resolveTomlScalar(token, this.lineIndex, this.fail);
  }

  parseString() {
    const source = this.text;
    const quote = source[this.index];

    if (source.startsWith(quote.repeat(3), this.index)) {
      const close = source.indexOf(quote.repeat(3), this.index + 3);
      if (close < 0) this.fail('多行字符串未闭合', this.lineIndex);
      let body = source.slice(this.index + 3, close);
      if (body.startsWith('\n')) body = body.slice(1);
      // 行尾反斜杠：吞掉换行与后续空白
      if (quote === '"') {
        body = body.replace(/\\\n\s*/g, '');
        body = decodeBasicEscapes(body, this.lineIndex, this.fail);
      }
      this.index = close + 3;
      return body;
    }

    const start = this.index + 1;
    let i = start;
    while (i < source.length) {
      const char = source[i];
      if (quote === '"' && char === '\\') {
        i += 2;
        continue;
      }
      if (char === quote) break;
      i += 1;
    }
    if (i >= source.length) this.fail('字符串未闭合', this.lineIndex);

    const body = source.slice(start, i);
    this.index = i + 1;
    return quote === '"' ? decodeBasicEscapes(body, this.lineIndex, this.fail) : body;
  }

  parseArray() {
    this.index += 1;
    const items = [];
    for (;;) {
      this.skip();
      while (this.text[this.index] === ',') {
        this.index += 1;
        this.skip();
      }
      if (this.text[this.index] === ']') {
        this.index += 1;
        return items;
      }
      if (this.atEnd()) this.fail('数组未闭合', this.lineIndex);
      items.push(this.parseValue());
      this.skip();
      if (this.text[this.index] === ',') {
        this.index += 1;
        continue;
      }
      if (this.text[this.index] === ']') {
        this.index += 1;
        return items;
      }
      this.fail('数组中缺少 , 或 ]', this.lineIndex);
    }
  }

  parseInlineTable() {
    this.index += 1;
    const result = {};
    for (;;) {
      this.skip();
      if (this.text[this.index] === '}') {
        this.index += 1;
        return result;
      }
      if (this.atEnd()) this.fail('内联表未闭合', this.lineIndex);

      const path = this.parseKeyPath();
      this.skip();
      if (this.text[this.index] !== '=') this.fail('内联表中缺少 =', this.lineIndex);
      this.index += 1;
      const value = this.parseValue();
      assignPath(result, path, value, this.fail, this.lineIndex);

      this.skip();
      if (this.text[this.index] === ',') {
        this.index += 1;
        continue;
      }
      if (this.text[this.index] === '}') {
        this.index += 1;
        return result;
      }
      this.fail('内联表中缺少 , 或 }', this.lineIndex);
    }
  }

  parseKeyPath() {
    const parts = [];
    for (;;) {
      this.skip();
      const char = this.text[this.index];
      if (char === '"' || char === "'") {
        parts.push(this.parseString());
      } else {
        const match = /^[A-Za-z0-9_-]+/.exec(this.text.slice(this.index));
        if (!match) this.fail('键名不合法', this.lineIndex);
        parts.push(match[0]);
        this.index += match[0].length;
      }
      this.skip();
      if (this.text[this.index] === '.') {
        this.index += 1;
        continue;
      }
      return parts;
    }
  }
}

function decodeBasicEscapes(text, lineIndex, fail) {
  return text.replace(/\\(u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|.)/g, (match, code) => {
    if (code === 'n') return '\n';
    if (code === 't') return '\t';
    if (code === 'r') return '\r';
    if (code === 'b') return '\b';
    if (code === 'f') return '\f';
    if (code === '"') return '"';
    if (code === '\\') return '\\';
    if (code[0] === 'u' || code[0] === 'U') {
      const value = Number.parseInt(code.slice(1), 16);
      return Number.isFinite(value) ? String.fromCodePoint(value) : match;
    }
    return fail(`不支持的转义 \\${code}`, lineIndex);
  });
}

export function parseKeyPathText(text, lineIndex, fail) {
  const parser = new ValueParser(text, lineIndex, fail);
  const path = parser.parseKeyPath();
  parser.skip();
  if (!parser.atEnd()) fail('键名后面有多余内容', lineIndex);
  return path;
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

/** 防原型污染：任何一段路径命中危险键名都直接拒绝。 */
function assertSafePath(path, fail, lineIndex) {
  for (const key of path) {
    if (FORBIDDEN_KEYS.has(key)) fail(`不允许的键名「${key}」`, lineIndex);
  }
}

function assignPath(target, path, value, fail, lineIndex) {
  assertSafePath(path, fail, lineIndex);
  let node = target;
  for (let i = 0; i < path.length - 1; i += 1) {
    const key = path[i];
    if (!own(node, key)) node[key] = {};
    if (!isPlainObject(node[key])) fail(`键「${path.slice(0, i + 1).join('.')}」已经被占用`, lineIndex);
    node = node[key];
  }
  const last = path[path.length - 1];
  if (own(node, last)) {
    fail(`键「${path.join('.')}」重复定义`, lineIndex);
  }
  node[last] = value;
}

function createTable(root, path, lineIndex, fail) {
  assertSafePath(path, fail, lineIndex);
  let node = root;
  for (const key of path) {
    if (!own(node, key)) node[key] = {};
    if (Array.isArray(node[key])) node = node[key][node[key].length - 1];
    else if (isPlainObject(node[key])) node = node[key];
    else fail(`无法在「${key}」下建表：它已经是标量`, lineIndex);
  }
  return node;
}

function createArrayTable(root, path, lineIndex, fail) {
  assertSafePath(path, fail, lineIndex);
  const parent = createTable(root, path.slice(0, -1), lineIndex, fail);
  const last = path[path.length - 1];
  if (!own(parent, last)) parent[last] = [];
  if (!Array.isArray(parent[last])) fail(`键「${path.join('.')}」不是数组表`, lineIndex);
  const item = {};
  parent[last].push(item);
  return item;
}

/**
 * 解析 TOML 文档。
 * @returns {object}
 */
export function parseToml(text) {
  const source = String(text ?? '').replace(/\r\n?/g, '\n');
  if (source.trim() === '') return {};

  const lines = source.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();

  const fail = (message, lineIndex) => {
    const error = new Error(`${message}（第 ${lineIndex + 1} 行）`);
    error.line = lineIndex + 1;
    throw error;
  };

  const root = {};
  let current = root;
  let i = 0;

  while (i < lines.length) {
    const line = stripTomlComment(lines[i]).trim();
    if (line === '') {
      i += 1;
      continue;
    }

    if (line.startsWith('[[')) {
      const end = line.indexOf(']]');
      if (end < 0) fail('数组表头未闭合', i);
      if (line.slice(end + 2).trim() !== '') fail('数组表头后面有多余内容', i);
      current = createArrayTable(root, parseKeyPathText(line.slice(2, end).trim(), i, fail), i, fail);
      i += 1;
      continue;
    }

    if (line.startsWith('[')) {
      const end = line.indexOf(']');
      if (end < 0) fail('表头未闭合', i);
      if (line.slice(end + 1).trim() !== '') fail('表头后面有多余内容', i);
      current = createTable(root, parseKeyPathText(line.slice(1, end).trim(), i, fail), i, fail);
      i += 1;
      continue;
    }

    // key = value（值可能跨多行）。用原始行解析，避免多行字符串里的 # 被当成注释。
    const rawLine = lines[i].replace(/^\s+/, '');
    const parser = new ValueParser(rawLine, i, fail);
    const path = parser.parseKeyPath();
    parser.skip();
    if (rawLine[parser.index] !== '=') fail('期望 key = value', i);
    parser.index += 1;

    let rest = stripCommentsOutsideStrings(rawLine.slice(parser.index));
    let endLine = i;
    while (endLine + 1 < lines.length && (countUnclosed(rest) > 0 || needsMoreLines(rest))) {
      endLine += 1;
      rest += `\n${lines[endLine]}`;
      rest = stripCommentsOutsideStrings(rest);
    }
    if (countUnclosed(rest) > 0) fail('值未闭合', i);
    if (needsMoreLines(rest)) fail('多行字符串未闭合', i);

    const valueParser = new ValueParser(rest, i, fail);
    const value = valueParser.parseValue();
    valueParser.skip();
    if (!valueParser.atEnd()) fail('值后面有多余内容', i);

    assignPath(current, path, value, fail, i);
    i = endLine + 1;
  }

  return root;
}

/** 三引号字符串是否还没结束。 */
function needsMoreLines(text) {
  const trimmed = text.trim();
  for (const quote of ['"""', "'''"]) {
    if (!trimmed.startsWith(quote)) continue;
    return !trimmed.slice(3).includes(quote);
  }
  return false;
}

/* ── 序列化 ───────────────────────────────────────────────── */

function formatTomlKey(key) {
  return BARE_KEY_RE.test(key) ? key : `"${String(key).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function formatTomlString(text) {
  const value = String(text);
  if (value.includes('\n') && value !== '\n') {
    const body = value.replace(/\\/g, '\\\\').replace(/"""/g, '\\"\\"\\"');
    return `"""\n${body}"""`;
  }
  return `"${value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
    .replace(/\r/g, '\\r')}"`;
}

function isArrayOfTables(value) {
  return Array.isArray(value) && value.length > 0 && value.every(isPlainObject);
}

function formatInlineValue(value, path) {
  if (value === null) throw new Error(`TOML 不支持 null（位置：${path}）`);
  if (value === undefined) return null;

  if (typeof value === 'string') return formatTomlString(value);
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return 'nan';
    if (value === Infinity) return 'inf';
    if (value === -Infinity) return '-inf';
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => formatInlineValue(item, `${path}[]`)).filter((item) => item !== null).join(', ')}]`;
  }
  if (isPlainObject(value)) {
    const parts = [];
    for (const [key, child] of Object.entries(value)) {
      const rendered = formatInlineValue(child, `${path}.${key}`);
      if (rendered === null) continue;
      parts.push(`${formatTomlKey(key)} = ${rendered}`);
    }
    return `{ ${parts.join(', ')} }`;
  }
  throw new Error(`无法序列化为 TOML 的类型：${typeof value}（位置：${path}）`);
}

/**
 * 序列化为 TOML。
 * 顶层必须是对象；标量先输出，随后是子表与数组表（TOML 要求如此）。
 */
export function toToml(value, { header = '' } = {}) {
  if (!isPlainObject(value)) {
    throw new Error('TOML 顶层必须是一个对象（表）');
  }

  const lines = [];
  if (header) lines.push(`# ${header}`);

  const emitTable = (table, path) => {
    const scalars = [];
    const subTables = [];
    const arrayTables = [];

    for (const [key, child] of Object.entries(table)) {
      if (child === undefined) continue;
      if (isPlainObject(child)) subTables.push([key, child]);
      else if (isArrayOfTables(child)) arrayTables.push([key, child]);
      else scalars.push([key, child]);
    }

    for (const [key, child] of scalars) {
      const rendered = formatInlineValue(child, path ? `${path}.${key}` : key);
      if (rendered === null) continue;
      lines.push(`${formatTomlKey(key)} = ${rendered}`);
    }

    for (const [key, child] of subTables) {
      const childPath = path ? `${path}.${key}` : key;
      if (lines.length) lines.push('');
      lines.push(`[${childPath.split('.').map(formatTomlKey).join('.')}]`);
      emitTable(child, childPath);
    }

    for (const [key, child] of arrayTables) {
      const childPath = path ? `${path}.${key}` : key;
      for (const item of child) {
        if (lines.length) lines.push('');
        lines.push(`[[${childPath.split('.').map(formatTomlKey).join('.')}]]`);
        emitTable(item, childPath);
      }
    }
  };

  emitTable(value, '');
  return `${lines.join('\n')}\n`;
}
