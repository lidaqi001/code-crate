/* 格式转换 —— 纯逻辑层（公共入口）。
 * 所有格式先解析成普通 JS 值，再序列化成目标格式，因此任意两种格式都能互转。
 *
 * 各格式的边界（界面上也会提示）：
 *   YAML  只支持常用子集；锚点/别名/标签/多文档/复杂键会明确报错
 *   TOML  日期时间以字符串返回；null 无法表示，序列化时会报错并指出位置
 *   XML   文本保持字符串（不猜类型）；属性写成 @name，文本写在 #text
 *   CSV   以「对象数组」为模型，对象数组 ⇄ 表头 + 行
 */

import { parseYaml, toYaml } from './yaml.js';
import { parseToml, toToml } from './toml.js';
import { parseXmlToValue, toXml } from './xml.js';
import { parseCsv, toCsv, detectDelimiter } from './csv.js';

export const FORMATS = [
  { id: 'json', label: 'JSON', extension: 'json' },
  { id: 'yaml', label: 'YAML', extension: 'yaml' },
  { id: 'toml', label: 'TOML', extension: 'toml' },
  { id: 'xml', label: 'XML', extension: 'xml' },
  { id: 'csv', label: 'CSV', extension: 'csv' },
  { id: 'tsv', label: 'TSV', extension: 'tsv' }
];

export const FORMAT_HINTS = {
  json: '标准 JSON，不支持注释与尾随逗号',
  yaml: '支持常用子集；锚点、别名、多文档会明确报错',
  toml: '日期时间按字符串处理；null 无法表示',
  xml: '文本保持字符串；属性 → @name，文本 → #text',
  csv: '以对象数组为模型，首行是表头',
  tsv: '与 CSV 相同，分隔符为制表符'
};

export function formatById(id) {
  return FORMATS.find((format) => format.id === id) || null;
}

/* ── JSON（额外拒绝 Infinity / NaN） ──────────────────────── */

function toJsonStrict(value, indent) {
  if (value === undefined) return 'null';
  const result = JSON.stringify(
    value,
    (key, current) => {
      if (typeof current === 'number' && !Number.isFinite(current)) {
        throw new Error(`${current} 无法用 JSON 表示（JSON 没有 Infinity 与 NaN）`);
      }
      return current;
    },
    Number(indent) > 0 ? Number(indent) : 0
  );
  return result === undefined ? 'null' : result;
}

/* ── 格式识别 ─────────────────────────────────────────────── */

/** 根据内容猜格式，用于「自动识别」。 */
export function detectFormat(text) {
  const source = String(text ?? '').trim();
  if (!source) return 'json';

  // XML：以 < 开头，或带声明
  if (/^<\?xml/i.test(source) || /^<[A-Za-z_:]/.test(source)) return 'xml';

  // JSON：能被 JSON.parse 接受
  if (/^[[{]/.test(source)) {
    try {
      JSON.parse(source);
      return 'json';
    } catch {
      /* 继续尝试其他格式 */
    }
  }

  const lines = source.split(/\r\n?|\n/);
  const significant = lines.filter((line) => line.trim() !== '' && !line.trim().startsWith('#'));

  // TOML：表头或 key = value
  const tomlTable = significant.filter((line) => /^\s*\[\[?.+\]\]?\s*$/.test(line)).length;
  const tomlAssign = significant.filter((line) => /^\s*[A-Za-z0-9_"'.-]+\s*=\s*\S/.test(line)).length;
  if (tomlTable > 0 || (tomlAssign > 0 && tomlAssign >= significant.length * 0.6)) return 'toml';

  // YAML：列表项或键值对
  const yamlList = significant.filter((line) => /^\s*-\s/.test(line) || line.trim() === '-').length;
  const yamlKey = significant.filter((line) => /^\s*[^:#\s][^:]*:(\s|$)/.test(line)).length;
  if (yamlList > 0 || yamlKey > 0) return 'yaml';

  // CSV / TSV
  const delimiter = detectDelimiter(source);
  const counts = significant.slice(0, 5).map((line) => line.split(delimiter).length);
  if (counts.length && counts[0] > 1 && counts.every((count) => count === counts[0])) {
    return delimiter === '\t' ? 'tsv' : 'csv';
  }

  return 'yaml';
}

/* ── 解析 / 序列化 ────────────────────────────────────────── */

export function parse(text, format, { delimiter } = {}) {
  switch (format) {
    case 'json': {
      const source = String(text ?? '').trim();
      if (source === '') return null;
      return JSON.parse(source);
    }
    case 'yaml':
      return parseYaml(text);
    case 'toml':
      return parseToml(text);
    case 'xml':
      return parseXmlToValue(text);
    case 'csv':
      return parseCsv(text, { delimiter: delimiter && delimiter !== 'auto' ? delimiter : detectDelimiter(text) });
    case 'tsv':
      return parseCsv(text, { delimiter: '\t' });
    default:
      throw new Error(`未知的源格式：${format}`);
  }
}

export function serialize(value, format, options = {}) {
  const { indent = 2, rootName = 'root', delimiter = ',', declaration = false } = options;

  switch (format) {
    case 'json':
      return toJsonStrict(value, indent);
    case 'yaml':
      return toYaml(value, { indent });
    case 'toml':
      return toToml(value);
    case 'xml': {
      if (value === null || value === undefined) {
        return toXml({ [rootName]: null }, { rootName, indent, declaration });
      }
      if (Array.isArray(value)) {
        return toXml({ [rootName]: value }, { rootName, indent, declaration });
      }
      if (typeof value !== 'object') {
        return toXml({ [rootName]: value }, { rootName, indent, declaration });
      }
      return toXml(value, { rootName, indent, declaration });
    }
    case 'csv':
      return toCsv(value, { delimiter });
    case 'tsv':
      return toCsv(value, { delimiter: '\t' });
    default:
      throw new Error(`未知的目标格式：${format}`);
  }
}

/**
 * 一次转换。
 * @returns {{ok:true, output:string}|{ok:false, error:string}}
 */
export function convert(text, from, to, options = {}) {
  const source = String(text ?? '');
  if (source.trim() === '') return { ok: false, error: '输入为空' };

  // 刻意不做「同格式直接返回原文」的捷径：
  // 选择 JSON → JSON 通常就是想换缩进重新格式化，直接返回会让选项失效。
  // 源格式为 CSV 且开启自动识别时，分隔符以内容探测为准；
  // options.delimiter 继续用于目标为 CSV 的序列化。
  const parseOptions = { ...options };
  if (from === 'csv' && options.autoDetect !== false) delete parseOptions.delimiter;

  let value;
  try {
    value = parse(source, from, parseOptions);
  } catch (error) {
    return { ok: false, error: `解析 ${formatById(from)?.label ?? from} 失败：${error.message}` };
  }

  try {
    return { ok: true, output: serialize(value, to, options) };
  } catch (error) {
    return { ok: false, error: `生成 ${formatById(to)?.label ?? to} 失败：${error.message}` };
  }
}

/** 供界面展示：文本的规模统计。 */
export function describe(text) {
  const source = String(text ?? '');
  const lines = source === '' ? 0 : source.split(/\r\n?|\n/).length;
  return { lines, characters: [...source].length };
}
