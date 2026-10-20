/* 颜色工具 —— 纯逻辑层。
 *
 * 这里修正了旧实现的两个问题：
 * 1. 色阶用「绝对亮度 i*10」计算，导致 darker 系列反而比基色更亮；改用与黑/白的混合比例
 * 2. 随机颜色写成 Math.random()*16777215，永远取不到 #ffffff；改用字节级随机源
 */

export const NAMED_COLORS = {
  transparent: { r: 0, g: 0, b: 0, a: 0 },
  black: { r: 0, g: 0, b: 0, a: 1 },
  white: { r: 255, g: 255, b: 255, a: 1 },
  red: { r: 255, g: 0, b: 0, a: 1 },
  lime: { r: 0, g: 255, b: 0, a: 1 },
  blue: { r: 0, g: 0, b: 255, a: 1 },
  yellow: { r: 255, g: 255, b: 0, a: 1 },
  cyan: { r: 0, g: 255, b: 255, a: 1 },
  aqua: { r: 0, g: 255, b: 255, a: 1 },
  magenta: { r: 255, g: 0, b: 255, a: 1 },
  fuchsia: { r: 255, g: 0, b: 255, a: 1 },
  silver: { r: 192, g: 192, b: 192, a: 1 },
  gray: { r: 128, g: 128, b: 128, a: 1 },
  grey: { r: 128, g: 128, b: 128, a: 1 },
  maroon: { r: 128, g: 0, b: 0, a: 1 },
  olive: { r: 128, g: 128, b: 0, a: 1 },
  green: { r: 0, g: 128, b: 0, a: 1 },
  purple: { r: 128, g: 0, b: 128, a: 1 },
  teal: { r: 0, g: 128, b: 128, a: 1 },
  navy: { r: 0, g: 0, b: 128, a: 1 },
  orange: { r: 255, g: 165, b: 0, a: 1 },
  pink: { r: 255, g: 192, b: 203, a: 1 },
  gold: { r: 255, g: 215, b: 0, a: 1 },
  indigo: { r: 75, g: 0, b: 130, a: 1 },
  violet: { r: 238, g: 130, b: 238, a: 1 },
  tomato: { r: 255, g: 99, b: 71, a: 1 },
  salmon: { r: 250, g: 128, b: 114, a: 1 },
  coral: { r: 255, g: 127, b: 80, a: 1 },
  crimson: { r: 220, g: 20, b: 60, a: 1 },
  brown: { r: 165, g: 42, b: 42, a: 1 },
  chocolate: { r: 210, g: 105, b: 30, a: 1 },
  skyblue: { r: 135, g: 206, b: 235, a: 1 },
  steelblue: { r: 70, g: 130, b: 180, a: 1 },
  royalblue: { r: 65, g: 105, b: 225, a: 1 },
  slategray: { r: 112, g: 128, b: 144, a: 1 },
  seagreen: { r: 46, g: 139, b: 87, a: 1 },
  forestgreen: { r: 34, g: 139, b: 34, a: 1 },
  goldenrod: { r: 218, g: 165, b: 32, a: 1 },
  khaki: { r: 240, g: 230, b: 140, a: 1 },
  lavender: { r: 230, g: 230, b: 250, a: 1 },
  beige: { r: 245, g: 245, b: 220, a: 1 },
  ivory: { r: 255, g: 255, b: 240, a: 1 },
  snow: { r: 255, g: 250, b: 250, a: 1 },
  whitesmoke: { r: 245, g: 245, b: 245, a: 1 },
  gainsboro: { r: 220, g: 220, b: 220, a: 1 },
  dimgray: { r: 105, g: 105, b: 105, a: 1 },
  darkslategray: { r: 47, g: 79, b: 79, a: 1 },
  midnightblue: { r: 25, g: 25, b: 112, a: 1 },
  rebeccapurple: { r: 102, g: 51, b: 153, a: 1 }
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round = (value) => Math.round(value);

function toByte(value) {
  return clamp(round(value), 0, 255);
}

function toAlpha(value) {
  return clamp(Number(value), 0, 1);
}

/* ── 解析 ─────────────────────────────────────────────────── */

function parseHex(input) {
  const match = /^#([0-9a-fA-F]{3,8})$/.exec(input);
  if (!match) return null;
  const hex = match[1];
  const expand = (char) => Number.parseInt(char + char, 16);

  if (hex.length === 3 || hex.length === 4) {
    return {
      r: expand(hex[0]),
      g: expand(hex[1]),
      b: expand(hex[2]),
      a: hex.length === 4 ? expand(hex[3]) / 255 : 1
    };
  }
  if (hex.length === 6 || hex.length === 8) {
    return {
      r: Number.parseInt(hex.slice(0, 2), 16),
      g: Number.parseInt(hex.slice(2, 4), 16),
      b: Number.parseInt(hex.slice(4, 6), 16),
      a: hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1
    };
  }
  return null;
}

function parseFunctional(input) {
  const match = /^(rgba?|hsla?)\(([^)]+)\)$/i.exec(input);
  if (!match) return null;

  const fn = match[1].toLowerCase();
  const body = match[2].replace(/\//g, ' ').replace(/,/g, ' ').trim();
  const tokens = body.split(/\s+/).filter(Boolean);
  if (tokens.length < 3) return null;

  const numbers = tokens.map((token) => {
    if (token.endsWith('%')) return { value: Number.parseFloat(token), percent: true };
    return { value: Number.parseFloat(token), percent: false };
  });
  if (numbers.some((entry) => !Number.isFinite(entry.value))) return null;

  const alphaToken = tokens[3];
  let alpha = 1;
  if (alphaToken !== undefined) {
    alpha = alphaToken.endsWith('%') ? Number.parseFloat(alphaToken) / 100 : Number.parseFloat(alphaToken);
    if (!Number.isFinite(alpha)) return null;
  }

  if (fn.startsWith('rgb')) {
    const channel = (entry) => (entry.percent ? (entry.value / 100) * 255 : entry.value);
    return {
      r: toByte(channel(numbers[0])),
      g: toByte(channel(numbers[1])),
      b: toByte(channel(numbers[2])),
      a: toAlpha(alpha)
    };
  }

  const h = numbers[0].value;
  const s = numbers[1].percent ? numbers[1].value : numbers[1].value;
  const l = numbers[2].percent ? numbers[2].value : numbers[2].value;
  const rgb = hslToRgb({ h, s, l });
  return { ...rgb, a: toAlpha(alpha) };
}

/**
 * 解析任意 CSS 颜色写法。
 * @returns {{ok:true, rgba:object, format:string}|{ok:false, error:string}}
 */
export function parseColor(input) {
  const text = String(input ?? '').trim().toLowerCase();
  if (!text) return { ok: false, error: '颜色为空' };

  if (text in NAMED_COLORS) {
    return { ok: true, rgba: { ...NAMED_COLORS[text] }, format: 'name' };
  }

  const hex = parseHex(text);
  if (hex) return { ok: true, rgba: hex, format: 'hex' };

  const functional = parseFunctional(text);
  if (functional) return { ok: true, rgba: functional, format: 'functional' };

  return { ok: false, error: '无法识别的颜色格式（支持 #hex、rgb()、hsl() 与常用颜色名）' };
}

/* ── 转换 ─────────────────────────────────────────────────── */

function channelToHex(value) {
  return toByte(value).toString(16).padStart(2, '0');
}

export function rgbToHex(rgba, { withAlpha = false, upper = false } = {}) {
  const base = `#${channelToHex(rgba.r)}${channelToHex(rgba.g)}${channelToHex(rgba.b)}`;
  const alpha = rgba.a === undefined || rgba.a >= 1 ? '' : channelToHex(rgba.a * 255);
  const result = withAlpha && alpha ? `${base}${alpha}` : base;
  return upper ? result.toUpperCase() : result;
}

export function rgbToHsl({ r, g, b }) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  const l = (max + min) / 2;

  let h = 0;
  let s = 0;

  if (delta !== 0) {
    s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    if (max === rn) h = ((gn - bn) / delta + (gn < bn ? 6 : 0)) / 6;
    else if (max === gn) h = ((bn - rn) / delta + 2) / 6;
    else h = ((rn - gn) / delta + 4) / 6;
  }

  return { h: h * 360, s: s * 100, l: l * 100 };
}

export function hslToRgb({ h, s, l }) {
  const hue = ((h % 360) + 360) % 360;
  const saturation = clamp(s, 0, 100) / 100;
  const lightness = clamp(l, 0, 100) / 100;

  if (saturation === 0) {
    const value = toByte(lightness * 255);
    return { r: value, g: value, b: value };
  }

  const a = saturation * Math.min(lightness, 1 - lightness);
  const f = (n) => {
    const k = (n + hue / 30) % 12;
    return lightness - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
  };

  return { r: toByte(f(0) * 255), g: toByte(f(8) * 255), b: toByte(f(4) * 255) };
}

export function formatColor(rgba, format = 'hex') {
  switch (format) {
    case 'hex':
      return rgbToHex(rgba, { withAlpha: rgba.a < 1 });
    case 'hex-upper':
      return rgbToHex(rgba, { withAlpha: rgba.a < 1, upper: true });
    case 'rgb':
      return rgba.a < 1
        ? `rgba(${toByte(rgba.r)}, ${toByte(rgba.g)}, ${toByte(rgba.b)}, ${Number(rgba.a.toFixed(3))})`
        : `rgb(${toByte(rgba.r)}, ${toByte(rgba.g)}, ${toByte(rgba.b)})`;
    case 'hsl': {
      const hsl = rgbToHsl(rgba);
      const h = Math.round(hsl.h);
      const s = Math.round(hsl.s);
      const l = Math.round(hsl.l);
      return rgba.a < 1 ? `hsla(${h}, ${s}%, ${l}%, ${Number(rgba.a.toFixed(3))})` : `hsl(${h}, ${s}%, ${l}%)`;
    }
    case 'css-var': {
      const hsl = rgbToHsl(rgba);
      return `${Math.round(hsl.h)} ${Math.round(hsl.s)}% ${Math.round(hsl.l)}%`;
    }
    default:
      return rgbToHex(rgba);
  }
}

export const FORMATS = [
  { id: 'hex', label: 'HEX' },
  { id: 'hex-upper', label: 'HEX 大写' },
  { id: 'rgb', label: 'rgb()' },
  { id: 'hsl', label: 'hsl()' },
  { id: 'css-var', label: 'CSS 变量值' }
];

/* ── 对比度（WCAG 2.1） ───────────────────────────────────── */

function linearize(channel) {
  const value = channel / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance({ r, g, b }) {
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

export function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** AA：正文 4.5，大字 3；AAA：正文 7，大字 4.5。 */
export function wcagLevels(ratio) {
  return {
    aaNormal: ratio >= 4.5,
    aaLarge: ratio >= 3,
    aaaNormal: ratio >= 7,
    aaaLarge: ratio >= 4.5
  };
}

/** 在给定背景上给出可读性更好的文字色。 */
export function bestTextColor(background) {
  const white = { r: 255, g: 255, b: 255, a: 1 };
  const black = { r: 0, g: 0, b: 0, a: 1 };
  const whiteRatio = contrastRatio(background, white);
  const blackRatio = contrastRatio(background, black);
  return {
    color: whiteRatio >= blackRatio ? '#ffffff' : '#000000',
    ratio: Math.max(whiteRatio, blackRatio),
    whiteRatio,
    blackRatio
  };
}

/* ── 混合与色阶 ───────────────────────────────────────────── */

export function mix(a, b, ratio) {
  const t = clamp(ratio, 0, 1);
  return {
    r: toByte(a.r * (1 - t) + b.r * t),
    g: toByte(a.g * (1 - t) + b.g * t),
    b: toByte(a.b * (1 - t) + b.b * t),
    a: 1
  };
}

export function withAlpha(rgba, alpha) {
  return { ...rgba, a: toAlpha(alpha) };
}

/** 变亮：与白色混合。比例越大越亮。 */
export function lighten(rgba, ratio) {
  return mix(rgba, { r: 255, g: 255, b: 255, a: 1 }, ratio);
}

/** 变暗：与黑色混合。比例越大越暗。 */
export function darken(rgba, ratio) {
  return mix(rgba, { r: 0, g: 0, b: 0, a: 1 }, ratio);
}

const SCALE_STEPS = [
  { name: '50', kind: 'light', ratio: 0.95 },
  { name: '100', kind: 'light', ratio: 0.9 },
  { name: '200', kind: 'light', ratio: 0.75 },
  { name: '300', kind: 'light', ratio: 0.6 },
  { name: '400', kind: 'light', ratio: 0.3 },
  { name: '500', kind: 'base', ratio: 0 },
  { name: '600', kind: 'dark', ratio: 0.15 },
  { name: '700', kind: 'dark', ratio: 0.3 },
  { name: '800', kind: 'dark', ratio: 0.45 },
  { name: '900', kind: 'dark', ratio: 0.6 }
];

/**
 * 生成 50-900 色阶。
 * 关键性质：亮度随编号单调递减（旧实现用绝对亮度导致 darker 反而更亮）。
 */
export function colorScale(rgba) {
  return SCALE_STEPS.map((step) => {
    const color = step.kind === 'light' ? lighten(rgba, step.ratio)
      : step.kind === 'dark' ? darken(rgba, step.ratio)
        : { ...rgba };
    return {
      name: step.name,
      kind: step.kind,
      color,
      hex: rgbToHex(color),
      luminance: relativeLuminance(color)
    };
  });
}

/** 与白色按固定比例混合的浅色序列（由浅到深）。 */
export function tints(rgba, steps = 5) {
  const out = [];
  for (let i = steps; i >= 1; i -= 1) out.push(lighten(rgba, (i / (steps + 1)) * 0.9));
  return out;
}

/** 与黑色按固定比例混合的深色序列（由浅到深）。 */
export function shades(rgba, steps = 5) {
  const out = [];
  for (let i = 1; i <= steps; i += 1) out.push(darken(rgba, (i / (steps + 1)) * 0.9));
  return out;
}

/* ── 配色方案 ─────────────────────────────────────────────── */

export const HARMONY_KINDS = [
  { id: 'complementary', label: '互补色', angles: [180] },
  { id: 'analogous', label: '类似色', angles: [-30, 30] },
  { id: 'triadic', label: '三角配色', angles: [120, 240] },
  { id: 'split', label: '分裂互补', angles: [150, 210] },
  { id: 'tetradic', label: '四方配色', angles: [90, 180, 270] },
  { id: 'square', label: '正方形配色', angles: [90, 180, 270] }
];

export function shiftHue(rgba, degrees) {
  const hsl = rgbToHsl(rgba);
  const rgb = hslToRgb({ h: (hsl.h + degrees + 360) % 360, s: hsl.s, l: hsl.l });
  return { ...rgb, a: rgba.a };
}

export function harmony(rgba, kindId) {
  const kind = HARMONY_KINDS.find((entry) => entry.id === kindId);
  if (!kind) throw new Error(`未知的配色方案：${kindId}`);
  return [rgba, ...kind.angles.map((angle) => shiftHue(rgba, angle))];
}

/* ── 随机颜色 ─────────────────────────────────────────────── */

export const defaultRng = {
  nextBytes(length) {
    const out = new Uint8Array(length);
    if (globalThis.crypto && globalThis.crypto.getRandomValues) globalThis.crypto.getRandomValues(out);
    else for (let i = 0; i < length; i += 1) out[i] = Math.floor(Math.random() * 256);
    return out;
  }
};

/** 每个通道独立取 0-255，因此 #ffffff 与 #000000 都能取到。 */
export function randomColor(rng = defaultRng) {
  const bytes = rng.nextBytes(3);
  return { r: bytes[0], g: bytes[1], b: bytes[2], a: 1 };
}

export function randomHex(rng = defaultRng) {
  return rgbToHex(randomColor(rng));
}
