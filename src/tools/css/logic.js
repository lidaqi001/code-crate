/* CSS 生成器纯逻辑：渐变与阴影的字符串构建。
   不碰 DOM；只负责把结构化的选项变成合法的 CSS 值。
   颜色一律走白名单校验，避免把任意文本拼进样式。 */

export const GRADIENT_TYPES = [
  { id: 'linear', label: '线性' },
  { id: 'radial', label: '径向' },
  { id: 'conic', label: '锥形' }
];

export const RADIAL_SHAPES = [
  { id: 'circle', label: '圆形' },
  { id: 'ellipse', label: '椭圆' }
];

export const MAX_STOPS = 6;
export const MAX_LAYERS = 5;

export const DEFAULT_STOPS = [
  { color: '#6366f1', position: 0 },
  { color: '#ec4899', position: 100 }
];

export const DEFAULT_LAYERS = [
  { x: 0, y: 8, blur: 24, spread: -6, color: '#000000', alpha: 0.35, inset: false }
];

export const GRADIENT_PRESETS = [
  {
    id: 'sunset',
    label: '日落',
    type: 'linear',
    angle: 135,
    stops: [
      { color: '#ff7e5f', position: 0 },
      { color: '#feb47b', position: 100 }
    ]
  },
  {
    id: 'ocean',
    label: '海洋',
    type: 'linear',
    angle: 120,
    stops: [
      { color: '#2193b0', position: 0 },
      { color: '#6dd5ed', position: 100 }
    ]
  },
  {
    id: 'neon',
    label: '霓虹',
    type: 'linear',
    angle: 90,
    stops: [
      { color: '#8e2de2', position: 0 },
      { color: '#4a00e0', position: 100 }
    ]
  },
  {
    id: 'mint',
    label: '薄荷',
    type: 'linear',
    angle: 160,
    stops: [
      { color: '#00b09b', position: 0 },
      { color: '#96c93d', position: 100 }
    ]
  },
  {
    id: 'spotlight',
    label: '聚光',
    type: 'radial',
    shape: 'circle',
    x: 50,
    y: 30,
    stops: [
      { color: '#ffffff', position: 0 },
      { color: '#1f2937', position: 100 }
    ]
  },
  {
    id: 'rainbow',
    label: '色环',
    type: 'conic',
    angle: 0,
    x: 50,
    y: 50,
    stops: [
      { color: '#ef4444', position: 0 },
      { color: '#eab308', position: 25 },
      { color: '#22c55e', position: 50 },
      { color: '#3b82f6', position: 75 },
      { color: '#ef4444', position: 100 }
    ]
  }
];

export const SHADOW_PRESETS = [
  {
    id: 'card',
    label: '卡片',
    layers: [{ x: 0, y: 2, blur: 8, spread: -2, color: '#000000', alpha: 0.15, inset: false }]
  },
  {
    id: 'raised',
    label: '浮层',
    layers: [{ x: 0, y: 12, blur: 32, spread: -8, color: '#000000', alpha: 0.35, inset: false }]
  },
  {
    id: 'inset',
    label: '内凹',
    layers: [{ x: 0, y: 2, blur: 6, spread: 0, color: '#000000', alpha: 0.2, inset: true }]
  },
  {
    id: 'glow',
    label: '霓虹',
    layers: [
      { x: 0, y: 0, blur: 18, spread: 0, color: '#6366f1', alpha: 0.55, inset: false },
      { x: 0, y: 0, blur: 42, spread: 0, color: '#a855f7', alpha: 0.35, inset: false }
    ]
  }
];

/* ── 基础校验 ─────────────────────────────────────────────── */

const HEX_PATTERN = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

export function isHexColor(value) {
  return typeof value === 'string' && HEX_PATTERN.test(value.trim());
}

/** 颜色白名单：不符合的直接退回黑色，绝不把原始输入拼进 CSS。 */
export function sanitizeColor(value, fallback = '#000000') {
  return isHexColor(value) ? value.trim() : fallback;
}

export function clampNumber(value, min, max, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

export function normalizeAngle(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return ((number % 360) + 360) % 360;
}

/** 去掉浮点误差产生的长尾：12.5 保留，12.0 变成 12。 */
function formatNumber(value) {
  return String(Math.round(value * 100) / 100);
}

/* ── 渐变 ─────────────────────────────────────────────────── */

/**
 * 规范化色标：颜色白名单、位置夹到 0–100、按位置升序。
 * 少于两个色标时补一个，保证输出始终是合法渐变。
 */
export function normalizeStops(stops) {
  const source = Array.isArray(stops) ? stops : [];
  const clean = source
    .filter((stop) => stop && typeof stop === 'object')
    .slice(0, MAX_STOPS)
    .map((stop, index) => ({
      color: sanitizeColor(stop.color),
      position: clampNumber(stop.position, 0, 100, index === 0 ? 0 : 100)
    }));

  if (clean.length === 0) return DEFAULT_STOPS.map((stop) => ({ ...stop }));
  if (clean.length === 1) {
    return [
      { ...clean[0], position: 0 },
      { ...clean[0], position: 100 }
    ];
  }
  return clean.sort((a, b) => a.position - b.position);
}

/**
 * 生成 `background` 可用的渐变值。
 * @param {object} options
 * @param {'linear'|'radial'|'conic'} options.type
 * @param {number} [options.angle]
 * @param {'circle'|'ellipse'} [options.shape]
 * @param {number} [options.x]
 * @param {number} [options.y]
 * @param {Array<{color:string,position:number}>} options.stops
 */
export function buildGradient(options = {}) {
  const stops = normalizeStops(options.stops)
    .map((stop) => `${stop.color} ${formatNumber(stop.position)}%`)
    .join(', ');

  const angle = normalizeAngle(options.angle);
  const x = clampNumber(options.x, 0, 100, 50);
  const y = clampNumber(options.y, 0, 100, 50);
  const shape = options.shape === 'circle' ? 'circle' : 'ellipse';

  if (options.type === 'radial') {
    return `radial-gradient(${shape} at ${formatNumber(x)}% ${formatNumber(y)}%, ${stops})`;
  }
  if (options.type === 'conic') {
    return `conic-gradient(from ${formatNumber(angle)}deg at ${formatNumber(x)}% ${formatNumber(y)}%, ${stops})`;
  }
  return `linear-gradient(${formatNumber(angle)}deg, ${stops})`;
}

export function buildGradientRule(options = {}) {
  return `background: ${buildGradient(options)};`;
}

/* ── 阴影 ─────────────────────────────────────────────────── */

/** #rgb / #rrggbb / #rrggbbaa → rgba()。8 位十六进制里的 alpha 会被忽略，以显式 alpha 为准。 */
export function hexToRgba(hex, alpha = 1) {
  const color = sanitizeColor(hex);
  let value = color.slice(1);
  if (value.length === 3 || value.length === 4) {
    value = value
      .slice(0, 3)
      .split('')
      .map((char) => char + char)
      .join('');
  }
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  const a = Math.round(clampNumber(alpha, 0, 1, 1) * 1000) / 1000;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** 规范化阴影层：夹紧数值、颜色白名单、丢弃被关闭的层。 */
export function normalizeLayers(layers) {
  const source = Array.isArray(layers) ? layers : [];
  return source
    .filter((layer) => layer && typeof layer === 'object' && layer.enabled !== false)
    .slice(0, MAX_LAYERS)
    .map((layer) => ({
      x: clampNumber(layer.x, -100, 100, 0),
      y: clampNumber(layer.y, -100, 100, 0),
      blur: clampNumber(layer.blur, 0, 200, 0),
      spread: clampNumber(layer.spread, -100, 100, 0),
      color: sanitizeColor(layer.color),
      alpha: clampNumber(layer.alpha, 0, 1, 1),
      inset: layer.inset === true
    }));
}

export function buildShadow(layers) {
  const clean = normalizeLayers(layers);
  if (!clean.length) return 'none';
  return clean
    .map((layer) => {
      const base = [
        `${formatNumber(layer.x)}px`,
        `${formatNumber(layer.y)}px`,
        `${formatNumber(layer.blur)}px`,
        `${formatNumber(layer.spread)}px`,
        hexToRgba(layer.color, layer.alpha)
      ].join(' ');
      return layer.inset ? `inset ${base}` : base;
    })
    .join(', ');
}

export function buildShadowRule(layers) {
  return `box-shadow: ${buildShadow(layers)};`;
}
