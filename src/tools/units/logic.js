/* 进制转换、位运算与单位换算 —— 纯逻辑层。
 *
 * 进制转换使用 BigInt，因此任意精度都精确（64 位整数、内存地址都不丢位）。
 * 只支持整数：小数在不同进制间无法用二进制浮点精确表示，与其给出有误差的结果，
 * 不如明确报错让用户自己决定精度。
 */

const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';

export const MIN_BASE = 2;
export const MAX_BASE = 36;

export const COMMON_BASES = [
  { base: 2, label: '二进制', prefix: '0b' },
  { base: 8, label: '八进制', prefix: '0o' },
  { base: 10, label: '十进制', prefix: '' },
  { base: 16, label: '十六进制', prefix: '0x' },
  { base: 32, label: 'Base32', prefix: '' },
  { base: 36, label: 'Base36', prefix: '' }
];

export function normalizeBase(base) {
  const value = Number(base);
  if (!Number.isInteger(value) || value < MIN_BASE || value > MAX_BASE) {
    throw new Error(`进制需要在 ${MIN_BASE}-${MAX_BASE} 之间`);
  }
  return value;
}

/** 解析指定进制的整数字符串（支持符号、空格分隔、0x/0o/0b 前缀）。 */
export function parseInBase(text, base) {
  const radix = normalizeBase(base);
  let source = String(text ?? '').trim().replace(/[\s_]/g, '');
  if (source === '') throw new Error('输入为空');

  let negative = false;
  if (source[0] === '+') source = source.slice(1);
  else if (source[0] === '-') {
    negative = true;
    source = source.slice(1);
  }

  const lower = source.toLowerCase();
  if (radix === 16 && lower.startsWith('0x')) source = source.slice(2);
  else if (radix === 8 && lower.startsWith('0o')) source = source.slice(2);
  else if (radix === 2 && lower.startsWith('0b')) source = source.slice(2);

  if (source === '') throw new Error('去掉符号或前缀后没有数字');
  if (source.includes('.')) throw new Error('目前只支持整数，小数无法在进制间精确转换');

  let value = 0n;
  const size = BigInt(radix);
  for (const char of source.toLowerCase()) {
    const digit = DIGITS.indexOf(char);
    if (digit < 0 || digit >= radix) {
      throw new Error(`「${char}」不是 ${radix} 进制中的合法数字`);
    }
    value = value * size + BigInt(digit);
  }

  return negative ? -value : value;
}

function groupDigits(text, size, separator = ' ') {
  if (size <= 0) return text;
  const parts = [];
  for (let end = text.length; end > 0; end -= size) {
    parts.unshift(text.slice(Math.max(0, end - size), end));
  }
  return parts.join(separator);
}

/** 把整数格式化成指定进制。 */
export function formatInBase(value, base, { upper = false, group = 0, prefix = false } = {}) {
  const radix = normalizeBase(base);
  const big = typeof value === 'bigint' ? value : BigInt(value);
  const negative = big < 0n;
  let rest = negative ? -big : big;
  const size = BigInt(radix);

  let out = '';
  if (rest === 0n) {
    out = '0';
  } else {
    while (rest > 0n) {
      out = DIGITS[Number(rest % size)] + out;
      rest /= size;
    }
  }

  if (upper) out = out.toUpperCase();
  if (group > 0) out = groupDigits(out, group);

  const prefixText = prefix
    ? radix === 16 ? '0x' : radix === 8 ? '0o' : radix === 2 ? '0b' : ''
    : '';

  return `${negative ? '-' : ''}${prefixText}${out}`;
}

/** 一次算出所有常用进制的表示。 */
export function convertToAllBases(value) {
  const big = typeof value === 'bigint' ? value : BigInt(value);
  return COMMON_BASES.map((entry) => ({
    base: entry.base,
    label: entry.label,
    text: formatInBase(big, entry.base, { upper: entry.base === 16, prefix: entry.base === 16 || entry.base === 8 || entry.base === 2 })
  }));
}

export function convertBase(text, fromBase, toBase) {
  const value = parseInBase(text, fromBase);
  return formatInBase(value, toBase);
}

/** 整数的规模信息：位数、字节数、置位个数。 */
export function describeInteger(value) {
  const big = typeof value === 'bigint' ? value : BigInt(value);
  const absolute = big < 0n ? -big : big;
  if (absolute === 0n) return { bits: 1, bytes: 1, ones: 0, isNegative: big < 0n };

  const binary = absolute.toString(2);
  let ones = 0;
  for (const char of binary) if (char === '1') ones += 1;

  return {
    bits: binary.length,
    bytes: Math.ceil(binary.length / 8),
    ones,
    isNegative: big < 0n
  };
}

/** 按字节翻转（大小端互换）。 */
export function swapEndianness(value, byteWidth = 0) {
  const big = typeof value === 'bigint' ? value : BigInt(value);
  if (big < 0n) throw new Error('暂不支持负数的大小端翻转');

  const bytes = byteWidth > 0
    ? byteWidth
    : Math.max(1, Math.ceil(big.toString(2).length / 8));

  let result = 0n;
  for (let i = 0; i < bytes; i += 1) {
    result = (result << 8n) | ((big >> BigInt(i * 8)) & 0xffn);
  }
  return result;
}

/* ── 位运算 ───────────────────────────────────────────────── */

export const BIT_OPERATIONS = [
  { id: 'and', label: '与 AND', symbol: 'a & b', binary: true },
  { id: 'or', label: '或 OR', symbol: 'a | b', binary: true },
  { id: 'xor', label: '异或 XOR', symbol: 'a ^ b', binary: true },
  { id: 'shl', label: '左移', symbol: 'a << b', binary: true },
  { id: 'shr', label: '右移', symbol: 'a >> b', binary: true },
  { id: 'not', label: '取反 NOT（按位宽）', symbol: '~a', binary: false }
];

/**
 * 执行位运算。取反需要一个位宽（默认 32），否则「取反」在无限精度下没有意义。
 */
export function applyBitOperation(id, a, b = 0n, { width = 32 } = {}) {
  const left = typeof a === 'bigint' ? a : BigInt(a);
  const right = typeof b === 'bigint' ? b : BigInt(b);

  switch (id) {
    case 'and':
      return left & right;
    case 'or':
      return left | right;
    case 'xor':
      return left ^ right;
    case 'shl':
    case 'shr': {
      if (right < 0n) throw new Error('移位次数不能为负');
      if (right > 1024n) throw new Error('移位次数过大');
      return id === 'shl' ? left << right : left >> right;
    }
    case 'not': {
      if (!Number.isInteger(width) || width < 1 || width > 1024) {
        throw new Error('位宽需要在 1-1024 之间');
      }
      const mask = (1n << BigInt(width)) - 1n;
      return (~left) & mask;
    }
    default:
      throw new Error(`未知的位运算：${id}`);
  }
}

/* ── 单位换算 ─────────────────────────────────────────────── */

/** 除温度外，每个单位给出相对基准单位的倍率。 */
export const UNIT_CATEGORIES = [
  {
    id: 'data',
    label: '数据存储',
    units: [
      { id: 'bit', label: 'bit', factor: 1 / 8 },
      { id: 'byte', label: 'B', factor: 1 },
      { id: 'kb', label: 'KB（1000）', factor: 1000 },
      { id: 'mb', label: 'MB（1000²）', factor: 1000 ** 2 },
      { id: 'gb', label: 'GB（1000³）', factor: 1000 ** 3 },
      { id: 'tb', label: 'TB（1000⁴）', factor: 1000 ** 4 },
      { id: 'kib', label: 'KiB（1024）', factor: 1024 },
      { id: 'mib', label: 'MiB（1024²）', factor: 1024 ** 2 },
      { id: 'gib', label: 'GiB（1024³）', factor: 1024 ** 3 },
      { id: 'tib', label: 'TiB（1024⁴）', factor: 1024 ** 4 }
    ]
  },
  {
    id: 'time',
    label: '时间',
    units: [
      { id: 'ns', label: '纳秒', factor: 1e-9 },
      { id: 'us', label: '微秒', factor: 1e-6 },
      { id: 'ms', label: '毫秒', factor: 1e-3 },
      { id: 's', label: '秒', factor: 1 },
      { id: 'min', label: '分钟', factor: 60 },
      { id: 'hour', label: '小时', factor: 3600 },
      { id: 'day', label: '天', factor: 86400 },
      { id: 'week', label: '周', factor: 604800 }
    ]
  },
  {
    id: 'length',
    label: '长度',
    units: [
      { id: 'nm', label: '纳米', factor: 1e-9 },
      { id: 'um', label: '微米', factor: 1e-6 },
      { id: 'mm', label: '毫米', factor: 1e-3 },
      { id: 'cm', label: '厘米', factor: 1e-2 },
      { id: 'm', label: '米', factor: 1 },
      { id: 'km', label: '千米', factor: 1000 },
      { id: 'inch', label: '英寸', factor: 0.0254 },
      { id: 'foot', label: '英尺', factor: 0.3048 },
      { id: 'yard', label: '码', factor: 0.9144 },
      { id: 'mile', label: '英里', factor: 1609.344 }
    ]
  },
  {
    id: 'mass',
    label: '质量',
    units: [
      { id: 'mg', label: '毫克', factor: 1e-3 },
      { id: 'g', label: '克', factor: 1 },
      { id: 'kg', label: '千克', factor: 1000 },
      { id: 'tonne', label: '吨', factor: 1e6 },
      { id: 'oz', label: '盎司', factor: 28.349523125 },
      { id: 'lb', label: '磅', factor: 453.59237 }
    ]
  },
  {
    id: 'temperature',
    label: '温度',
    units: [
      { id: 'c', label: '摄氏度 °C' },
      { id: 'f', label: '华氏度 °F' },
      { id: 'k', label: '开尔文 K' }
    ]
  },
  {
    id: 'angle',
    label: '角度',
    units: [
      { id: 'deg', label: '度', factor: 1 },
      { id: 'rad', label: '弧度', factor: 180 / Math.PI },
      { id: 'grad', label: '百分度', factor: 0.9 },
      { id: 'turn', label: '圈', factor: 360 }
    ]
  },
  {
    id: 'speed',
    label: '速度',
    units: [
      { id: 'mps', label: '米/秒', factor: 1 },
      { id: 'kmh', label: '千米/时', factor: 1 / 3.6 },
      { id: 'mph', label: '英里/时', factor: 0.44704 },
      { id: 'knot', label: '节', factor: 0.514444 }
    ]
  }
];

const TEMPERATURE = {
  c: { toCelsius: (v) => v, fromCelsius: (v) => v },
  f: { toCelsius: (v) => ((v - 32) * 5) / 9, fromCelsius: (v) => (v * 9) / 5 + 32 },
  k: { toCelsius: (v) => v - 273.15, fromCelsius: (v) => v + 273.15 }
};

export function getCategory(id) {
  return UNIT_CATEGORIES.find((category) => category.id === id) || null;
}

function getUnit(category, unitId) {
  const unit = category.units.find((entry) => entry.id === unitId);
  if (!unit) throw new Error(`「${unitId}」不是 ${category.label} 的单位`);
  return unit;
}

/**
 * 消除浮点噪声：保留 12 位有效数字。
 * 例如 1e-6 / 1e-9 在二进制浮点下会得到 999.9999999999999，
 * 而 0.01 / 0.01 会得到 7.000000000000001（同一个单位换算到自己都不精确）。
 * double 本身有约 15-17 位有效数字，截到 12 位足以去掉这类噪声且不影响真实精度。
 */
function cleanFloat(value) {
  if (!Number.isFinite(value) || value === 0) return value;
  return Number(value.toPrecision(12));
}

/** 同一类别内换算。 */
export function convertUnit(value, categoryId, fromId, toId) {
  const category = getCategory(categoryId);
  if (!category) throw new Error(`未知的单位类别：${categoryId}`);

  const from = getUnit(category, fromId);
  const to = getUnit(category, toId);
  const amount = Number(value);
  if (!Number.isFinite(amount)) throw new Error('数值无效');

  // 同一单位直接返回，保证精确
  if (fromId === toId) return amount;

  if (categoryId === 'temperature') {
    const celsius = TEMPERATURE[fromId].toCelsius(amount);
    return cleanFloat(TEMPERATURE[toId].fromCelsius(celsius));
  }

  // 先算倍率再乘，比「先乘后除」少一次浮点误差累积
  return cleanFloat(amount * (from.factor / to.factor));
}

/** 换成该类别下所有单位，便于一次看全。 */
export function convertToAllUnits(value, categoryId, fromId) {
  const category = getCategory(categoryId);
  if (!category) throw new Error(`未知的单位类别：${categoryId}`);
  return category.units.map((unit) => ({
    id: unit.id,
    label: unit.label,
    value: convertUnit(value, categoryId, fromId, unit.id)
  }));
}

/** 数值格式化：避免浮点尾数噪声，极大极小值用科学计数法。 */
export function formatNumber(value, { maxDecimals = 8 } = {}) {
  if (!Number.isFinite(value)) return String(value);
  if (value === 0) return '0';

  const absolute = Math.abs(value);
  if (absolute >= 1e15 || absolute < 1e-6) {
    return value.toExponential(6).replace(/\.?0+e/, 'e');
  }

  const rounded = Number(value.toFixed(maxDecimals));
  return String(rounded);
}

export function parseNumber(text) {
  const source = String(text ?? '').trim().replace(/[\s_]/g, '');
  if (source === '') throw new Error('数值为空');
  const value = Number(source);
  if (!Number.isFinite(value)) throw new Error(`「${text}」不是合法数值`);
  return value;
}
