/* JSON 工具的纯逻辑层 —— 不触碰 DOM，可直接在 Node 下测试。
   包含：解析诊断、格式化、深度排序、统计、JSONPath 子集、TypeScript / JSON Schema 生成。 */

/* ── 解析与诊断 ───────────────────────────────────────────── */

const JSON_SCAN_FAIL = Symbol('json-scan-fail');

/**
 * 轻量 JSON 扫描器：只在 V8 没给出位置信息时启用，用于补全出错位置。
 * 不负责构造值，只负责找到第一个语法错误的下标。
 */
function locateJsonError(text) {
  let i = 0;
  const n = text.length;
  let message = null;
  let position = null;

  const bail = (msg, at) => {
    message = msg;
    position = at === undefined ? i : at;
    throw JSON_SCAN_FAIL;
  };

  const skipWs = () => {
    while (i < n && (text[i] === ' ' || text[i] === '\t' || text[i] === '\n' || text[i] === '\r')) i += 1;
  };

  const parseString = () => {
    i += 1;
    while (i < n) {
      const ch = text[i];
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === '"') {
        i += 1;
        return;
      }
      if (ch === '\n') bail('字符串中不能直接换行', i);
      i += 1;
    }
    bail('字符串缺少结束引号');
  };

  const parseNumber = () => {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(i));
    if (!match || !match[0]) bail('数字格式不正确');
    i += match[0].length;
  };

  const parseObject = () => {
    i += 1;
    skipWs();
    if (text[i] === '}') {
      i += 1;
      return;
    }
    for (;;) {
      skipWs();
      if (i >= n) bail('对象未闭合');
      if (text[i] !== '"') bail('属性名必须是双引号字符串');
      parseString();
      skipWs();
      if (text[i] !== ':') bail("属性名后缺少 ':'");
      i += 1;
      parseValue();
      skipWs();
      if (text[i] === ',') {
        i += 1;
        continue;
      }
      if (text[i] === '}') {
        i += 1;
        return;
      }
      if (i >= n) bail('对象未闭合');
      bail("对象中缺少 ',' 或 '}'");
    }
  };

  const parseArray = () => {
    i += 1;
    skipWs();
    if (text[i] === ']') {
      i += 1;
      return;
    }
    for (;;) {
      parseValue();
      skipWs();
      if (text[i] === ',') {
        i += 1;
        continue;
      }
      if (text[i] === ']') {
        i += 1;
        return;
      }
      if (i >= n) bail('数组未闭合');
      bail("数组中缺少 ',' 或 ']'");
    }
  };

  function parseValue() {
    skipWs();
    if (i >= n) bail('意外的输入结束');
    const ch = text[i];
    if (ch === '{') return parseObject();
    if (ch === '[') return parseArray();
    if (ch === '"') return parseString();
    if (ch === '-' || (ch >= '0' && ch <= '9')) return parseNumber();
    if (text.startsWith('true', i)) {
      i += 4;
      return undefined;
    }
    if (text.startsWith('false', i)) {
      i += 5;
      return undefined;
    }
    if (text.startsWith('null', i)) {
      i += 4;
      return undefined;
    }
    return bail(`意外的字符 ${JSON.stringify(ch)}`);
  }

  try {
    parseValue();
    skipWs();
    if (i < n) bail('结尾存在多余内容');
    return null;
  } catch (error) {
    if (error !== JSON_SCAN_FAIL) throw error;
    return { message, position };
  }
}

function offsetToLineColumn(text, position) {
  let line = 1;
  let column = 1;
  for (let i = 0; i < position && i < text.length; i += 1) {
    if (text[i] === '\n') {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
}

/**
 * 把 JSON.parse 的报错转换成带行列号的诊断信息。
 * 新版 V8 对部分错误不再提供位置，此时用内置扫描器补全。
 */
export function describeParseError(text, error) {
  const raw = String((error && error.message) || error);
  const native = /position (\d+)/.exec(raw);
  const scanned = native ? null : locateJsonError(String(text));

  const position = native ? Number(native[1]) : scanned ? scanned.position : null;
  const message = native
    ? raw.replace(/\s*\(line \d+ column \d+\)\s*$/, '').replace(/^JSON\.parse: /, '')
    : scanned
      ? scanned.message
      : raw;

  const base = { message, position, line: null, column: null };
  if (position === null || position === undefined) return base;
  return { ...base, ...offsetToLineColumn(String(text), position) };
}

/** @returns {{ok:true, value:any}|{ok:false, error:{message:string,line:number|null,column:number|null}}} */
export function parseJson(text) {
  if (!String(text || '').trim()) return { ok: false, error: { message: '内容为空', line: null, column: null } };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    return { ok: false, error: describeParseError(text, error) };
  }
}

const INDENTS = { 2: '  ', 4: '    ', tab: '\t' };

export function indentUnit(indent) {
  if (indent === 'tab') return '\t';
  if (typeof indent === 'string') return indent;
  return INDENTS[indent] ?? INDENTS[2];
}

/** 把解析失败转换成带位置信息的异常，供 UI 定位。 */
function throwParseError(parsed) {
  const error = new Error(parsed.error.message);
  error.line = parsed.error.line;
  error.column = parsed.error.column;
  error.position = parsed.error.position;
  throw error;
}

/** 格式化；非法输入抛出带行列号的错误。 */
export function formatJson(text, indent = 2) {
  const parsed = parseJson(text);
  if (!parsed.ok) throwParseError(parsed);
  return JSON.stringify(parsed.value, null, indentUnit(indent));
}

export function minifyJson(text) {
  const parsed = parseJson(text);
  if (!parsed.ok) throwParseError(parsed);
  return JSON.stringify(parsed.value);
}

/** 递归按键名排序，数组顺序保持不变。 */
export function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort((a, b) => a.localeCompare(b))) {
      out[key] = sortKeysDeep(value[key]);
    }
    return out;
  }
  return value;
}

export function formatSorted(text, indent = 2) {
  const parsed = parseJson(text);
  if (!parsed.ok) throwParseError(parsed);
  return JSON.stringify(sortKeysDeep(parsed.value), null, indentUnit(indent));
}

/** 把文本转义成 JSON 字符串字面量（含首尾引号）。 */
export function escapeJsonString(text) {
  return JSON.stringify(String(text));
}

/** 去掉 JSON 字符串字面量的引号并还原转义；非法时抛出。 */
export function unescapeJsonString(text) {
  const trimmed = String(text).trim();
  const candidate = /^".*"$/s.test(trimmed) ? trimmed : JSON.stringify(trimmed);
  const parsed = JSON.parse(candidate);
  if (typeof parsed !== 'string') throw new Error('不是字符串字面量');
  return parsed;
}

/* ── 统计 ─────────────────────────────────────────────────── */

export function jsonStats(value) {
  const stats = { nodes: 0, objects: 0, arrays: 0, strings: 0, numbers: 0, booleans: 0, nulls: 0, depth: 0, keys: 0 };

  const walk = (node, depth) => {
    stats.nodes += 1;
    stats.depth = Math.max(stats.depth, depth);
    if (node === null) {
      stats.nulls += 1;
      return;
    }
    if (Array.isArray(node)) {
      stats.arrays += 1;
      for (const item of node) walk(item, depth + 1);
      return;
    }
    if (typeof node === 'object') {
      stats.objects += 1;
      const keys = Object.keys(node);
      stats.keys += keys.length;
      for (const key of keys) walk(node[key], depth + 1);
      return;
    }
    if (typeof node === 'string') stats.strings += 1;
    else if (typeof node === 'number') stats.numbers += 1;
    else if (typeof node === 'boolean') stats.booleans += 1;
  };

  walk(value, 1);
  return stats;
}

/* ── JSONPath 子集 ────────────────────────────────────────── */
/* 支持：$ .key ['key'] [n] [*] .* ..key ..* [a,b] [start:end] */

function parsePath(path) {
  const steps = [];
  const src = String(path || '').trim() || '$';
  let i = src.startsWith('$') ? 1 : 0;

  const readName = () => {
    const match = /^[^.\[\]]+/.exec(src.slice(i));
    if (!match) throw new Error('路径缺少属性名');
    i += match[0].length;
    return match[0];
  };

  while (i < src.length) {
    const ch = src[i];
    if (ch === '.') {
      if (src[i + 1] === '.') {
        i += 2;
        if (src[i] === '*') {
          steps.push({ type: 'recursiveAll' });
          i += 1;
        } else if (src[i] === '[') {
          throw new Error('暂不支持 ..[ 写法，请用 ..key 或 ..*');
        } else {
          steps.push({ type: 'recursiveKey', name: readName() });
        }
      } else {
        i += 1;
        if (src[i] === '*') {
          steps.push({ type: 'wildcard' });
          i += 1;
        } else {
          steps.push({ type: 'key', name: readName() });
        }
      }
      continue;
    }

    if (ch === '[') {
      const end = src.indexOf(']', i);
      if (end < 0) throw new Error('缺少 ]');
      const inner = src.slice(i + 1, end).trim();
      i = end + 1;

      if (inner === '*') {
        steps.push({ type: 'wildcard' });
      } else if (/^-?\d+$/.test(inner)) {
        steps.push({ type: 'index', index: Number(inner) });
      } else if (inner.includes(':')) {
        const [rawStart, rawEnd, rawStep] = inner.split(':').map((part) => part.trim());
        steps.push({
          type: 'slice',
          start: rawStart === '' ? null : Number(rawStart),
          end: rawEnd === '' || rawEnd === undefined ? null : Number(rawEnd),
          step: rawStep === undefined || rawStep === '' ? 1 : Number(rawStep)
        });
      } else if (inner.includes(',')) {
        const parts = inner.split(',').map((part) => part.trim().replace(/^['"]|['"]$/g, ''));
        steps.push({ type: 'union', parts: parts.map((part) => (/^-?\d+$/.test(part) ? Number(part) : part)) });
      } else {
        steps.push({ type: 'key', name: inner.replace(/^['"]|['"]$/g, '') });
      }
      continue;
    }

    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    steps.push({ type: 'key', name: readName() });
  }

  return steps;
}

function joinPath(base, key, isIndex = false) {
  return isIndex ? `${base}[${key}]` : `${base}.${key}`;
}

function allNodes(value, base, out) {
  out.push({ path: base, value });
  if (Array.isArray(value)) {
    value.forEach((item, index) => allNodes(item, `${base}[${index}]`, out));
  } else if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) allNodes(value[key], joinPath(base, key), out);
  }
  return out;
}

function applyStep(nodes, step) {
  const out = [];
  for (const node of nodes) {
    const { value, path } = node;

    switch (step.type) {
      case 'key': {
        if (value && typeof value === 'object' && !Array.isArray(value) && step.name in value) {
          out.push({ path: joinPath(path, step.name), value: value[step.name] });
        }
        break;
      }
      case 'index': {
        if (Array.isArray(value)) {
          const index = step.index < 0 ? value.length + step.index : step.index;
          if (index >= 0 && index < value.length) {
            out.push({ path: `${path}[${index}]`, value: value[index] });
          }
        }
        break;
      }
      case 'wildcard': {
        if (Array.isArray(value)) {
          value.forEach((item, index) => out.push({ path: `${path}[${index}]`, value: item }));
        } else if (value && typeof value === 'object') {
          for (const key of Object.keys(value)) out.push({ path: joinPath(path, key), value: value[key] });
        }
        break;
      }
      case 'slice': {
        if (Array.isArray(value)) {
          const stepSize = step.step || 1;
          const start = step.start === null ? (stepSize > 0 ? 0 : value.length - 1) : step.start;
          const end = step.end === null ? (stepSize > 0 ? value.length : -1) : step.end;
          const norm = (n) => (n < 0 ? value.length + n : n);
          const from = norm(start);
          const to = norm(end);
          if (stepSize > 0) {
            for (let k = from; k < to; k += stepSize) {
              if (k >= 0 && k < value.length) out.push({ path: `${path}[${k}]`, value: value[k] });
            }
          } else {
            for (let k = from; k > to; k += stepSize) {
              if (k >= 0 && k < value.length) out.push({ path: `${path}[${k}]`, value: value[k] });
            }
          }
        }
        break;
      }
      case 'union': {
        for (const part of step.parts) {
          if (typeof part === 'number') {
            if (Array.isArray(value)) {
              const index = part < 0 ? value.length + part : part;
              if (index >= 0 && index < value.length) out.push({ path: `${path}[${index}]`, value: value[index] });
            }
          } else if (value && typeof value === 'object' && !Array.isArray(value) && part in value) {
            out.push({ path: joinPath(path, part), value: value[part] });
          }
        }
        break;
      }
      case 'recursiveKey': {
        for (const candidate of allNodes(value, path, [])) {
          const target = candidate.value;
          if (target && typeof target === 'object' && !Array.isArray(target) && step.name in target) {
            out.push({ path: joinPath(candidate.path, step.name), value: target[step.name] });
          }
        }
        break;
      }
      case 'recursiveAll': {
        const collected = allNodes(value, path, []);
        for (const candidate of collected) {
          if (candidate.path !== path) out.push(candidate);
        }
        break;
      }
      default:
        break;
    }
  }
  return out;
}

/**
 * 执行 JSONPath 查询。
 * @returns {{ok:true, matches:Array<{path:string,value:any}>}|{ok:false, error:string}}
 */
export function queryJsonPath(root, path) {
  let steps;
  try {
    steps = parsePath(path);
  } catch (error) {
    return { ok: false, error: error.message };
  }

  let nodes = [{ path: '$', value: root }];
  for (const step of steps) {
    nodes = applyStep(nodes, step);
    if (!nodes.length) break;
  }
  return { ok: true, matches: nodes };
}

/* ── TypeScript 生成 ──────────────────────────────────────── */

const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function pascalCase(name, fallback = 'Value') {
  const words = String(name)
    .replace(/[^A-Za-z0-9_$]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const joined = words.map((word) => word[0].toUpperCase() + word.slice(1)).join('');
  const out = joined || fallback;
  return /^[0-9]/.test(out) ? `T${out}` : out;
}

function singular(name) {
  const str = String(name);
  if (/ies$/i.test(str) && str.length > 3) return str.replace(/ies$/i, 'y');
  if (/ss$/i.test(str)) return str;
  if (/s$/i.test(str) && str.length > 1) return str.slice(0, -1);
  return `${str}Item`;
}

function keyLiteral(key) {
  return IDENT_RE.test(key) ? key : JSON.stringify(key);
}

function createTsContext() {
  return { blocks: [], bySignature: new Map(), used: new Set() };
}

function uniqueTypeName(ctx, base, signature) {
  if (ctx.bySignature.has(signature)) return ctx.bySignature.get(signature);
  let name = base;
  let counter = 2;
  while (ctx.used.has(name)) {
    name = `${base}${counter}`;
    counter += 1;
  }
  ctx.used.add(name);
  ctx.bySignature.set(signature, name);
  return name;
}

function inferPrimitive(value) {
  if (value === null) return 'null';
  const type = typeof value;
  if (type === 'number' || type === 'string' || type === 'boolean') return type;
  if (type === 'undefined') return 'undefined';
  return null;
}

/** 由一组对象值合成一个接口，键在部分元素中缺失时标记为可选。 */
function inferObjectType(values, ctx, hint) {
  const keys = [];
  const seen = new Set();
  for (const value of values) {
    for (const key of Object.keys(value)) {
      if (!seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    }
  }

  const props = [];
  for (const key of keys) {
    const present = values.filter((value) => Object.prototype.hasOwnProperty.call(value, key));
    const types = [];
    for (const value of present) {
      const type = inferType(value[key], ctx, key);
      if (!types.includes(type)) types.push(type);
    }
    props.push({
      key,
      optional: present.length !== values.length,
      type: types.length ? types.join(' | ') : 'unknown'
    });
  }

  const signature = JSON.stringify(props.map((p) => [p.key, p.type, p.optional]));

  // 结构完全相同的对象复用同一接口，且不重复输出定义
  if (ctx.bySignature.has(signature)) return ctx.bySignature.get(signature);

  const name = uniqueTypeName(ctx, pascalCase(hint, 'Item'), signature);
  const body = props
    .map((prop) => `  ${keyLiteral(prop.key)}${prop.optional ? '?' : ''}: ${prop.type};`)
    .join('\n');
  ctx.blocks.push(`export interface ${name} {\n${body}\n}`);
  return name;
}

function inferArrayType(value, ctx, hint) {
  if (!value.length) return 'unknown[]';

  const allObjects = value.every((item) => item && typeof item === 'object' && !Array.isArray(item));
  if (allObjects) return `${inferObjectType(value, ctx, singular(hint))}[]`;

  const types = [];
  for (const item of value) {
    const type = inferType(item, ctx, singular(hint));
    if (!types.includes(type)) types.push(type);
  }
  if (types.length === 1) return `${types[0]}[]`;
  const needsParens = types.some((type) => type.includes(' | ') || type.endsWith('[]'));
  return needsParens ? `(${types.join(' | ')})[]` : `${types.join(' | ')}[]`;
}

function inferType(value, ctx, hint) {
  const primitive = inferPrimitive(value);
  if (primitive) return primitive;
  if (Array.isArray(value)) return inferArrayType(value, ctx, hint);
  if (typeof value === 'object') return inferObjectType([value], ctx, hint);
  return 'unknown';
}

/**
 * 生成 TypeScript 接口定义。
 * @returns {{ok:true, code:string}|{ok:false, error:string}}
 */
export function toTypeScript(value, rootName = 'Root') {
  const ctx = createTsContext();
  const name = pascalCase(rootName, 'Root');
  try {
    const rootType = inferType(value, ctx, name);
    const header = ctx.blocks.join('\n\n');
    const alias = rootType === name ? '' : `\nexport type ${name} = ${rootType};\n`;
    return { ok: true, code: `${header}${alias}`.trim() };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

/* ── JSON Schema 生成 ─────────────────────────────────────── */

function schemaFor(value) {
  if (value === null) return { type: 'null' };
  if (Array.isArray(value)) {
    if (!value.length) return { type: 'array', items: {} };
    return { type: 'array', items: mergeSchemas(value.map(schemaFor)) };
  }
  if (typeof value === 'object') {
    const properties = {};
    const required = [];
    for (const key of Object.keys(value)) {
      properties[key] = schemaFor(value[key]);
      required.push(key);
    }
    return { type: 'object', properties, required, additionalProperties: false };
  }
  if (typeof value === 'number') return Number.isInteger(value) ? { type: 'integer' } : { type: 'number' };
  if (typeof value === 'string') return { type: 'string' };
  if (typeof value === 'boolean') return { type: 'boolean' };
  return {};
}

function mergeSchemas(schemas) {
  if (schemas.length === 1) return schemas[0];
  const types = [...new Set(schemas.map((schema) => schema.type))];

  if (types.length === 1 && types[0] === 'object') {
    const keys = [...new Set(schemas.flatMap((schema) => Object.keys(schema.properties || {})))];
    const properties = {};
    const required = [];
    for (const key of keys) {
      const present = schemas.filter((schema) => schema.properties && key in schema.properties);
      properties[key] = mergeSchemas(present.map((schema) => schema.properties[key]));
      if (present.length === schemas.length) required.push(key);
    }
    return { type: 'object', properties, required, additionalProperties: false };
  }

  if (types.length === 1) return { type: types[0] };

  // 整数与数字混合时退化为 number
  if (types.every((type) => type === 'integer' || type === 'number')) return { type: 'number' };

  return { anyOf: schemas.filter((schema, index) => schemas.findIndex((s) => JSON.stringify(s) === JSON.stringify(schema)) === index) };
}

/**
 * 生成 JSON Schema（2020-12）。
 * @returns {{ok:true, code:string}|{ok:false, error:string}}
 */
export function toJsonSchema(value, title = 'Root') {
  try {
    const schema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      title: String(title || 'Root'),
      ...schemaFor(value)
    };
    return { ok: true, code: JSON.stringify(schema, null, 2) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

/* ── 导出 HTML 预览所需的类型着色（供 ui 层使用） ──────────── */

export function valueKind(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  const type = typeof value;
  if (type === 'object') return 'object';
  if (type === 'number') return 'number';
  if (type === 'boolean') return 'boolean';
  if (type === 'string') return 'string';
  return 'unknown';
}
