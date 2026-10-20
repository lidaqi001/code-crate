/* 内联 SVG 图标集：统一 24×24 网格、1.8 描边、currentColor 取色。
   使用矢量图标而非 emoji，避免不同平台字形差异导致界面观感不一致。 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/* 必须用 createElementNS 构造：document.createElement('svg')（也就是 dom.js 的 h()）
   建出来的是 HTML 命名空间下的 HTMLUnknownElement，浏览器不按 SVG 描绘，
   图标会全部退化成 0×0 的空盒子。子元素同理，必须同命名空间。 */
function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'style') node.style.cssText = value;
    else node.setAttribute(key, String(value));
  }
  return node;
}

const SPECS = {
  /* 工具图标 */
  json: [
    ['path', { d: 'M9 3H8a2 2 0 0 0-2 2v3a2 2 0 0 1-2 2 2 2 0 0 1 2 2v3a2 2 0 0 0 2 2h1' }],
    ['path', { d: 'M15 3h1a2 2 0 0 1 2 2v3a2 2 0 0 0 2 2 2 2 0 0 0-2 2v3a2 2 0 0 1-2 2h-1' }]
  ],
  codec: [
    ['line', { x1: 4, y1: 9, x2: 20, y2: 9 }],
    ['line', { x1: 4, y1: 15, x2: 20, y2: 15 }],
    ['line', { x1: 10, y1: 3, x2: 8, y2: 21 }],
    ['line', { x1: 16, y1: 3, x2: 14, y2: 21 }]
  ],
  timestamp: [
    ['circle', { cx: 12, cy: 12, r: 9 }],
    ['polyline', { points: '12 7 12 12 15.5 14' }]
  ],
  uuid: [
    ['rect', { x: 3, y: 3, width: 18, height: 18, rx: 4 }],
    ['circle', { cx: 8.5, cy: 8.5, r: 1.1 }],
    ['circle', { cx: 15.5, cy: 8.5, r: 1.1 }],
    ['circle', { cx: 12, cy: 12, r: 1.1 }],
    ['circle', { cx: 8.5, cy: 15.5, r: 1.1 }],
    ['circle', { cx: 15.5, cy: 15.5, r: 1.1 }]
  ],
  regex: [
    ['rect', { x: 3, y: 3, width: 18, height: 18, rx: 4 }],
    ['line', { x1: 12, y1: 8, x2: 12, y2: 16 }],
    ['line', { x1: 8.5, y1: 10, x2: 15.5, y2: 14 }],
    ['line', { x1: 15.5, y1: 10, x2: 8.5, y2: 14 }]
  ],
  diff: [
    ['circle', { cx: 6, cy: 6, r: 3 }],
    ['circle', { cx: 18, cy: 18, r: 3 }],
    ['path', { d: 'M13 6h3a2 2 0 0 1 2 2v7' }],
    ['path', { d: 'M11 18H8a2 2 0 0 1-2-2V9' }]
  ],
  text: [
    ['polyline', { points: '4 7 4 4 20 4 20 7' }],
    ['line', { x1: 9, y1: 20, x2: 15, y2: 20 }],
    ['line', { x1: 12, y1: 4, x2: 12, y2: 20 }]
  ],
  color: [
    ['path', { d: 'M12 21a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5S12.5 4.5 12 2.5c-.5 2-2 4.4-4 6S5 12 5 14a7 7 0 0 0 7 7z' }]
  ],
  qrcode: [
    ['rect', { x: 3, y: 3, width: 7, height: 7, rx: 1.5 }],
    ['rect', { x: 14, y: 3, width: 7, height: 7, rx: 1.5 }],
    ['rect', { x: 3, y: 14, width: 7, height: 7, rx: 1.5 }],
    ['rect', { x: 14, y: 14, width: 3, height: 3 }],
    ['rect', { x: 18, y: 18, width: 3, height: 3 }]
  ],
  http: [
    ['circle', { cx: 12, cy: 12, r: 9 }],
    ['path', { d: 'M3 12h18' }],
    ['path', { d: 'M12 3c2.6 2.6 3.9 5.6 3.9 9s-1.3 6.4-3.9 9c-2.6-2.6-3.9-5.6-3.9-9S9.4 5.6 12 3z' }]
  ],
  markdown: [
    ['path', { d: 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z' }],
    ['path', { d: 'M14 2v4a2 2 0 0 0 2 2h4' }],
    ['line', { x1: 8, y1: 13, x2: 16, y2: 13 }],
    ['line', { x1: 8, y1: 17, x2: 13, y2: 17 }]
  ],
  converter: [
    ['path', { d: 'M3 8h14' }],
    ['polyline', { points: '14 5 17 8 14 11' }],
    ['path', { d: 'M21 16H7' }],
    ['polyline', { points: '10 13 7 16 10 19' }]
  ],
  units: [
    ['rect', { x: 2, y: 9, width: 20, height: 6, rx: 1 }],
    ['line', { x1: 6, y1: 9, x2: 6, y2: 12 }],
    ['line', { x1: 10, y1: 9, x2: 10, y2: 12 }],
    ['line', { x1: 14, y1: 9, x2: 14, y2: 12 }],
    ['line', { x1: 18, y1: 9, x2: 18, y2: 12 }]
  ],
  chmod: [
    ['rect', { x: 4, y: 10, width: 16, height: 11, rx: 2 }],
    ['path', { d: 'M8 10V7a4 4 0 0 1 8 0v3' }],
    ['line', { x1: 12, y1: 14, x2: 12, y2: 17 }]
  ],
  keycode: [
    ['rect', { x: 2, y: 6, width: 20, height: 12, rx: 2 }],
    ['line', { x1: 6, y1: 10, x2: 6.01, y2: 10 }],
    ['line', { x1: 10, y1: 10, x2: 10.01, y2: 10 }],
    ['line', { x1: 14, y1: 10, x2: 14.01, y2: 10 }],
    ['line', { x1: 18, y1: 10, x2: 18.01, y2: 10 }],
    ['line', { x1: 8, y1: 14, x2: 16, y2: 14 }]
  ],
  crypto: [
    ['rect', { x: 4, y: 10, width: 16, height: 11, rx: 2 }],
    ['path', { d: 'M8 10V7a4 4 0 0 1 8 0v3' }],
    ['circle', { cx: 12, cy: 15.5, r: 1.6 }]
  ],
  otp: [
    ['rect', { x: 5, y: 2, width: 14, height: 20, rx: 2 }],
    ['line', { x1: 10, y1: 6, x2: 14, y2: 6 }],
    ['circle', { cx: 9, cy: 12, r: 0.6 }],
    ['circle', { cx: 12, cy: 12, r: 0.6 }],
    ['circle', { cx: 15, cy: 12, r: 0.6 }],
    ['circle', { cx: 9, cy: 16, r: 0.6 }],
    ['circle', { cx: 12, cy: 16, r: 0.6 }],
    ['circle', { cx: 15, cy: 16, r: 0.6 }]
  ],
  compress: [
    ['path', { d: 'M4 9V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4' }],
    ['path', { d: 'M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4' }],
    ['line', { x1: 12, y1: 3, x2: 12, y2: 12 }],
    ['polyline', { points: '9 9 12 12 15 9' }]
  ],
  web: [
    ['circle', { cx: 12, cy: 12, r: 9 }],
    ['path', { d: 'M3 12h18' }],
    ['path', { d: 'M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18z' }]
  ],
  warn: [
    ['path', { d: 'M10.3 3.6 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0z' }],
    ['line', { x1: 12, y1: 9, x2: 12, y2: 13 }],
    ['line', { x1: 12, y1: 17, x2: 12.01, y2: 17 }]
  ],
  svg: [
    ['path', { d: 'M4 19c4-13 12-13 16 0' }],
    ['circle', { cx: 4, cy: 19, r: 2 }],
    ['circle', { cx: 20, cy: 19, r: 2 }],
    ['rect', { x: 10, y: 3, width: 4, height: 4, rx: 1 }]
  ],
  wifi: [
    ['path', { d: 'M5 12.5a10 10 0 0 1 14 0' }],
    ['path', { d: 'M8.5 16a5 5 0 0 1 7 0' }],
    ['line', { x1: 12, y1: 19.5, x2: 12.01, y2: 19.5 }],
    ['path', { d: 'M1.5 9a15 15 0 0 1 21 0' }]
  ],
  image: [
    ['rect', { x: 3, y: 3, width: 18, height: 18, rx: 2 }],
    ['circle', { cx: 9, cy: 9, r: 2 }],
    ['path', { d: 'M21 16l-4.5-4.5L10 18' }],
    ['path', { d: 'M3 17.5l4-4 3 3' }]
  ],
  cron: [
    ['rect', { x: 3, y: 4, width: 18, height: 17, rx: 2 }],
    ['line', { x1: 3, y1: 9, x2: 21, y2: 9 }],
    ['line', { x1: 8, y1: 2, x2: 8, y2: 5 }],
    ['line', { x1: 16, y1: 2, x2: 16, y2: 5 }],
    ['path', { d: 'M8 13h3' }],
    ['path', { d: 'M8 17h6' }]
  ],
  network: [
    ['rect', { x: 16, y: 16, width: 6, height: 6, rx: 1 }],
    ['rect', { x: 2, y: 16, width: 6, height: 6, rx: 1 }],
    ['rect', { x: 9, y: 2, width: 6, height: 6, rx: 1 }],
    ['path', { d: 'M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3' }],
    ['path', { d: 'M12 12V8' }]
  ],

  /* 界面图标 */
  search: [
    ['circle', { cx: 11, cy: 11, r: 7 }],
    ['line', { x1: 20.5, y1: 20.5, x2: 16.2, y2: 16.2 }]
  ],
  sliders: [
    ['line', { x1: 21, y1: 5, x2: 14, y2: 5 }],
    ['line', { x1: 10, y1: 5, x2: 3, y2: 5 }],
    ['line', { x1: 21, y1: 12, x2: 12, y2: 12 }],
    ['line', { x1: 8, y1: 12, x2: 3, y2: 12 }],
    ['line', { x1: 21, y1: 19, x2: 16, y2: 19 }],
    ['line', { x1: 12, y1: 19, x2: 3, y2: 19 }],
    ['line', { x1: 14, y1: 3, x2: 14, y2: 7 }],
    ['line', { x1: 8, y1: 10, x2: 8, y2: 14 }],
    ['line', { x1: 16, y1: 17, x2: 16, y2: 21 }]
  ],
  moon: [['path', { d: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z' }]],
  sun: [
    ['circle', { cx: 12, cy: 12, r: 4 }],
    ['line', { x1: 12, y1: 2, x2: 12, y2: 4 }],
    ['line', { x1: 12, y1: 20, x2: 12, y2: 22 }],
    ['line', { x1: 2, y1: 12, x2: 4, y2: 12 }],
    ['line', { x1: 20, y1: 12, x2: 22, y2: 12 }],
    ['line', { x1: 4.9, y1: 4.9, x2: 6.3, y2: 6.3 }],
    ['line', { x1: 17.7, y1: 17.7, x2: 19.1, y2: 19.1 }],
    ['line', { x1: 4.9, y1: 19.1, x2: 6.3, y2: 17.7 }],
    ['line', { x1: 17.7, y1: 6.3, x2: 19.1, y2: 4.9 }]
  ],
  copy: [
    ['rect', { x: 9, y: 9, width: 11, height: 11, rx: 2 }],
    ['path', { d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' }]
  ],
  check: [['path', { d: 'M20 6 9 17l-5-5' }]],
  close: [
    ['line', { x1: 18, y1: 6, x2: 6, y2: 18 }],
    ['line', { x1: 6, y1: 6, x2: 18, y2: 18 }]
  ],
  command: [
    ['path', {
      d: 'M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z'
    }]
  ],
  star: [
    ['path', { d: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z' }]
  ],
  back: [
    ['line', { x1: 19, y1: 12, x2: 5, y2: 12 }],
    ['polyline', { points: '12 19 5 12 12 5' }]
  ],
  /* 面板收起 / 展开（单尖括号，比双尖括号更安静） */
  collapse: [['polyline', { points: '14.5 5.5 9 12 14.5 18.5' }]],
  expand: [['polyline', { points: '9.5 5.5 15 12 9.5 18.5' }]],
  refresh: [
    ['path', { d: 'M21 12a9 9 0 1 1-2.6-6.4' }],
    ['polyline', { points: '21 3 21 9 15 9' }]
  ],
  download: [
    ['path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }],
    ['polyline', { points: '7 10 12 15 17 10' }],
    ['line', { x1: 12, y1: 15, x2: 12, y2: 3 }]
  ],
  play: [['polygon', { points: '6 4 20 12 6 20' }]],
  dot: [['circle', { cx: 12, cy: 12, r: 4 }]],

  /* 通用「全部工具」图标。品牌标志见下方 brandMark()，两者形状不同。 */
  toolbox: [
    ['rect', { x: 3, y: 9, width: 18, height: 11, rx: 2.5 }],
    ['path', { d: 'M8.5 9V7.5a3.5 3.5 0 0 1 7 0V9' }],
    ['line', { x1: 3, y1: 13, x2: 21, y2: 13 }]
  ]
};

export function icon(name, size = 16, strokeWidth = 1.8) {
  const spec = SPECS[name] || SPECS.dot;
  const svg = svgEl('svg', {
    viewBox: '0 0 24 24',
    width: size,
    height: size,
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': strokeWidth,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
    focusable: 'false',
    style: 'flex:0 0 auto;display:block'
  });
  for (const [tag, attrs] of spec) svg.appendChild(svgEl(tag, attrs));
  return svg;
}

export const ICON_NAMES = Object.keys(SPECS);

let brandMaskSeq = 0;

/** 品牌标志：单色匣体 + 镂空尖括号，与 icons/icon.svg 同形。
    用 mask 挖空而不是描边，保证任意背景下都是真正的单色。 */
export function brandMark(size = 16) {
  brandMaskSeq += 1;
  const maskId = `brand-cut-${brandMaskSeq}`;
  const svg = svgEl('svg', {
    viewBox: '0 0 128 128',
    width: size,
    height: size,
    'aria-hidden': 'true',
    focusable: 'false',
    style: 'flex:0 0 auto;display:block'
  });
  const defs = svgEl('defs');
  const mask = svgEl('mask', { id: maskId, maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: 128, height: 128 });
  mask.appendChild(svgEl('rect', { width: 128, height: 128, fill: '#fff' }));
  for (const d of ['M47 67 L33 80 L47 93', 'M81 67 L95 80 L81 93']) {
    mask.appendChild(svgEl('path', {
      d, fill: 'none', stroke: '#000', 'stroke-width': 10, 'stroke-linecap': 'round', 'stroke-linejoin': 'round'
    }));
  }
  defs.appendChild(mask);
  svg.appendChild(defs);

  const group = svgEl('g', { mask: `url(#${maskId})`, fill: 'currentColor' });
  group.appendChild(svgEl('rect', { x: 18, y: 48, width: 92, height: 64, rx: 13 }));
  const lid = svgEl('g', { transform: 'rotate(-6 64 29)' });
  lid.appendChild(svgEl('rect', { x: 14, y: 20, width: 100, height: 18, rx: 9 }));
  group.appendChild(lid);
  svg.appendChild(group);
  return svg;
}
