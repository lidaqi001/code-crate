/* 图片工具界面层：转换压缩 / 元数据 / 色盲模拟
 *
 * 纯计算（尺寸、EXIF、色彩矩阵）都在 logic 层完成，这里只负责
 * 读文件、喂 canvas、展示结果。 */

import { h, mount, clear, $, debounce } from '../../core/dom.js';
import { mountTool } from '../../core/app.js';
import { icon } from '../../core/icons.js';
import { copyButton, downloadText } from '../../core/widgets.js';
import { read, write } from '../../core/storage.js';
import * as toast from '../../core/toast.js';
import * as logic from './logic.js';

const STORAGE_ID = 'image';
const VISION_PREVIEW_MAX = 720;

const els = {};
const state = {
  mode: 'convert',
  sourceName: '',
  bytes: null,
  dataUri: '',
  image: null,
  info: null,
  exif: null,
  outputBlob: null,
  outputInfo: null,
  format: 'image/jpeg',
  quality: 0.85,
  resizeMode: 'scale',
  scale: 100,
  maxWidth: 1920,
  maxHeight: 1080,
  targetWidth: 800,
  exactWidth: 800,
  exactHeight: 600,
  visionType: 'deuteranopia',
  ...(read(`${STORAGE_ID}:state`, null) || {})
};

// 每次载入新图都要重置的字段
Object.assign(state, { bytes: null, dataUri: '', image: null, info: null, exif: null, outputBlob: null, outputInfo: null, sourceName: '' });

let renderToken = 0;

function persist() {
  const { format, quality, resizeMode, scale, maxWidth, maxHeight, targetWidth, exactWidth, exactHeight, visionType, mode } = state;
  write(`${STORAGE_ID}:state`, { format, quality, resizeMode, scale, maxWidth, maxHeight, targetWidth, exactWidth, exactHeight, visionType, mode });
}

/* ── 小部件 ───────────────────────────────────────────────── */

function field(labelText, control, { full = false } = {}) {
  return h('div', { class: `field${full ? ' full' : ''}` }, h('label', { text: labelText }), control);
}

function errorBox(message) {
  return h('div', { class: 'inline-error' }, icon('close', 13), h('span', { text: message }));
}

function section(title) {
  return h('div', { class: 'section-label', text: title });
}

function statRow(cells) {
  return h('div', { class: 'stat-row' },
    cells.map((cell) => h('div', { class: 'stat-cell' },
      h('div', { class: 'k', text: cell.k }),
      h('div', { class: `v${cell.tone ? ` ${cell.tone}` : ''}`, text: cell.v })
    ))
  );
}

function infoTable(rows) {
  const table = h('table', { class: 'info-table' },
    h('thead', {}, h('tr', {}, h('th', { class: 'col-label', text: '项目' }), h('th', { text: '值' }), h('th', { class: 'col-hint', text: '说明' })))
  );
  const body = h('tbody');
  for (const row of rows) {
    body.appendChild(h('tr', {},
      h('td', { class: 'col-label', text: row.label }),
      h('td', { class: 'col-value', text: row.value }),
      h('td', { class: 'col-hint', text: row.hint || '' })
    ));
  }
  table.appendChild(body);
  return table;
}

/* ── 载入图片 ─────────────────────────────────────────────── */

async function loadBytes(bytes, name) {
  const info = logic.parseImageInfo(bytes);
  if (!info.ok) {
    els.status.className = 'panel-foot text-err';
    els.status.textContent = `✗ ${info.reason}`;
    renderSourceInfo();
    renderPreview(errorBox(info.reason));
    return;
  }

  // 判断真实格式是否与扩展名一致 —— 伪装扩展名是很常见的问题
  const extensionMime = logic.mimeForExtension(String(name).split('.').pop() || '');
  const mismatch = extensionMime && extensionMime !== info.type.mime;

  const mime = info.type.mime;
  const dataUri = `data:${mime};base64,${bytesToBase64(bytes)}`;

  let image;
  try {
    image = await decodeImage(dataUri);
  } catch {
    els.status.className = 'panel-foot text-err';
    els.status.textContent = '✗ 浏览器无法解码这张图片（可能是损坏的文件或用了不支持的颜色配置）';
    renderSourceInfo();
    renderPreview(errorBox('浏览器无法解码这张图片'));
    return;
  }

  state.bytes = bytes;
  state.dataUri = dataUri;
  state.image = image;
  state.info = info;
  state.exif = logic.parseExif(bytes);
  state.sourceName = name || `image.${info.type.extension}`;
  state.outputBlob = null;
  state.outputInfo = null;

  els.status.className = 'panel-foot';
  els.status.textContent = `已载入 · ${info.type.label} · ${info.width} × ${info.height}`;

  if (mismatch) {
    els.foot.textContent = `⚠ 扩展名与真实格式不一致：文件是 ${info.type.label}，扩展名却指向 ${extensionMime}`;
  } else {
    els.foot.textContent = '';
  }

  renderSourceInfo();
  renderOptions();
  await renderPreview();
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function decodeImage(dataUri) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('decode failed'));
    image.src = dataUri;
  });
}

/* ── 来源信息 ─────────────────────────────────────────────── */

function renderSourceInfo() {
  const box = $('#source-info');
  clear(box);

  if (!state.info) {
    box.appendChild(h('div', { class: 'note' }, '还没有载入图片。可以从本地选择文件，或把 Base64 / Data URI 粘到上面再点「载入粘贴内容」。'));
    return;
  }

  const info = state.info;
  box.appendChild(h('div', { class: 'source-card' },
    h('div', { class: 'name', text: state.sourceName }),
    h('div', { class: 'meta', text: `${info.type.label} · ${info.width} × ${info.height} · ${logic.formatBytes(state.bytes.length)}` })
  ));

  box.appendChild(h('div', { class: 'note' },
    `尺寸与格式是直接读文件头得到的，没有解码整张图。`
  ));
}

/* ── 选项：转换 ───────────────────────────────────────────── */

function renderConvertOptions(container) {
  const formatSelect = h('select', { id: 'opt-format', 'aria-label': '输出格式' },
    logic.EXPORT_FORMATS.map((entry) => h('option', { value: entry.mime, selected: entry.mime === state.format }, entry.label))
  );
  formatSelect.value = state.format;
  formatSelect.addEventListener('change', () => {
    state.format = formatSelect.value;
    persist();
    renderOptions();
    renderPreview();
  });

  const qualityOutput = h('output', { text: state.quality.toFixed(2) });
  const qualityRange = h('input', {
    type: 'range', min: '0.1', max: '1', step: '0.05', value: String(state.quality), id: 'opt-quality', 'aria-label': '质量'
  });
  const qualityWrap = h('div', { class: 'range-row' }, qualityRange, qualityOutput);
  qualityRange.addEventListener('input', () => {
    qualityOutput.textContent = Number(qualityRange.value).toFixed(2);
  });
  qualityRange.addEventListener('change', debounce(() => {
    state.quality = Number(qualityRange.value);
    persist();
    renderPreview();
  }, 120));

  const modeSelect = h('select', { id: 'opt-mode', 'aria-label': '缩放方式' },
    logic.RESIZE_MODES.map((entry) => h('option', { value: entry.id, selected: entry.id === state.resizeMode }, entry.label))
  );
  modeSelect.value = state.resizeMode;
  modeSelect.addEventListener('change', () => {
    state.resizeMode = modeSelect.value;
    persist();
    renderOptions();
    renderPreview();
  });

  container.appendChild(h('div', { class: 'form-grid' },
    field('输出格式', formatSelect),
    field('缩放方式', modeSelect)
  ));

  // 质量只对有损格式有意义
  const format = logic.EXPORT_FORMATS.find((entry) => entry.mime === state.format);
  if (format && format.lossy) {
    container.appendChild(field('质量', qualityWrap, { full: true }));
  }

  const detail = h('div', { class: 'form-grid' });
  const numeric = (key, label, { min = 1, max = 16384 } = {}) => {
    const node = h('input', { type: 'number', min: String(min), max: String(max), value: String(state[key]), 'aria-label': label });
    node.addEventListener('input', debounce(() => {
      state[key] = Number(node.value);
      persist();
      renderPreview();
    }, 260));
    return field(label, node);
  };

  if (state.resizeMode === 'scale') {
    const percent = h('input', { type: 'range', min: '10', max: '300', step: '5', value: String(state.scale), 'aria-label': '缩放百分比' });
    const out = h('output', { text: `${state.scale}%` });
    percent.addEventListener('input', () => {
      out.textContent = `${percent.value}%`;
      state.scale = Number(percent.value);
      persist();
    });
    percent.addEventListener('change', debounce(() => renderPreview(), 120));
    detail.appendChild(field('缩放比例', h('div', { class: 'range-row' }, percent, out), { full: true }));
  } else if (state.resizeMode === 'fit') {
    detail.appendChild(numeric('maxWidth', '最大宽度'));
    detail.appendChild(numeric('maxHeight', '最大高度'));
  } else if (state.resizeMode === 'width') {
    detail.appendChild(numeric('targetWidth', '目标宽度'));
  } else {
    detail.appendChild(numeric('exactWidth', '目标宽度'));
    detail.appendChild(numeric('exactHeight', '目标高度'));
  }
  container.appendChild(detail);

  const target = state.info
    ? logic.computeTargetSize(state.info.width, state.info.height, state)
    : null;
  if (target) {
    container.appendChild(h('div', { class: 'note' },
      `输出尺寸：${target.width} × ${target.height}${target.changed ? '' : '（与原始一致）'}`
    ));
  }

  const notice = logic.hasAlphaNotice(state.format);
  if (notice) container.appendChild(h('div', { class: 'warn-note', text: notice }));

  const hint = logic.describeOutputFormat(state.format, state.quality);
  if (hint) container.appendChild(h('div', { class: 'note', text: hint }));
}

/* ── 选项：色盲模拟 ───────────────────────────────────────── */

function renderVisionOptions(container) {
  const select = h('select', { id: 'opt-vision', 'aria-label': '色觉类型' },
    logic.COLOR_VISION_TYPES.map((entry) => h('option', { value: entry.id, selected: entry.id === state.visionType }, entry.label))
  );
  select.value = state.visionType;
  select.addEventListener('change', () => {
    state.visionType = select.value;
    persist();
    renderPreview();
  });

  const current = logic.COLOR_VISION_TYPES.find((entry) => entry.id === state.visionType);
  container.appendChild(h('div', { class: 'form-grid' }, field('模拟类型', select, { full: true })));
  if (current) {
    container.appendChild(h('div', { class: 'note' }, `${current.note}${current.prevalence ? `　·　${current.prevalence}` : ''}`));
  }
  container.appendChild(h('div', { class: 'note' },
    '按 Machado 等（2009）的色觉缺陷矩阵逐像素变换；矩阵每行系数和为 1，所以黑白灰不会被改变。'
  ));
}

/* ── 选项与预览渲染 ───────────────────────────────────────── */

function renderOptions() {
  const box = $('#options');
  clear(box);

  if (!state.info) {
    box.appendChild(h('div', { class: 'note' }, '载入图片后这里会出现对应选项'));
    return;
  }

  if (state.mode === 'convert') renderConvertOptions(box);
  else if (state.mode === 'vision') renderVisionOptions(box);
  else box.appendChild(h('div', { class: 'note' }, '元数据直接从文件里的 EXIF 段读出，不需要额外设置。'));
}

/** 把图片画到 canvas 上，可选地应用色觉变换。 */
function drawToCanvas(image, width, height, { visionType = null, whiteBackground = false } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  if (whiteBackground) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
  }
  ctx.drawImage(image, 0, 0, width, height);

  if (visionType && visionType !== 'normal') {
    const data = ctx.getImageData(0, 0, width, height);
    const pixels = data.data;
    for (let i = 0; i < pixels.length; i += 4) {
      const [r, g, b] = logic.simulateColorVision([pixels[i], pixels[i + 1], pixels[i + 2]], visionType);
      pixels[i] = r;
      pixels[i + 1] = g;
      pixels[i + 2] = b;
    }
    ctx.putImageData(data, 0, 0);
  }

  return canvas;
}

function canvasToBlob(canvas, mime, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, mime, quality));
}

async function renderPreview(forcedContent) {
  const box = $('#preview');
  const token = ++renderToken;

  clear(box);

  if (forcedContent) {
    box.appendChild(forcedContent);
    renderActions(false);
    return;
  }

  if (!state.info || !state.image) {
    clear(els.foot);
    box.appendChild(h('div', { class: 'empty-note' },
      '还没有载入图片\n\n可以：\n· 点击「选择图片」从本地选一张\n· 粘贴 Base64 或 Data URI 后点「载入粘贴内容」'
    ));
    renderActions(false);
    return;
  }

  if (state.mode === 'meta') {
    renderMetaPreview(box);
    renderActions(true);
    return;
  }

  if (state.mode === 'vision') {
    const scale = Math.min(1, VISION_PREVIEW_MAX / Math.max(state.info.width, state.info.height));
    const width = Math.max(1, Math.round(state.info.width * scale));
    const height = Math.max(1, Math.round(state.info.height * scale));

    const stage = h('div', { class: 'preview-stage' });
    stage.appendChild(h('div', { class: 'empty-note', text: '正在计算…' }));
    box.appendChild(stage);

    // 让「正在计算」先渲染出来
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (token !== renderToken) return;

    const canvas = drawToCanvas(state.image, width, height, { visionType: state.visionType });
    clear(stage);
    stage.appendChild(canvas);

    const current = logic.COLOR_VISION_TYPES.find((entry) => entry.id === state.visionType);
    box.appendChild(h('div', { class: 'note' },
      `${current ? current.label : state.visionType} 效果 · 预览已缩放至 ${width} × ${height}`
    ));
    els.foot.textContent = '模拟只影响预览，不会改动原图';
    renderActions(true);
    return;
  }

  // 转换与压缩
  const target = logic.computeTargetSize(state.info.width, state.info.height, state);
  const format = logic.EXPORT_FORMATS.find((entry) => entry.mime === state.format);

  const stage = h('div', { class: 'preview-stage' });
  stage.appendChild(h('div', { class: 'empty-note', text: '正在转换…' }));
  box.appendChild(stage);

  await new Promise((resolve) => setTimeout(resolve, 0));
  if (token !== renderToken) return;

  const canvas = drawToCanvas(state.image, target.width, target.height, {
    whiteBackground: state.format === 'image/jpeg'
  });
  const blob = await canvasToBlob(canvas, state.format, state.quality);
  if (token !== renderToken) return;

  if (!blob) {
    clear(stage);
    stage.appendChild(errorBox('浏览器无法导出这个格式，请换一个输出格式'));
    renderActions(false);
    return;
  }

  state.outputBlob = blob;
  state.outputInfo = logic.describeConversion(state.bytes.length, blob.size);

  clear(stage);
  const preview = h('img', { alt: '转换结果预览', src: URL.createObjectURL(blob) });
  preview.addEventListener('load', () => URL.revokeObjectURL(preview.src), { once: true });
  stage.appendChild(preview);

  const info = state.outputInfo;
  box.appendChild(statRow([
    { k: '原始大小', v: logic.formatBytes(info.originalSize) },
    { k: '输出大小', v: logic.formatBytes(info.convertedSize) },
    {
      k: info.expanded ? '变大了' : '节省',
      v: `${Math.abs(info.percent).toFixed(1)}%`,
      tone: info.expanded ? 'warn' : 'good'
    },
    { k: '输出尺寸', v: `${target.width}×${target.height}` }
  ]));

  if (info.expanded) {
    box.appendChild(h('div', { class: 'warn-note' },
      '输出反而变大了。常见原因：原图已经是高度压缩的 JPEG，或者尺寸太小导致容器开销占比高。可以试试降低质量或换成 WebP。'
    ));
  }

  box.appendChild(h('div', { class: 'note' },
    `已转换为 ${format ? format.label : state.format}${format && format.lossy ? `（质量 ${state.quality}）` : '（无损）'}`
  ));

  els.foot.textContent = '转换在本地用 canvas 完成，图片不会被上传';
  renderActions(true);
}

/* ── 元数据预览 ───────────────────────────────────────────── */

function renderMetaPreview(box) {
  const info = state.info;
  const exif = state.exif;

  const stage = h('div', { class: 'preview-stage' });
  stage.appendChild(h('img', { alt: '原图预览', src: state.dataUri }));
  box.appendChild(stage);

  box.appendChild(section('文件'));
  const fileRows = [
    { label: '格式', value: info.type.label, hint: info.type.mime },
    { label: '尺寸', value: `${info.width} × ${info.height}` },
    { label: '宽高比', value: (info.width / info.height).toFixed(3) },
    { label: '总像素', value: (info.width * info.height).toLocaleString('en-US') },
    { label: '文件大小', value: logic.formatBytes(state.bytes.length) },
    { label: '透明通道', value: info.type.alpha ? '支持' : '不支持' },
    { label: '有损压缩', value: info.type.lossy ? '是' : '否' }
  ];
  if (info.details && info.details.bitDepth) fileRows.push({ label: '位深', value: `${info.details.bitDepth} 位` });
  if (info.details && info.details.components) fileRows.push({ label: '通道数', value: String(info.details.components) });
  box.appendChild(infoTable(fileRows));

  box.appendChild(section('EXIF'));
  if (!exif || !exif.found) {
    box.appendChild(h('div', { class: 'note' }, (exif && exif.reason) || '没有可显示的 EXIF 信息'));
  } else {
    if (exif.byteOrder) {
      box.appendChild(h('div', { class: 'note' }, `字节序：${exif.byteOrder} · 读取到 ${exif.exifTagCount} 个标签`));
    }
    box.appendChild(infoTable(exif.tags.map((tag) => ({ label: tag.label, value: tag.value, hint: tag.hint }))));

    if (exif.gps) {
      box.appendChild(section('位置'));
      if (exif.gps.latitude !== null) {
        box.appendChild(infoTable([
          { label: '纬度', value: String(exif.gps.latitude) },
          { label: '经度', value: String(exif.gps.longitude) },
          { label: '海拔', value: exif.gps.altitude === null ? '未记录' : `${exif.gps.altitude} m` }
        ]));
        const link = h('a', { class: 'gps-link', href: exif.gps.mapsUrl, target: '_blank', rel: 'noopener noreferrer' }, '在地图上查看');
        box.appendChild(h('div', { style: { marginTop: '8px' } }, link));
      } else {
        box.appendChild(h('div', { class: 'note' }, '有 GPS 段，但经纬度不完整'));
      }
      box.appendChild(h('div', { class: 'warn-note' },
        '这张照片记录了拍摄位置。发布到网上之前，建议先清除 EXIF，否则任何人都能查到拍摄地点。'
      ));
    }
  }

  els.foot.textContent = 'EXIF 直接从 JPEG 的 APP1 段解析，不依赖任何第三方库';
}

/* ── 动作 ─────────────────────────────────────────────────── */

function renderActions(hasOutput) {
  const box = $('#actions');
  clear(box);

  if (!hasOutput || !state.info) return;

  if (state.mode === 'convert' && state.outputBlob) {
    const downloadButton = h('button', { class: 'btn btn-sm', type: 'button' }, icon('download', 12), h('span', { text: '下载转换结果' }));
    downloadButton.addEventListener('click', () => {
      if (!state.outputBlob) {
        toast.warn('还没有可下载的结果');
        return;
      }
      const filename = logic.suggestFilename(state.sourceName, state.format);
      const url = URL.createObjectURL(state.outputBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
      toast.ok(`已导出 ${filename}`);
    });
    box.appendChild(downloadButton);
  }

  if (state.mode === 'meta') {
    const rows = (state.exif && state.exif.tags) || [];
    if (rows.length) {
      const text = rows.map((tag) => `${tag.label}: ${tag.value}${tag.hint ? ` (${tag.hint})` : ''}`).join('\n');
      box.appendChild(copyButton(() => text, { label: '复制 EXIF', title: '复制 EXIF 文本' }));
      const downloadButton = h('button', { class: 'btn btn-sm', type: 'button' }, icon('download', 12), h('span', { text: '导出文本' }));
      downloadButton.addEventListener('click', () => {
        downloadText('exif.txt', text, 'text/plain;charset=utf-8');
        toast.ok('已导出');
      });
      box.appendChild(downloadButton);
    }

    // 导出「清除 EXIF」的版本：用 canvas 重新编码天然丢弃所有元数据
    const stripButton = h('button', { class: 'btn btn-sm', type: 'button' }, '导出无 EXIF 版本');
    stripButton.addEventListener('click', async () => {
      const canvas = drawToCanvas(state.image, state.info.width, state.info.height, { whiteBackground: false });
      const blob = await canvasToBlob(canvas, 'image/png', 1);
      if (!blob) {
        toast.fail('导出失败');
        return;
      }
      const filename = logic.suggestFilename(state.sourceName, 'image/png');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
      toast.ok(`已导出 ${filename}（EXIF 已清除）`);
    });
    box.appendChild(stripButton);
  }

  if (state.mode === 'vision') {
    const downloadButton = h('button', { class: 'btn btn-sm', type: 'button' }, icon('download', 12), h('span', { text: '下载模拟图' }));
    downloadButton.addEventListener('click', () => {
      const canvas = $('.preview-stage canvas');
      if (!canvas) {
        toast.warn('还没有模拟结果');
        return;
      }
      canvas.toBlob((blob) => {
        if (!blob) {
          toast.fail('导出失败');
          return;
        }
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `vision-${state.visionType}.png`;
        link.click();
        URL.revokeObjectURL(url);
        toast.ok('已导出');
      }, 'image/png');
    });
    box.appendChild(downloadButton);
  }
}

/* ── 渲染与初始化 ─────────────────────────────────────────── */

function render() {
  for (const tab of els.modes.querySelectorAll('[role="tab"]')) {
    tab.setAttribute('aria-selected', String(tab.dataset.mode === state.mode));
  }
  $('#options-title').textContent = state.mode === 'convert' ? '转换选项' : state.mode === 'vision' ? '模拟选项' : '说明';
  renderSourceInfo();
  renderOptions();
  renderPreview();
}

function init() {
  els.modes = $('#modes');
  els.status = $('#status');
  els.foot = $('#foot');

  if (!['convert', 'meta', 'vision'].includes(state.mode)) state.mode = 'convert';
  if (!logic.EXPORT_FORMATS.some((entry) => entry.mime === state.format)) state.format = 'image/jpeg';

  for (const tab of els.modes.querySelectorAll('[role="tab"]')) {
    tab.addEventListener('click', () => {
      state.mode = tab.dataset.mode;
      persist();
      render();
    });
  }

  $('#file').addEventListener('change', async (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      els.status.className = 'panel-foot text-err';
      els.status.textContent = '✗ 这不是图片文件';
      return;
    }
    const buffer = await file.arrayBuffer();
    await loadBytes(new Uint8Array(buffer), file.name);
  });

  $('#paste').addEventListener('input', debounce(() => {
    // 粘贴后自动尝试载入，减少一次点击
    const text = $('#paste').value.trim();
    if (text.length > 64 && (text.startsWith('data:') || /^[A-Za-z0-9+/=\s]+$/.test(text))) {
      loadFromPaste();
    }
  }, 700));

  $('#btn-load-paste').addEventListener('click', loadFromPaste);

  $('#btn-clear').addEventListener('click', () => {
    Object.assign(state, { bytes: null, dataUri: '', image: null, info: null, exif: null, outputBlob: null, outputInfo: null, sourceName: '' });
    $('#paste').value = '';
    $('#file').value = '';
    els.foot.textContent = '';
    render();
  });

  mountTool({
    actions: [
      { id: 'mode-convert', label: '转换与压缩', icon: 'svg', primary: true, keywords: 'convert compress 转换 压缩', run: () => switchMode('convert') },
      { id: 'mode-meta', label: '查看元数据', icon: 'search', keywords: 'exif meta 元数据 信息', run: () => switchMode('meta') },
      { id: 'mode-vision', label: '色盲模拟', icon: 'color', keywords: 'vision colorblind 色盲 色觉', run: () => switchMode('vision') },
      { id: 'pick', label: '选择图片文件', icon: 'download', keywords: 'file open 选择 打开', run: () => $('#file').click() },
      {
        id: 'to-webp',
        label: '转成 WebP',
        icon: 'converter',
        keywords: 'webp convert',
        run: () => {
          state.format = 'image/webp';
          state.mode = 'convert';
          persist();
          render();
        }
      },
      {
        id: 'half',
        label: '缩放到 50%',
        icon: 'sliders',
        keywords: 'resize scale 50 缩放',
        run: () => {
          state.resizeMode = 'scale';
          state.scale = 50;
          state.mode = 'convert';
          persist();
          render();
        }
      }
    ]
  });

  render();
}

function switchMode(mode) {
  state.mode = mode;
  persist();
  render();
}

async function loadFromPaste() {
  const text = $('#paste').value;
  const normalized = logic.normalizeImageInput(text);
  if (!normalized.ok) {
    els.status.className = 'panel-foot text-err';
    els.status.textContent = `✗ ${normalized.error}`;
    return;
  }

  let bytes;
  try {
    const binary = atob(normalized.base64);
    bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    els.status.className = 'panel-foot text-err';
    els.status.textContent = '✗ Base64 解码失败';
    return;
  }

  await loadBytes(bytes, 'pasted-image');
}

init();
