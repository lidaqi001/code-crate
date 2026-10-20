/* Code 128-B 条码界面层：输入即时生成 SVG 预览，可导出 SVG / PNG。 */

import { h, mount, clear, $, debounce } from '../../core/dom.js';
import { mountTool } from '../../core/app.js';
import { icon } from '../../core/icons.js';
import { copyButton, downloadText, field } from '../../core/widgets.js';
import { read, write } from '../../core/storage.js';
import * as toast from '../../core/toast.js';
import * as logic from './logic.js';

const STORAGE_ID = 'barcode';
const SAMPLE = 'CODECRATE-128';

const saved = read(`${STORAGE_ID}:state`, null) || {};
const state = {
  text: typeof saved.text === 'string' ? saved.text : SAMPLE,
  moduleWidth: Math.min(6, Math.max(1, Number(saved.moduleWidth) || 2)),
  height: Math.min(200, Math.max(40, Number(saved.height) || 90)),
  quietZone: Number.isFinite(Number(saved.quietZone))
    ? Math.min(40, Math.max(0, Math.trunc(Number(saved.quietZone))))
    : 10,
  showText: saved.showText !== false
};

const els = {};
let currentSvg = '';

function persist() {
  write(`${STORAGE_ID}:state`, state);
}

/* ── 表单 ─────────────────────────────────────────────────── */

function rangeRow(id, value, min, max, label, onChange) {
  const output = h('output', { text: String(value) });
  const range = h('input', {
    type: 'range',
    id,
    min: String(min),
    max: String(max),
    value: String(value),
    'aria-label': label
  });
  range.addEventListener('input', () => {
    output.textContent = range.value;
    onChange(Number(range.value));
  });
  return h('div', { class: 'range-row' }, range, output);
}

function renderForm() {
  clear(els.form);

  const textarea = h('textarea', {
    class: 'mono barcode-text',
    id: 'barcode-text',
    spellcheck: 'false',
    maxlength: String(logic.MAX_TEXT_LENGTH),
    'aria-label': '条码内容'
  });
  textarea.value = state.text;
  textarea.addEventListener('input', debounce(() => {
    state.text = textarea.value;
    persist();
    renderPreview();
  }, 150));

  els.form.appendChild(h('div', { class: 'section-label first' }, '内容'));
  els.form.appendChild(h('div', { class: 'field' },
    h('label', { for: 'barcode-text', text: '条码内容（ASCII 32–126）' }),
    textarea
  ));

  els.form.appendChild(h('div', { class: 'section-label' }, '尺寸'));
  els.form.appendChild(h('div', { class: 'form-grid' },
    field('模块宽度', rangeRow('module-width', state.moduleWidth, 1, 6, '模块宽度', (value) => {
      state.moduleWidth = value;
      persist();
      renderPreview();
    })),
    field('高度', rangeRow('barcode-height', state.height, 40, 200, '条码高度', (value) => {
      state.height = value;
      persist();
      renderPreview();
    })),
    field('静区', rangeRow('quiet-zone', state.quietZone, 0, 40, '静区宽度', (value) => {
      state.quietZone = value;
      persist();
      renderPreview();
    }))
  ));

  const showText = h('input', { type: 'checkbox', id: 'show-text', checked: state.showText });
  showText.addEventListener('change', () => {
    state.showText = showText.checked;
    persist();
    renderPreview();
  });
  els.form.appendChild(h('div', { class: 'field' },
    h('label', { class: 'toggle', for: 'show-text' }, showText, h('span', { text: '在条码下方显示内容' }))
  ));

  els.form.appendChild(h('div', { class: 'note' },
    '使用 Code 128-B：支持 ASCII 32–126，自动计算校验位。条码完全在本地生成。'
  ));
}

/* ── 预览与导出 ───────────────────────────────────────────── */

function renderPreview() {
  clear(els.preview);
  currentSvg = '';

  try {
    const encoded = logic.encodeCode128B(state.text);
    currentSvg = logic.toSvg(state.text, state);
    const dataUri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(currentSvg)}`;

    const img = h('img', {
      class: 'barcode-img',
      src: dataUri,
      alt: `Code 128 条码：${state.text}`
    });

    els.preview.appendChild(h('div', { class: 'preview-stage' }, img));
    els.preview.appendChild(h('div', { class: 'preview-meta' },
      h('span', { text: `${encoded.moduleCount} 个模块 · 校验位 ${encoded.checksum} · 符号 ${encoded.values.length} 个` })
    ));

    els.status.className = 'panel-foot';
    els.status.textContent = `${state.text.length} 个字符 · 已生成`;
    els.foot.textContent = '导出 PNG 时按当前模块宽度绘制，适合直接用于打印或标签。';
  } catch (error) {
    els.preview.appendChild(h('div', { class: 'inline-error' }, icon('warn', 14), h('span', { text: error.message })));
    els.status.className = 'panel-foot text-err';
    els.status.textContent = `✗ ${error.message}`;
    els.foot.textContent = '';
  }
}

function downloadPng() {
  let encoded;
  try {
    encoded = logic.encodeCode128B(state.text);
  } catch (error) {
    toast.fail(error.message);
    return;
  }

  const width = (encoded.moduleCount + state.quietZone * 2) * state.moduleWidth;
  const height = state.height;
  const barHeight = state.showText ? Math.max(10, height - 16) : height;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#000000';
  for (const run of logic.barRuns(encoded.modules)) {
    ctx.fillRect((state.quietZone + run.start) * state.moduleWidth, 0, run.length * state.moduleWidth, barHeight);
  }
  if (state.showText) {
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(state.text, width / 2, height - 4);
  }

  canvas.toBlob((blob) => {
    if (!blob) {
      toast.fail('PNG 导出失败');
      return;
    }
    const url = URL.createObjectURL(blob);
    const anchor = h('a', { href: url, download: 'barcode.png' });
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.ok('已导出 barcode.png');
  }, 'image/png');
}

function downloadSvg() {
  if (!currentSvg) {
    toast.warn('还没有可导出的条码');
    return;
  }
  downloadText('barcode.svg', currentSvg, 'image/svg+xml;charset=utf-8');
  toast.ok('已导出 barcode.svg');
}

/* ── 初始化 ───────────────────────────────────────────────── */

function init() {
  els.form = $('#form');
  els.preview = $('#preview');
  els.status = $('#status');
  els.foot = $('#foot');
  els.actions = $('#actions');

  $('#btn-sample').addEventListener('click', () => {
    state.text = SAMPLE;
    persist();
    renderForm();
    renderPreview();
    toast.ok('已载入示例');
  });

  mount(els.actions,
    copyButton(() => currentSvg, { label: '复制 SVG' }),
    h('button', { class: 'btn btn-sm', type: 'button', onclick: downloadSvg }, icon('download', 12), h('span', { text: 'SVG' })),
    h('button', { class: 'btn btn-sm', type: 'button', onclick: downloadPng }, icon('download', 12), h('span', { text: 'PNG' }))
  );

  mountTool({
    actions: [
      { id: 'download-svg', label: '下载 SVG', icon: 'download', primary: true, keywords: 'svg download 下载', run: downloadSvg },
      { id: 'download-png', label: '下载 PNG', icon: 'download', keywords: 'png download 下载', run: downloadPng },
      { id: 'copy-svg', label: '复制 SVG', icon: 'copy', keywords: 'copy 复制 svg', run: () => copyButton(() => currentSvg).click() },
      { id: 'sample', label: '载入示例', icon: 'star', keywords: 'sample 示例', run: () => $('#btn-sample').click() }
    ]
  });

  renderForm();
  renderPreview();
}

init();
