/* 图片工具 —— 纯逻辑层。
 *
 * 这里只做与像素无关的计算：尺寸换算、色彩矩阵、Data URI 解析、文件命名。
 * 真正的解码与导出由界面层交给 canvas 完成，因此这一层可以在 Node 下完整测试。
 */

import { extensionForMime as extensionFor } from './sniff.js';

export {
  sniffImageType,
  parseImageInfo,
  mimeForExtension,
  extensionForMime,
  EXPORT_FORMATS,
  MIME_BY_EXTENSION
} from './sniff.js';

export { parseExif, dmsToDecimal, ORIENTATION_LABELS } from './exif.js';

/* ── 尺寸换算 ─────────────────────────────────────────────── */

export const RESIZE_MODES = [
  { id: 'scale', label: '按百分比缩放' },
  { id: 'fit', label: '限制在指定范围内' },
  { id: 'width', label: '固定宽度' },
  { id: 'exact', label: '指定宽高（可能变形）' }
];

const MAX_DIMENSION = 16384;

function clampDimension(value) {
  const size = Math.round(Number(value));
  if (!Number.isFinite(size)) return 1;
  return Math.max(1, Math.min(MAX_DIMENSION, size));
}

/**
 * 计算目标尺寸。保持宽高比时按四舍五入取整，但若因此出现 0 会兜底成 1。
 * @returns {{width:number, height:number, changed:boolean, ratio:number}}
 */
export function computeTargetSize(width, height, options = {}) {
  const sourceWidth = clampDimension(width);
  const sourceHeight = clampDimension(height);
  const mode = RESIZE_MODES.some((entry) => entry.id === options.mode) ? options.mode : 'scale';
  const aspect = sourceWidth / sourceHeight;

  let targetWidth = sourceWidth;
  let targetHeight = sourceHeight;

  if (mode === 'scale') {
    const percent = Number.isFinite(Number(options.scale)) ? Number(options.scale) : 100;
    const factor = Math.max(1, Math.min(1000, percent)) / 100;
    targetWidth = clampDimension(sourceWidth * factor);
    targetHeight = clampDimension(sourceHeight * factor);
  } else if (mode === 'fit') {
    const maxWidth = clampDimension(options.maxWidth || sourceWidth);
    const maxHeight = clampDimension(options.maxHeight || sourceHeight);
    const factor = Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight, 1);
    targetWidth = clampDimension(sourceWidth * factor);
    targetHeight = clampDimension(sourceHeight * factor);
  } else if (mode === 'width') {
    targetWidth = clampDimension(options.targetWidth || sourceWidth);
    targetHeight = clampDimension(targetWidth / aspect);
  } else {
    targetWidth = clampDimension(options.exactWidth || sourceWidth);
    targetHeight = clampDimension(options.exactHeight || sourceHeight);
  }

  return {
    width: targetWidth,
    height: targetHeight,
    changed: targetWidth !== sourceWidth || targetHeight !== sourceHeight,
    ratio: targetWidth / targetHeight,
    aspectKept: mode !== 'exact' ? Math.abs(targetWidth / targetHeight - aspect) < 0.02 : false
  };
}

/** 常见的缩放宽高预设。 */
export const SIZE_PRESETS = [
  { id: 'original', label: '原始尺寸', width: 0, height: 0 },
  { id: '1920', label: '1920 × 1080', width: 1920, height: 1080 },
  { id: '1280', label: '1280 × 720', width: 1280, height: 720 },
  { id: '800', label: '800 × 600', width: 800, height: 600 },
  { id: '512', label: '512 × 512', width: 512, height: 512 },
  { id: '256', label: '256 × 256', width: 256, height: 256 }
];

export const QUALITY_PRESETS = [
  { value: 0.95, label: '0.95（几乎无损）' },
  { value: 0.85, label: '0.85（推荐）' },
  { value: 0.7, label: '0.7（明显变小）' },
  { value: 0.5, label: '0.5（小图预览）' }
];

/* ── 色觉模拟 ─────────────────────────────────────────────── */

/**
 * 色觉缺陷模拟矩阵（Machado 等，2009，强度 1.0）。
 * 每一行的三个系数之和为 1，因此白色仍然映射为白色 —— 这是这类矩阵必须满足的性质。
 */
export const COLOR_MATRICES = {
  protanopia: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deuteranopia: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.011820, 0.042940, 0.968881],
  tritanopia: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.303900],
  // 全色盲按 Rec.709 亮度权重压成灰度
  achromatopsia: [0.2126, 0.7152, 0.0722, 0.2126, 0.7152, 0.0722, 0.2126, 0.7152, 0.0722]
};

export const COLOR_VISION_TYPES = [
  { id: 'normal', label: '正常视力', note: '作为对照，不做变换', prevalence: '' },
  { id: 'protanopia', label: '红色盲', note: '难以区分红与绿，红色显得暗', prevalence: '约 1% 男性' },
  { id: 'deuteranopia', label: '绿色盲', note: '最常见的色觉缺陷，红绿难分', prevalence: '约 1% 男性' },
  { id: 'tritanopia', label: '蓝色盲', note: '蓝与绿、黄与粉难分', prevalence: '约 0.01%' },
  { id: 'achromatopsia', label: '全色盲', note: '只能看到明暗', prevalence: '约 0.003%' }
];

/** 对单个 RGB 三元组应用 3×3 矩阵，结果截断到 0-255。 */
export function applyColorMatrix(rgb, matrix) {
  if (!Array.isArray(rgb) || rgb.length < 3) throw new Error('需要一个 [r, g, b] 数组');
  if (!Array.isArray(matrix) || matrix.length !== 9) throw new Error('矩阵需要 9 个系数');

  const [r, g, b] = rgb;
  const out = [
    matrix[0] * r + matrix[1] * g + matrix[2] * b,
    matrix[3] * r + matrix[4] * g + matrix[5] * b,
    matrix[6] * r + matrix[7] * g + matrix[8] * b
  ];
  return out.map((value) => Math.max(0, Math.min(255, Math.round(value))));
}

export function simulateColorVision(rgb, type) {
  if (type === 'normal') return [rgb[0], rgb[1], rgb[2]];
  const matrix = COLOR_MATRICES[type];
  if (!matrix) throw new Error(`未知的色觉类型：${type}`);
  return applyColorMatrix(rgb, matrix);
}

/**
 * 判断一个矩阵是否保持白色不变（每行系数和为 1）。
 * 容差取 1e-4：这些矩阵公开发表时系数只精确到小数点后 6 位，
 * 行和本身就有约 1e-6 的舍入误差，用更严的容差会把正确的矩阵判成错的。
 */
export function isWhitePreserving(matrix, tolerance = 1e-4) {
  for (let row = 0; row < 3; row += 1) {
    const sum = matrix[row * 3] + matrix[row * 3 + 1] + matrix[row * 3 + 2];
    if (Math.abs(sum - 1) > tolerance) return false;
  }
  return true;
}

/* ── Data URI 与 Base64 ───────────────────────────────────── */

export function parseDataUri(text) {
  const source = String(text ?? '').trim();
  const match = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(source);
  if (!match) return null;
  return {
    mime: match[1] || 'text/plain',
    base64: Boolean(match[2]),
    payload: match[3]
  };
}

export function toDataUri(base64, mime = 'image/png') {
  const clean = String(base64 ?? '').replace(/\s+/g, '');
  if (clean === '') throw new Error('Base64 内容为空');
  return `data:${mime};base64,${clean}`;
}

/**
 * 把用户输入（纯 Base64 或完整 Data URI）整理成可直接交给 <img> 的地址。
 * @returns {{ok:true, dataUri:string, mime:string, base64:string}|{ok:false, error:string}}
 */
export function normalizeImageInput(text, fallbackMime = 'image/png') {
  const source = String(text ?? '').trim();
  if (source === '') return { ok: false, error: '输入为空' };

  const parsed = parseDataUri(source);
  if (parsed) {
    if (!parsed.base64) return { ok: false, error: '只支持 base64 编码的 Data URI' };
    const clean = parsed.payload.replace(/\s+/g, '');
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) return { ok: false, error: 'Data URI 里的 Base64 含非法字符' };
    return { ok: true, dataUri: source.replace(/\s+/g, ''), mime: parsed.mime, base64: clean };
  }

  const clean = source.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) {
    return { ok: false, error: '既不是 Data URI，也不是合法的 Base64' };
  }
  if (clean.length % 4 === 1) return { ok: false, error: 'Base64 长度非法' };

  return { ok: true, dataUri: `data:${fallbackMime};base64,${clean}`, mime: fallbackMime, base64: clean };
}

/* ── 文件命名 ─────────────────────────────────────────────── */

/** 依据目标格式替换扩展名，例如 photo.png + image/jpeg → photo.jpg */
export function suggestFilename(original, mime) {
  const extension = extensionFor(mime) || 'bin';

  let name = String(original ?? '').trim().replace(/^.*[\\/]/, '');
  if (name === '') return `image.${extension}`;

  const dot = name.lastIndexOf('.');
  if (dot > 0) name = name.slice(0, dot);

  // 去掉可能引起问题的字符
  name = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').slice(0, 80);
  if (name === '') name = 'image';

  return `${name}.${extension}`;
}

export function formatBytes(value) {
  const size = Number(value) || 0;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(2)} MB`;
}

/** 压缩结果概览：省了多少、是否反而变大。 */
export function describeConversion(originalSize, convertedSize) {
  const before = Number(originalSize) || 0;
  const after = Number(convertedSize) || 0;
  const ratio = before === 0 ? 0 : after / before;
  return {
    originalSize: before,
    convertedSize: after,
    ratio,
    percent: before === 0 ? 0 : (1 - ratio) * 100,
    savedBytes: before - after,
    expanded: after > before
  };
}

/** 输出格式在给定质量下的说明，用于界面提示。 */
export function describeOutputFormat(mime, quality) {
  const map = {
    'image/png': 'PNG 是无损格式，质量参数对它不起作用，只能靠缩小尺寸来减小体积',
    'image/jpeg': `JPEG 质量 ${quality}，数值越低体积越小但伪影越明显；透明区域会被填成白色背景`,
    'image/webp': `WebP 质量 ${quality}，同等画质下通常比 JPEG 小 25%-35%，且支持透明`
  };
  return map[mime] || '';
}

/** 透明像素在 JPEG 下会变黑，提前提醒。 */
export function hasAlphaNotice(mime) {
  return mime === 'image/jpeg' ? '注意：JPEG 不支持透明，透明区域会被自动填成白色；需要保留透明请选 PNG 或 WebP' : '';
}
