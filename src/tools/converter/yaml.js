/* YAML 解析与序列化 —— 纯逻辑层。
 *
 * 这是一个**明确限定范围**的实现，覆盖真实配置文件里的绝大多数写法：
 *   块映射 / 块序列 / 嵌套缩进 / 序列中的映射 / 流式 [] {} / 单双引号字符串 /
 *   多行标量（| 与 >，含 - + 与缩进指示符）/ 注释 / null 布尔数字
 * 刻意不支持（遇到会给出明确报错，而不是猜）：
 *   锚点与别名（& *）、标签（!!）、多文档（--- 多个 / ...）、复杂键（? ）、制表符缩进
 *
 * 类型解析采用 YAML 1.2 core schema：只有 true/false 是布尔，
 * yes/no/on/off 一律当字符串 —— 避免经典的「Norway 问题」（NO 被读成 false）。
 */

const SPECIAL_START = /^[-?:,[\]{}#&*!|>'"%@`]/;

export function resolveScalar(text) {
  const value = String(text).trim();
  if (value === '' || value === '~' || /^(null|Null|NULL)$/.test(value)) return null;
  if (/^(true|True|TRUE)$/.test(value)) return true;
  if (/^(false|False|FALSE)$/.test(value)) return false;
  if (/^[+-]?\d+$/.test(value)) return Number(value);
  if (/^0x[0-9a-fA-F]+$/.test(value)) return Number.parseInt(value, 16);
  if (/^0o[0-7]+$/.test(value)) return Number.parseInt(value.slice(2), 8);
  if (/^[+-]?(\d+\.\d*|\.\d+|\d+)([eE][+-]?\d+)?$/.test(value) && /[.eE]/.test(value)) return Number(value);
  if (/^[+-]?\.(inf|Inf|INF)$/.test(value)) return value.startsWith('-') ? -Infinity : Infinity;
  if (/^\.(nan|NaN|NAN)$/.test(value)) return NaN;
  return value;
}

/* ── 文本预处理 ───────────────────────────────────────────── */

/** 去掉行尾注释：只有出现在行首或空白之后的 # 才算注释。 */
export function stripComment(line) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (inSingle) {
      if (char === "'") {
        if (line[i + 1] === "'") i += 1;
        else inSingle = false;
      }
      continue;
    }
    if (inDouble) {
      if (char === '\\') i += 1;
      else if (char === '"') inDouble = false;
      continue;
    }
    if (char === "'") inSingle = true;
    else if (char === '"') inDouble = true;
    else if (char === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
}

function findKeySeparator(content) {
  let inSingle = false;
  let inDouble = false;
  let depth = 0;
  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];
    if (inSingle) {
      if (char === "'") {
        if (content[i + 1] === "'") i += 1;
        else inSingle = false;
      }
      continue;
    }
    if (inDouble) {
      if (char === '\\') i += 1;
      else if (char === '"') inDouble = false;
      continue;
    }
    if (char === "'") inSingle = true;
    else if (char === '"') inDouble = true;
    else if (char === '[' || char === '{') depth += 1;
    else if (char === ']' || char === '}') depth -= 1;
    else if (char === ':' && depth === 0) {
      const next = content[i + 1];
      if (next === undefined || next === ' ') return i;
    }
  }
  return -1;
}

function isBlockScalarHeader(text) {
  return /^[|>][+-]?\d?$/.test(text) || /^[|>]\d?[+-]?$/.test(text);
}

const INDICATORS = /[&*!]|^!!/;

export function parseYaml(text) {
  const source = String(text ?? '');
  if (source.trim() === '') return null;

  const rawLines = source.replace(/\r\n?/g, '\n').split('\n');
  // split 会在文本以换行结尾时多出一个空元素，它不是真实的一行
  if (rawLines.length > 1 && rawLines[rawLines.length - 1] === '') rawLines.pop();
  const lines = rawLines;

  const fail = (message, lineIndex) => {
    const error = new Error(`${message}（第 ${lineIndex + 1} 行）`);
    error.line = lineIndex + 1;
    throw error;
  };

  const isEmpty = (i) => i >= lines.length || stripComment(lines[i]).trim() === '';

  const indentOf = (i) => {
    const line = lines[i];
    const match = /^[ ]*/.exec(line);
    if (/^\t/.test(line.slice(match[0].length))) fail('YAML 不允许用制表符缩进', i);
    return match[0].length;
  };

  let cursor = 0;

  // 跳过文档起始标记
  while (cursor < lines.length && isEmpty(cursor)) cursor += 1;
  if (cursor < lines.length && lines[cursor].trim() === '---') cursor += 1;

  const parseBlock = (startIndex, indent) => {
    let i = startIndex;
    while (isEmpty(i) && i < lines.length) i += 1;
    if (i >= lines.length) return { value: null, next: i };

    const lineIndent = indentOf(i);
    if (lineIndent < indent) return { value: null, next: i };

    const content = stripComment(lines[i].slice(lineIndent)).trim();
    if (content === '?' || content.startsWith('? ')) fail('不支持复杂键（? 语法）', i);
    if (content === '-' || content.startsWith('- ')) return parseSequence(i, lineIndent);
    if (findKeySeparator(content) >= 0) return parseMapping(i, lineIndent);
    if (content === '...') fail('不支持多文档 YAML', i);
    return parseScalarBlock(i);
  };

  const parseMapping = (startIndex, indent) => {
    const result = {};
    let i = startIndex;

    for (;;) {
      while (i < lines.length && isEmpty(i)) i += 1;
      if (i >= lines.length) break;

      const lineIndent = indentOf(i);
      if (lineIndent < indent) break;
      if (lineIndent > indent) fail('缩进不一致', i);

      const content = stripComment(lines[i].slice(lineIndent));
      if (content.trim() === '-' || content.trim().startsWith('- ')) break;

      const separator = findKeySeparator(content);
      if (separator < 0) fail('期望「键: 值」形式', i);

      const rawKey = content.slice(0, separator).trim();
      if (rawKey === '?') fail('不支持复杂键（? 语法）', i);
      const key = parseKeyText(rawKey, i, fail);

      const rest = content.slice(separator + 1).trim();

      if (rest === '') {
        const next = nextSignificant(i + 1);
        if (next < lines.length) {
          const nextIndent = indentOf(next);
          const nextContent = stripComment(lines[next].slice(nextIndent)).trim();
          // 允许无缩进的块序列（key:\n- a\n- b），这是合法且常见的 YAML
          const indentlessSequence = nextIndent === indent && (nextContent === '-' || nextContent.startsWith('- '));
          if (nextIndent > indent || indentlessSequence) {
            const parsed = parseBlock(next, nextIndent);
            result[key] = parsed.value;
            i = parsed.next;
            continue;
          }
        }
        result[key] = null;
        i += 1;
        continue;
      }

      if (isBlockScalarHeader(rest)) {
        const parsed = parseBlockScalar(i, indent, rest);
        result[key] = parsed.value;
        i = parsed.next;
        continue;
      }

      const inline = parseInlineOrFlow(rest, i);
      result[key] = inline.value;
      i = inline.endLine + 1;
    }

    return { value: result, next: i };
  };

  const parseSequence = (startIndex, indent) => {
    const items = [];
    let i = startIndex;

    for (;;) {
      while (i < lines.length && isEmpty(i)) i += 1;
      if (i >= lines.length) break;

      const lineIndent = indentOf(i);
      if (lineIndent < indent) break;
      if (lineIndent > indent) fail('序列项缩进不一致', i);

      const content = stripComment(lines[i].slice(lineIndent));
      const trimmed = content.trim();
      if (trimmed !== '-' && !trimmed.startsWith('- ')) break;

      const rest = trimmed === '-' ? '' : trimmed.slice(2).trim();
      const restColumn = lineIndent + content.length - content.trimStart().length + (trimmed === '-' ? 1 : 2);

      if (rest === '') {
        const next = nextSignificant(i + 1);
        if (next < lines.length && indentOf(next) > lineIndent) {
          const parsed = parseBlock(next, indentOf(next));
          items.push(parsed.value);
          i = parsed.next;
        } else {
          items.push(null);
          i += 1;
        }
        continue;
      }

      if (isBlockScalarHeader(rest)) {
        const parsed = parseBlockScalar(i, lineIndent, rest, restColumn);
        items.push(parsed.value);
        i = parsed.next;
        continue;
      }

      // 序列项本身是映射或嵌套序列：把 "- " 换成等宽空格后按块解析
      if (findKeySeparator(rest) >= 0 || rest === '-' || rest.startsWith('- ')) {
        lines[i] = ' '.repeat(restColumn) + rest;
        const parsed = parseBlock(i, restColumn);
        items.push(parsed.value);
        i = parsed.next;
        continue;
      }

      const inline = parseInlineOrFlow(rest, i);
      items.push(inline.value);
      i = inline.endLine + 1;
    }

    return { value: items, next: i };
  };

  const parseScalarBlock = (startIndex) => {
    // 顶层标量：可能是多行折叠的纯文本
    const parts = [];
    let i = startIndex;
    const indent = indentOf(i);
    while (i < lines.length && !isEmpty(i)) {
      if (indentOf(i) < indent) break;
      parts.push(stripComment(lines[i].slice(indent)).trim());
      i += 1;
    }
    if (parts.length === 1) return { value: resolveScalar(parts[0]), next: i };
    return { value: parts.join(' '), next: i };
  };

  const parseBlockScalar = (headerIndex, parentIndent, header, headerColumn) => {
    const style = header[0];
    const chomping = header.includes('-') ? 'strip' : header.includes('+') ? 'keep' : 'clip';
    const explicitIndent = /\d/.test(header) ? Number(/\d/.exec(header)[0]) : null;

    const collected = [];
    let i = headerIndex + 1;
    let contentIndent = explicitIndent === null ? null : parentIndent + explicitIndent;

    while (i < lines.length) {
      const line = lines[i];
      if (line.trim() === '') {
        collected.push('');
        i += 1;
        continue;
      }
      const lineIndent = indentOf(i);
      if (contentIndent === null) {
        if (lineIndent <= parentIndent) break;
        contentIndent = lineIndent;
      }
      if (lineIndent < contentIndent) break;
      collected.push(line.slice(contentIndent));
      i += 1;
    }

    // 结尾空行的数量决定 keep 模式要保留几个换行
    let trailingBlanks = 0;
    while (collected.length && collected[collected.length - 1].trim() === '') {
      collected.pop();
      trailingBlanks += 1;
    }

    let body;
    if (style === '|') {
      body = collected.join('\n');
    } else {
      const folded = [];
      let previousBlank = false;
      for (const line of collected) {
        if (line === '') {
          folded.push('\n');
          previousBlank = true;
          continue;
        }
        if (folded.length && !previousBlank) folded.push(' ');
        folded.push(line);
        previousBlank = false;
      }
      body = folded.join('');
    }

    let value;
    if (chomping === 'strip') {
      value = body;
    } else if (chomping === 'keep') {
      value = body === '' ? '\n'.repeat(trailingBlanks) : body + '\n'.repeat(trailingBlanks + 1);
    } else {
      value = body === '' ? '' : `${body}\n`;
    }

    void headerColumn;
    return { value, next: i };
  };

  const nextSignificant = (from) => {
    let i = from;
    while (i < lines.length && isEmpty(i)) i += 1;
    return i;
  };

  const parseInlineOrFlow = (text, lineIndex) => {
    const trimmed = text.trim();
    if (INDICATORS.test(trimmed)) {
      if (/^[&*]/.test(trimmed)) fail('不支持锚点（&）与别名（*）', lineIndex);
      if (/^!/.test(trimmed)) fail('不支持标签（!）', lineIndex);
    }
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      const collected = collectFlow(trimmed, lineIndex);
      const parser = new FlowParser(collected.text, lineIndex, fail);
      const value = parser.parseValue();
      parser.skipSpaces();
      if (!parser.atEnd()) fail('流式集合后面有多余内容', lineIndex);
      return { value, endLine: collected.endLine };
    }
    if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
      return { value: parseQuotedScalar(trimmed, lineIndex, fail), endLine: lineIndex };
    }
    return { value: resolveScalar(trimmed), endLine: lineIndex };
  };

  const collectFlow = (firstLine, lineIndex) => {
    let text = firstLine;
    let index = lineIndex;
    while (!isBalanced(text) && index + 1 < lines.length) {
      index += 1;
      text += ` ${stripComment(lines[index]).trim()}`;
    }
    if (!isBalanced(text)) fail('流式集合未闭合', lineIndex);
    return { text, endLine: index };
  };

  function isBalanced(text) {
    let depth = 0;
    let inSingle = false;
    let inDouble = false;
    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      if (inSingle) {
        if (char === "'") inSingle = false;
        continue;
      }
      if (inDouble) {
        if (char === '\\') i += 1;
        else if (char === '"') inDouble = false;
        continue;
      }
      if (char === "'") inSingle = true;
      else if (char === '"') inDouble = true;
      else if (char === '[' || char === '{') depth += 1;
      else if (char === ']' || char === '}') depth -= 1;
    }
    return depth === 0;
  }

  const parsed = parseBlock(cursor, cursor < lines.length ? indentOf(cursor) : 0);
  return parsed.value;
}

function parseKeyText(rawKey, lineIndex, fail) {
  if (rawKey === '') fail('键名不能为空', lineIndex);
  if (/^[&*!]/.test(rawKey)) fail('不支持锚点（&）与别名（*）', lineIndex);
  if (rawKey.startsWith('"') || rawKey.startsWith("'")) return parseQuotedScalar(rawKey, lineIndex, fail);
  return rawKey;
}

export function parseQuotedScalar(text, lineIndex, fail = (message) => {
  throw new Error(message);
}) {
  const quote = text[0];
  if (quote === "'") {
    let out = '';
    for (let i = 1; i < text.length; i += 1) {
      const char = text[i];
      if (char === "'") {
        if (text[i + 1] === "'") {
          out += "'";
          i += 1;
          continue;
        }
        if (i !== text.length - 1) fail('单引号字符串后面有多余内容', lineIndex);
        return out;
      }
      out += char;
    }
    fail('单引号字符串未闭合', lineIndex);
  }

  let out = '';
  for (let i = 1; i < text.length; i += 1) {
    const char = text[i];
    if (char === '\\') {
      const next = text[i + 1];
      i += 1;
      if (next === 'n') out += '\n';
      else if (next === 't') out += '\t';
      else if (next === 'r') out += '\r';
      else if (next === '0') out += '\0';
      else if (next === 'b') out += '\b';
      else if (next === 'f') out += '\f';
      else if (next === 'u') {
        out += String.fromCharCode(Number.parseInt(text.slice(i + 1, i + 5), 16));
        i += 4;
      } else if (next === 'x') {
        out += String.fromCharCode(Number.parseInt(text.slice(i + 1, i + 3), 16));
        i += 2;
      } else out += next;
      continue;
    }
    if (char === '"') {
      if (i !== text.length - 1) fail('双引号字符串后面有多余内容', lineIndex);
      return out;
    }
    out += char;
  }
  fail('双引号字符串未闭合', lineIndex);
  return out;
}

/** 极小的流式集合解析器，处理 [] {} 及其嵌套。 */
class FlowParser {
  constructor(text, lineIndex, fail) {
    this.text = text;
    this.index = 0;
    this.lineIndex = lineIndex;
    this.fail = fail;
  }

  atEnd() {
    return this.index >= this.text.length;
  }

  skipSpaces() {
    while (this.index < this.text.length && /\s/.test(this.text[this.index])) this.index += 1;
  }

  parseValue() {
    this.skipSpaces();
    const char = this.text[this.index];
    if (char === '[') return this.parseArray();
    if (char === '{') return this.parseObject();
    if (char === '"' || char === "'") return this.parseQuoted();
    return this.parsePlain();
  }

  parseQuoted() {
    const quote = this.text[this.index];
    const start = this.index;
    this.index += 1;
    while (this.index < this.text.length) {
      const char = this.text[this.index];
      if (quote === '"' && char === '\\') {
        this.index += 2;
        continue;
      }
      if (char === quote) {
        if (quote === "'" && this.text[this.index + 1] === "'") {
          this.index += 2;
          continue;
        }
        this.index += 1;
        break;
      }
      this.index += 1;
    }
    const raw = this.text.slice(start, this.index);
    return parseQuotedScalar(raw, this.lineIndex, this.fail);
  }

  parsePlain() {
    const start = this.index;
    while (this.index < this.text.length && !/[,}\]]/.test(this.text[this.index])) {
      if (this.text[this.index] === ':' && /[\s,]/.test(this.text[this.index + 1] ?? ',')) break;
      this.index += 1;
    }
    return resolveScalar(this.text.slice(start, this.index).trim());
  }

  parseArray() {
    this.index += 1;
    const items = [];
    for (;;) {
      this.skipSpaces();
      if (this.text[this.index] === ']') {
        this.index += 1;
        return items;
      }
      if (this.atEnd()) this.fail('流式数组未闭合', this.lineIndex);
      items.push(this.parseValue());
      this.skipSpaces();
      if (this.text[this.index] === ',') {
        this.index += 1;
        continue;
      }
      if (this.text[this.index] === ']') {
        this.index += 1;
        return items;
      }
      this.fail('流式数组中缺少 , 或 ]', this.lineIndex);
    }
  }

  parseObject() {
    this.index += 1;
    const result = {};
    for (;;) {
      this.skipSpaces();
      if (this.text[this.index] === '}') {
        this.index += 1;
        return result;
      }
      if (this.atEnd()) this.fail('流式对象未闭合', this.lineIndex);

      let key;
      if (this.text[this.index] === '"' || this.text[this.index] === "'") {
        key = String(this.parseQuoted());
      } else {
        const start = this.index;
        while (this.index < this.text.length && !/[:}\]]/.test(this.text[this.index])) this.index += 1;
        key = this.text.slice(start, this.index).trim();
      }

      this.skipSpaces();
      if (this.text[this.index] !== ':') this.fail('流式对象中缺少 :', this.lineIndex);
      this.index += 1;
      result[key] = this.parseValue();
      this.skipSpaces();
      if (this.text[this.index] === ',') {
        this.index += 1;
        continue;
      }
      if (this.text[this.index] === '}') {
        this.index += 1;
        return result;
      }
      this.fail('流式对象中缺少 , 或 }', this.lineIndex);
    }
  }
}

/* ── 序列化 ───────────────────────────────────────────────── */

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasContent(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (isPlainObject(value)) return Object.keys(value).length > 0;
  return false;
}

export function isPlainSafe(text) {
  const value = String(text);
  if (value === '') return false;
  if (/^\s|\s$/.test(value)) return false;
  if (/[\n\r\t]/.test(value)) return false;
  if (SPECIAL_START.test(value)) return false;
  if (value.includes(': ') || value.includes(' #') || value.endsWith(':')) return false;
  if (/^(true|false|null)$/i.test(value)) return false;
  if (resolveScalar(value) !== value) return false;
  return true;
}

function quoteDouble(text) {
  const escaped = String(text)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
    .replace(/\r/g, '\\r');
  return `"${escaped}"`;
}

function formatScalar(value) {
  if (Array.isArray(value)) return '[]';
  if (isPlainObject(value)) return '{}';
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return '.nan';
    if (value === Infinity) return '.inf';
    if (value === -Infinity) return '-.inf';
    return String(value);
  }
  if (typeof value === 'string') return isPlainSafe(value) ? value : quoteDouble(value);
  return quoteDouble(JSON.stringify(value));
}

function formatKey(key) {
  return isPlainSafe(key) ? key : quoteDouble(key);
}

export function toYaml(value, { indent = 2 } = {}) {
  const step = Math.max(1, Math.floor(indent));
  const lines = [];

  const renderEntry = (key, child, depth) => {
    const pad = ' '.repeat(depth * step);
    const name = formatKey(key);

    if (Array.isArray(child) && !child.length) {
      lines.push(`${pad}${name}: []`);
      return;
    }
    if (isPlainObject(child) && !Object.keys(child).length) {
      lines.push(`${pad}${name}: {}`);
      return;
    }
    if (hasContent(child)) {
      lines.push(`${pad}${name}:`);
      renderValue(child, depth + 1);
      return;
    }
    if (typeof child === 'string' && child.includes('\n')) {
      const trailing = child.endsWith('\n');
      const contentLines = child.replace(/\n$/, '').split('\n');
      // 首个非空行以空格开头时，解析器会把它的缩进误当内容缩进，需要显式指示符
      const firstMeaningful = contentLines.find((line) => line !== '');
      const indicator = firstMeaningful !== undefined && firstMeaningful.startsWith(' ') ? String(step) : '';
      lines.push(`${pad}${name}: |${indicator}${trailing ? '' : '-'}`);
      for (const line of contentLines) {
        lines.push(`${' '.repeat((depth + 1) * step)}${line}`);
      }
      return;
    }
    lines.push(`${pad}${name}: ${formatScalar(child)}`);
  };

  const renderSequenceItem = (item, depth) => {
    const pad = ' '.repeat(depth * step);

    if (Array.isArray(item) && !item.length) {
      lines.push(`${pad}- []`);
      return;
    }
    if (isPlainObject(item) && !Object.keys(item).length) {
      lines.push(`${pad}- {}`);
      return;
    }
    if (hasContent(item)) {
      const sub = [];
      const collect = (v, d) => {
        const saved = lines.length;
        renderValue(v, d);
        sub.push(...lines.splice(saved));
      };
      collect(item, depth + 1);
      lines.push(`${pad}- ${sub[0].slice((depth + 1) * step)}`);
      for (let i = 1; i < sub.length; i += 1) lines.push(sub[i]);
      return;
    }

    if (typeof item === 'string' && item.includes('\n')) {
      const trailing = item.endsWith('\n');
      const contentLines = item.replace(/\n$/, '').split('\n');
      const firstMeaningful = contentLines.find((line) => line !== '');
      const indicator = firstMeaningful !== undefined && firstMeaningful.startsWith(' ') ? String(step) : '';
      lines.push(`${pad}- |${indicator}${trailing ? '' : '-'}`);
      for (const line of contentLines) {
        lines.push(`${' '.repeat((depth + 1) * step)}${line}`);
      }
      return;
    }

    lines.push(`${pad}- ${formatScalar(item)}`);
  };

  const renderValue = (target, depth) => {
    const pad = ' '.repeat(depth * step);

    if (Array.isArray(target)) {
      if (!target.length) {
        lines.push(`${pad}[]`);
        return;
      }
      for (const item of target) renderSequenceItem(item, depth);
      return;
    }

    if (isPlainObject(target)) {
      const entries = Object.entries(target);
      if (!entries.length) {
        lines.push(`${pad}{}`);
        return;
      }
      for (const [key, child] of entries) renderEntry(key, child, depth);
      return;
    }

    lines.push(`${pad}${formatScalar(target)}`);
  };

  renderValue(value, 0);
  return `${lines.join('\n')}\n`;
}
