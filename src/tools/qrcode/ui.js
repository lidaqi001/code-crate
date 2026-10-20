/* 二维码工具界面层：canvas 预览 + SVG / PNG / 终端字符输出 */

import { h, mount, clear, $, debounce } from '../../core/dom.js';
import { mountTool } from '../../core/app.js';
import { icon } from '../../core/icons.js';
import { copy } from '../../core/clipboard.js';
import { read, write } from '../../core/storage.js';
import * as toast from '../../core/toast.js';
import * as logic from './logic.js';
import * as qrRender from '../../core/qr-render.js';

const STORAGE_ID = 'qrcode';
const PREVIEW_TARGET = 300;

const els = {};
const state = {
  content: read(`${STORAGE_ID}:content`, '') || 'https://example.com/codecrate',
  ecc: read(`${STORAGE_ID}:ecc`, 'M'),
  version: read(`${STORAGE_ID}:version`, 0),
  scale: read(`${STORAGE_ID}:scale`, 8),
  margin: read(`${STORAGE_ID}:margin`, 4),
  dark: read(`${STORAGE_ID}:dark`, '#000000'),
  light: read(`${STORAGE_ID}:light`, '#ffffff'),
  last: null
};

function persist() {
  write(`${STORAGE_ID}:content`, state.content);
  write(`${STORAGE_ID}:ecc`, state.ecc);
  write(`${STORAGE_ID}:version`, state.version);
  write(`${STORAGE_ID}:scale`, state.scale);
  write(`${STORAGE_ID}:margin`, state.margin);
  write(`${STORAGE_ID}:dark`, state.dark);
  write(`${STORAGE_ID}:light`, state.light);
}

/* ── 选项控件 ─────────────────────────────────────────────── */

function selectField(label, options, value, onChange) {
  const select = h('select', { 'aria-label': label },
    options.map((option) => h('option', { value: String(option.value), selected: String(option.value) === String(value) }, option.label))
  );
  select.value = String(value);
  select.addEventListener('change', () => onChange(select.value));
  return h('div', { class: 'field' }, h('label', { text: label }), select);
}

function numberField(label, value, { min, max, onChange }) {
  const input = h('input', { type: 'number', min: String(min), max: String(max), value: String(value), 'aria-label': label });
  input.addEventListener('input', () => {
    const next = Number(input.value);
    if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, Math.floor(next))));
  });
  return h('div', { class: 'field' }, h('label', { text: label }), input);
}

function colorField(label, value, onChange) {
  const input = h('input', { type: 'color', value, 'aria-label': label });
  input.addEventListener('input', () => onChange(input.value));
  return h('div', { class: 'field' }, h('label', { text: label }), input);
}

function buildOptions() {
  const box = $('#options');
  const versionOptions = [{ value: 0, label: '自动' }];
  for (let version = logic.MIN_VERSION; version <= logic.MAX_VERSION; version += 1) {
    versionOptions.push({ value: version, label: `版本 ${version}` });
  }

  mount(box,
    selectField('纠错等级', logic.ECC_LEVELS.map((level) => ({ value: level.id, label: level.label })), state.ecc, (value) => {
      state.ecc = value;
      persist();
      refresh();
    }),
    selectField('版本', versionOptions, state.version, (value) => {
      state.version = Number(value);
      persist();
      refresh();
    }),
    numberField('模块像素', state.scale, {
      min: 2,
      max: 24,
      onChange: (value) => {
        state.scale = value;
        persist();
        renderPreview();
      }
    }),
    numberField('静默区', state.margin, {
      min: 0,
      max: 10,
      onChange: (value) => {
        state.margin = value;
        persist();
        renderPreview();
      }
    }),
    colorField('前景', state.dark, (value) => {
      state.dark = value;
      persist();
      renderPreview();
    }),
    colorField('背景', state.light, (value) => {
      state.light = value;
      persist();
      renderPreview();
    })
  );
}

/* ── 预览绘制 ─────────────────────────────────────────────── */

function renderPreview() {
  const canvas = els.canvas;
  const wrap = $('#canvas-wrap');

  if (!state.last) {
    clear(wrap);
    return;
  }

  // 缩放与绘制交给共享模块，三个用到二维码的工具保持一致
  qrRender.drawQrToCanvas(canvas, state.last, {
    quietZone: state.margin,
    targetSize: PREVIEW_TARGET,
    preferredScale: state.scale,
    minScale: 2,
    dark: state.dark,
    light: state.light
  });
}

function renderMeta(result) {
  const box = $('#meta');
  if (!result) {
    clear(box);
    box.appendChild(h('div', { class: 'capacity-note' }, '输入内容后自动生成二维码'));
    return;
  }

  const used = result.bytes;
  const limit = logic.capacity(result.version, result.ecc, result.mode);
  const modeLabel = { numeric: '数字', alphanumeric: '字母数字', byte: '字节' }[result.mode];

  mount(box,
    h('div', { class: 'qr-stat' }, h('div', { class: 'k', text: '版本' }), h('div', { class: 'v', text: `v${result.version}` })),
    h('div', { class: 'qr-stat' }, h('div', { class: 'k', text: '尺寸' }), h('div', { class: 'v', text: `${result.matrixSize}×${result.matrixSize}` })),
    h('div', { class: 'qr-stat' }, h('div', { class: 'k', text: '纠错' }), h('div', { class: 'v', text: result.ecc })),
    h('div', { class: 'qr-stat' }, h('div', { class: 'k', text: '模式' }), h('div', { class: 'v', text: modeLabel })),
    h('div', { class: 'qr-stat' }, h('div', { class: 'k', text: '掩码' }), h('div', { class: 'v', text: String(result.mask) })),
    h('div', { class: 'qr-stat' }, h('div', { class: 'k', text: '占用' }), h('div', { class: 'v', text: `${used}/${limit}` }))
  );
}

/* ── 动作按钮 ─────────────────────────────────────────────── */

function addAction(box, label, iconName, run, { disabled = false } = {}) {
  const button = h('button', { class: 'btn btn-sm', type: 'button', disabled: disabled || undefined },
    icon(iconName, 12), h('span', { text: label }));
  button.addEventListener('click', run);
  box.appendChild(button);
}

function downloadPng() {
  if (!state.last) {
    toast.warn('还没有生成二维码');
    return;
  }
  els.canvas.toBlob((blob) => {
    if (!blob) {
      toast.fail('导出 PNG 失败');
      return;
    }
    const url = URL.createObjectURL(blob);
    const anchor = h('a', { href: url, download: `qrcode-v${state.last.version}-${state.last.ecc}.png` });
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.ok('已导出 PNG');
  }, 'image/png');
}

function svgText() {
  return logic.toSvg(state.last, { margin: state.margin, scale: 8, dark: state.dark, light: state.light });
}

function downloadSvg() {
  if (!state.last) {
    toast.warn('还没有生成二维码');
    return;
  }
  const blob = new Blob([svgText()], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = h('a', { href: url, download: `qrcode-v${state.last.version}-${state.last.ecc}.svg` });
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast.ok('已导出 SVG');
}

async function copySvg() {
  if (!state.last) {
    toast.warn('还没有生成二维码');
    return;
  }
  if (await copy(svgText())) toast.ok('SVG 已复制');
  else toast.fail('复制失败');
}

async function copyTerminal() {
  if (!state.last) {
    toast.warn('还没有生成二维码');
    return;
  }
  if (await copy(logic.toTerminal(state.last, { quietZone: Math.max(2, state.margin), useHalfBlocks: false }))) {
    toast.ok('已复制，可直接粘贴到终端或代码注释');
  } else {
    toast.fail('复制失败');
  }
}

function renderActions() {
  const box = $('#actions');
  clear(box);
  const has = Boolean(state.last);

  addAction(box, '复制内容', 'copy', async () => {
    if (await copy(state.content)) toast.ok('已复制内容');
    else toast.fail('复制失败');
  }, { disabled: !state.content });

  addAction(box, '复制 SVG', 'codec', copySvg, { disabled: !has });
  addAction(box, '复制字符画', 'text', copyTerminal, { disabled: !has });
  addAction(box, '下载 PNG', 'download', downloadPng, { disabled: !has });
  addAction(box, '下载 SVG', 'download', downloadSvg, { disabled: !has });
}

/* ── 主流程 ───────────────────────────────────────────────── */

function refresh() {
  state.content = els.content.value;
  persist();

  const status = $('#status');
  const hint = $('#spec-hint');
  const result = logic.encode(state.content, { ecc: state.ecc, version: state.version });

  if (!result.ok) {
    state.last = null;
    clear($('#canvas-wrap'));
    renderMeta(null);
    renderActions();
    status.className = 'panel-foot text-err';
    status.textContent = `✗ ${result.error}`;
    hint.textContent = '';
    return;
  }

  state.last = result;
  status.className = 'panel-foot';
  status.textContent = `已在 ${state.content.length} 个字符上生成二维码 · 版本 ${result.version} · ${result.matrixSize}×${result.matrixSize} 模块`;
  hint.textContent = `${result.mode === 'byte' ? '字节模式' : result.mode === 'numeric' ? '数字模式' : '字母数字模式'}`;

  $('#canvas-wrap').appendChild(els.canvas);
  renderPreview();
  renderMeta(result);
  renderActions();
}

/* ── 初始化 ───────────────────────────────────────────────── */

function init() {
  els.content = $('#content');
  els.canvas = $('#canvas');
  els.content.value = state.content;

  if (!logic.ECC_LEVELS.some((level) => level.id === state.ecc)) state.ecc = 'M';
  if (state.version && (state.version < logic.MIN_VERSION || state.version > logic.MAX_VERSION)) state.version = 0;

  buildOptions();

  els.content.addEventListener('input', debounce(refresh, 180));

  $('#status').className = 'panel-foot';

  mountTool({
    actions: [
      { id: 'download-png', label: '下载 PNG', icon: 'download', primary: true, keywords: 'png download 下载', run: downloadPng },
      { id: 'copy-svg', label: '复制 SVG', icon: 'copy', keywords: 'svg copy 复制', run: copySvg },
      { id: 'copy-terminal', label: '复制终端字符画', icon: 'text', keywords: 'terminal ascii 终端 字符画', run: copyTerminal },
      { id: 'download-svg', label: '下载 SVG', icon: 'download', keywords: 'svg download 下载', run: downloadSvg },
      {
        id: 'sample-url',
        label: '填入示例网址',
        icon: 'network',
        keywords: 'sample 示例',
        run: () => {
          els.content.value = 'https://example.com/codecrate';
          refresh();
        }
      },
      {
        id: 'clear',
        label: '清空内容',
        icon: 'close',
        keywords: 'clear 清空',
        run: () => {
          els.content.value = '';
          refresh();
        }
      }
    ]
  });

  refresh();
}

init();
