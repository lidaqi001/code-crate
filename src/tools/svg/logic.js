/* SVG 占位图生成 —— 纯逻辑层，输出 SVG 源码字符串。
 *
 * 用途：写页面时先占位（`<img src="...">` / CSS background）、头像、OG 图。
 * 支持纯色或渐变背景、网格/点阵/斜线纹理、圆角与圆形、居中文字。
 */

export const PATTERNS = [
  { id: 'solid', label: '纯色' },
  { id: 'grid', label: '网格' },
  { id: 'dots', label: '点阵' },
  { id: 'diagonal', label: '斜线' },
  { id: 'cross', label: '十字' }
];

export const SIZE_PRESETS = [
  { id: '16:9', label: '16:9（视频 / OG）', width: 1200, height: 675 },
  { id: '4:3', label: '4:3', width: 800, height: 600 },
  { id: '1:1', label: '1:1（正方形）', width: 600, height: 600 },
  { id: 'avatar', label: '头像 256', width: 256, height: 256 },
  { id: 'banner', label: '横幅 1600×400', width: 1600, height: 400 },
  { id: 'icon', label: '图标 64', width: 64, height: 64 }
];

export const DEFAULT_OPTIONS = {
  width: 600,
  height: 400,
  background: '#1f2937',
  backgroundEnd: '',
  foreground: '#64748b',
  text: '600 × 400',
  textColor: '#e5e7eb',
  fontSize: 0,
  fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  pattern: 'solid',
  patternSize: 24,
  patternOpacity: 0.35,
  radius: 0,
  circle: false
};

const MIN_SIZE = 1;
const MAX_SIZE = 4096;

/* ── 校验 ─────────────────────────────────────────────────── */

const NAMED_COLORS = new Set([
  'transparent', 'currentcolor', 'black', 'white', 'red', 'green', 'blue',
  'gray', 'grey', 'yellow', 'orange', 'purple', 'pink', 'brown', 'cyan', 'magenta', 'lime'
]);

/** 接受 #rgb / #rrggbb / #rrggbbaa / rgb() / rgba() / hsl() / hsla() / 常用颜色名。 */
export function isValidColor(text) {
  const value = String(text ?? '').trim().toLowerCase();
  if (value === '') return false;
  if (NAMED_COLORS.has(value)) return true;
  if (/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(value)) return true;
  if (/^rgba?\(\s*[\d.%\s,/-]+\)$/.test(value)) return true;
  if (/^hsla?\(\s*[\d.%\s,/-]+\)$/.test(value)) return true;
  return false;
}

function assertSize(value, label) {
  const size = Math.round(Number(value));
  if (!Number.isFinite(size) || size < MIN_SIZE || size > MAX_SIZE) {
    throw new Error(`${label}需要在 ${MIN_SIZE}-${MAX_SIZE} 之间`);
  }
  return size;
}

/* ── 文本度量 ─────────────────────────────────────────────── */

/** 粗略估算一个字符相对字号的宽度：中文/全角约 1.0，西文约 0.58。 */
export function charWidthRatio(char) {
  const code = char.codePointAt(0);
  const wide =
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x20000 && code <= 0x3fffd);
  return wide ? 1 : 0.58;
}

export function estimateTextWidth(text, fontSize) {
  let total = 0;
  for (const char of String(text ?? '')) total += charWidthRatio(char);
  return total * fontSize;
}

/** 在给定画布内自动选一个既够大又不溢出的字号。 */
export function autoFontSize(text, width, height, { maxRatio = 0.28, widthRatio = 0.82 } = {}) {
  const content = String(text ?? '');
  if (content === '') return 0;

  const byHeight = height * maxRatio;
  const units = [...content].reduce((sum, char) => sum + charWidthRatio(char), 0);
  const byWidth = units === 0 ? byHeight : (width * widthRatio) / units;

  return Math.max(8, Math.min(byHeight, byWidth));
}

/* ── 生成 ─────────────────────────────────────────────────── */

function escapeXml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function buildPattern(pattern, options) {
  const { foreground, patternSize, patternOpacity, width, height } = options;
  const size = Math.max(2, Math.round(patternSize));
  const id = 'pattern';
  const stroke = `stroke="${foreground}" stroke-width="1" opacity="${patternOpacity}"`;

  let body = '';
  if (pattern === 'grid') {
    body = `<path d="M ${size} 0 L 0 0 0 ${size}" fill="none" ${stroke} />`;
  } else if (pattern === 'dots') {
    body = `<circle cx="${round(size / 2)}" cy="${round(size / 2)}" r="1.5" fill="${foreground}" opacity="${patternOpacity}" />`;
  } else if (pattern === 'diagonal') {
    body = `<path d="M 0 ${size} L ${size} 0" fill="none" ${stroke} />`;
  } else if (pattern === 'cross') {
    body = `<path d="M ${round(size / 2)} 0 V ${size} M 0 ${round(size / 2)} H ${size}" fill="none" ${stroke} />`;
  } else {
    return '';
  }

  return {
    def: `<pattern id="${id}" width="${size}" height="${size}" patternUnits="userSpaceOnUse" x="0" y="0">${body}</pattern>`,
    rect: `<rect width="${width}" height="${height}" fill="url(#${id})" />`
  };
}

/**
 * 生成 SVG 源码。
 * @returns {{ok:true, svg:string, bytes:number, fontSize:number, warnings:string[]}|{ok:false, error:string}}
 */
export function generateSvg(input = {}) {
  const options = { ...DEFAULT_OPTIONS, ...input };
  const warnings = [];

  let width;
  let height;
  try {
    width = assertSize(options.width, '宽度');
    height = assertSize(options.height, '高度');
  } catch (error) {
    return { ok: false, error: error.message };
  }

  if (!isValidColor(options.background)) return { ok: false, error: `背景色「${options.background}」不是合法颜色` };
  if (options.backgroundEnd && !isValidColor(options.backgroundEnd)) {
    return { ok: false, error: `渐变结束色「${options.backgroundEnd}」不是合法颜色` };
  }
  if (!isValidColor(options.foreground)) return { ok: false, error: `纹理颜色「${options.foreground}」不是合法颜色` };
  if (!isValidColor(options.textColor)) return { ok: false, error: `文字颜色「${options.textColor}」不是合法颜色` };

  const pattern = PATTERNS.some((entry) => entry.id === options.pattern) ? options.pattern : 'solid';
  if (pattern !== options.pattern) warnings.push(`未知的纹理「${options.pattern}」，已改用纯色`);

  const radius = options.circle ? Math.min(width, height) / 2 : Math.max(0, Number(options.radius) || 0);
  if (options.circle && width !== height) {
    warnings.push('圆形只对正方形有意义，当前宽高不等，会按短边做圆角');
  }
  if (!options.circle && radius * 2 > Math.min(width, height)) {
    warnings.push('圆角半径超过短边的一半，实际会被限制');
  }

  const text = String(options.text ?? '');
  const fontSize = Number(options.fontSize) > 0
    ? Number(options.fontSize)
    : autoFontSize(text, width, height);

  if (text && estimateTextWidth(text, fontSize) > width * 0.95) {
    warnings.push('文字可能超出画布宽度，建议缩短文本或减小字号');
  }

  const defs = [];
  let backgroundFill = options.background;
  if (options.backgroundEnd) {
    defs.push(
      `<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0%" stop-color="${options.background}" />` +
      `<stop offset="100%" stop-color="${options.backgroundEnd}" />` +
      `</linearGradient>`
    );
    backgroundFill = 'url(#bg)';
  }

  const patternDef = !options.backgroundEnd ? buildPattern(pattern, { ...options, width, height }) : null;
  if (patternDef) defs.push(patternDef.def);

  const clipId = radius > 0 ? 'clip' : '';
  if (clipId) {
    defs.push(`<clipPath id="${clipId}"><rect width="${width}" height="${height}" rx="${round(radius)}" ry="${round(radius)}" /></clipPath>`);
  }

  const lines = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(text || `${width} × ${height} 占位图`)}">`
  ];

  if (defs.length) lines.push(`  <defs>${defs.join('')}</defs>`);

  const groupOpen = clipId ? `  <g clip-path="url(#${clipId})">` : '  <g>';
  lines.push(groupOpen);
  lines.push(`    <rect width="${width}" height="${height}" fill="${backgroundFill}" />`);
  if (patternDef) lines.push(`    ${patternDef.rect}`);

  if (text) {
    lines.push(
      `    <text x="50%" y="50%" fill="${options.textColor}" font-family="${escapeXml(options.fontFamily)}" ` +
      `font-size="${round(fontSize)}" font-weight="600" text-anchor="middle" dominant-baseline="central">${escapeXml(text)}</text>`
    );
  }

  lines.push('  </g>');
  lines.push('</svg>');

  const svg = lines.join('\n');
  return { ok: true, svg, bytes: new TextEncoder().encode(svg).length, fontSize, warnings };
}

/** 转成可直接放进 src / CSS 的 data URI（用 encodeURIComponent，避免 btoa 的中文问题）。 */
export function toDataUri(svg) {
  const encoded = encodeURIComponent(String(svg ?? ''))
    .replace(/'/g, '%27')
    .replace(/"/g, '%22');
  return `data:image/svg+xml,${encoded}`;
}

/** 转成 CSS background 可用的写法。 */
export function toCssBackground(svg) {
  return `background-image: url("${toDataUri(svg)}");`;
}

/** 生成一组常用尺寸，便于一次拿全套占位图。 */
export function generateSet(input = {}, presets = ['16:9', '4:3', '1:1']) {
  const results = [];
  for (const id of presets) {
    const preset = SIZE_PRESETS.find((entry) => entry.id === id);
    if (!preset) continue;
    const result = generateSvg({ ...input, width: preset.width, height: preset.height });
    results.push({ id, label: preset.label, ...result });
  }
  return results;
}
