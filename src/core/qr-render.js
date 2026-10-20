/* 二维码 canvas 绘制 —— 供二维码、动态口令、Wi-Fi 三个工具共用。
   只负责把编码结果画到 canvas 上，不做任何编码计算。 */

import { toMatrix2D } from './qrcode.js';

/**
 * 计算每个模块的像素边长。
 * 优先使用调用方指定的 scale，但不会小于 minScale，也不会大到超出 targetSize。
 */
export function computeScale(dimension, { preferredScale = 0, targetSize = 180, minScale = 2 } = {}) {
  const fit = Math.max(1, Math.floor(targetSize / dimension));
  if (preferredScale > 0) return Math.min(preferredScale, Math.max(fit, minScale));
  return Math.max(minScale, fit);
}

/**
 * 把二维码画到 canvas 上。
 * @param {HTMLCanvasElement} canvas
 * @param {object} result qrcode.js 的 encode() 结果
 * @returns {{pixels:number, dimension:number, scale:number}|null}
 */
export function drawQrToCanvas(canvas, result, options = {}) {
  const {
    quietZone = 4,
    targetSize = 180,
    preferredScale = 0,
    minScale = 2,
    dark = '#000000',
    light = '#ffffff',
    maxDevicePixelRatio = 3
  } = options;

  if (!canvas || !result || !result.ok) return null;

  const grid = toMatrix2D(result, { quietZone });
  const dimension = grid.length;
  const scale = computeScale(dimension, { preferredScale, targetSize, minScale });
  const pixels = dimension * scale;
  const dpr = Math.min(window.devicePixelRatio || 1, maxDevicePixelRatio);

  canvas.width = pixels * dpr;
  canvas.height = pixels * dpr;
  canvas.style.width = `${pixels}px`;
  canvas.style.height = `${pixels}px`;

  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, pixels, pixels);
  ctx.fillStyle = dark;

  for (let y = 0; y < dimension; y += 1) {
    const row = grid[y];
    for (let x = 0; x < dimension; x += 1) {
      if (row[x]) ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }

  return { pixels, dimension, scale };
}

/** 新建一个已绘制好的 canvas。 */
export function createQrCanvas(result, options = {}) {
  const canvas = document.createElement('canvas');
  const info = drawQrToCanvas(canvas, result, options);
  return info ? canvas : null;
}

/** 把 canvas 导出为 PNG 并触发下载。 */
export function downloadCanvasPng(canvas, filename) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        resolve(false);
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
      resolve(true);
    }, 'image/png');
  });
}
