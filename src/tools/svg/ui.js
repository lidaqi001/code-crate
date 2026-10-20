/* SVG 占位图界面层 */

import { h, mount, clear, $, debounce } from '../../core/dom.js';
import { mountTool } from '../../core/app.js';
import { icon } from '../../core/icons.js';
import { copyButton, downloadText } from '../../core/widgets.js';
import { read, write } from '../../core/storage.js';
import * as toast from '../../core/toast.js';
import * as logic from './logic.js';

const STORAGE_ID = 'svg';

const els = {};
const state = {
  width: 600,
  height: 400,
  background: '#1f2937',
  backgroundEnd: '',
  foreground: '#64748b',
  text: '600 × 400',
  textColor: '#e5e7eb',
  fontSize: 0,
  pattern: 'solid',
  radius: 0,
  circle: false,
  ...(read(`${STORAGE_ID}:state`, null) || {})
};

let lastSvg = '';
let outputTab = 'source';

function persist() {
  write(`${STORAGE_ID}:state`, state);
}

/* ── 小部件 ───────────────────────────────────────────────── */

function field(labelText, control, { full = false } = {}) {
  return h('div', { class: `field${full ? ' full' : ''}` }, h('label', { text: labelText }), control);
}

function colorField(key) {
  const picker = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(state[key]) ? state[key] : '#000000', 'aria-label': `${key} 取色` });
  const text = h('input', { type: 'text', value: state[key], spellcheck: 'false', 'aria-label': `${key} 颜色值` });

  const sync = (value, source) => {
    state[key] = value;
    persist();
    if (source !== 'picker') picker.value = /^#[0-9a-f]{6}$/i.test(value) ? value : picker.value;
    if (source !== 'text') text.value = value;
    render();
  };

  picker.addEventListener('input', () => sync(picker.value, 'picker'));
  text.addEventListener('input', debounce(() => sync(text.value, 'text'), 300));
  return h('div', { class: 'color-field' }, picker, text);
}

function numberInput(key, { min = 0, max = 4096, step = 1 } = {}) {
  const node = h('input', { type: 'number', min: String(min), max: String(max), step: String(step), value: String(state[key]), 'aria-label': key });
  node.addEventListener('input', debounce(() => {
    state[key] = Number(node.value);
    persist();
    render({ keepForm: true });
  }, 250));
  return node;
}

function textInput(key, placeholder) {
  const node = h('input', { type: 'text', value: state[key], placeholder, spellcheck: 'false', 'aria-label': placeholder });
  node.addEventListener('input', debounce(() => {
    state[key] = node.value;
    persist();
    render({ keepForm: true });
  }, 250));
  return node;
}

function selectInput(key, options) {
  const node = h('select', { 'aria-label': key },
    options.map((option) => h('option', { value: String(option.id), selected: String(option.id) === String(state[key]) }, option.label))
  );
  node.value = String(state[key]);
  node.addEventListener('change', () => {
    state[key] = node.value;
    persist();
    render();
  });
  return node;
}

/* ── 表单 ─────────────────────────────────────────────────── */

function renderForm() {
  const box = $('#form');
  clear(box);

  const sizeChips = h('div', { class: 'preset-row' },
    logic.SIZE_PRESETS.map((preset) =>
      h('button', {
        class: 'chip',
        type: 'button',
        'aria-pressed': String(state.width === preset.width && state.height === preset.height),
        onclick: () => {
          state.width = preset.width;
          state.height = preset.height;
          persist();
          render();
        }
      }, preset.label)
    )
  );

  const circleBox = h('input', { type: 'checkbox', id: 'opt-circle', checked: Boolean(state.circle) });
  circleBox.addEventListener('change', () => {
    state.circle = circleBox.checked;
    persist();
    render();
  });

  box.appendChild(h('div', { class: 'section-label' }, '尺寸'));
  box.appendChild(sizeChips);

  box.appendChild(h('div', { class: 'form-grid' },
    field('宽度', numberInput('width', { min: 1, max: 4096 })),
    field('高度', numberInput('height', { min: 1, max: 4096 })),
    field('圆角', numberInput('radius', { min: 0, max: 4096 })),
    field('文字', textInput('text', '留空则不显示文字')),
    field('字号（0 = 自动）', numberInput('fontSize', { min: 0, max: 512 })),
    field('纹理', selectInput('pattern', logic.PATTERNS))
  ));

  box.appendChild(h('div', { style: { marginTop: '10px' } },
    h('label', { class: 'check', for: 'opt-circle' }, circleBox, h('span', { text: '圆形（头像）' }))
  ));

  box.appendChild(h('div', { class: 'section-label' }, '颜色'));
  box.appendChild(h('div', { class: 'form-grid' },
    field('背景色', colorField('background')),
    field('渐变结束色（留空为纯色）', colorField('backgroundEnd')),
    field('纹理色', colorField('foreground')),
    field('文字色', colorField('textColor'))
  ));

  box.appendChild(h('div', { class: 'note' }, '渐变只在填了「渐变结束色」时生效，此时纹理会被忽略'));
}

/* ── 预览与输出 ───────────────────────────────────────────── */

function renderPreview() {
  const box = $('#preview');
  clear(box);
  clear(els.status);
  els.status.className = 'panel-foot';
  lastSvg = '';

  const result = logic.generateSvg(state);
  if (!result.ok) {
    els.status.className = 'panel-foot text-err';
    els.status.textContent = `✗ ${result.error}`;
    box.appendChild(h('div', { class: 'inline-error' }, icon('close', 13), h('span', { text: result.error })));
    renderActions('');
    return;
  }

  lastSvg = result.svg;
  els.status.textContent = `${state.width} × ${state.height} · ${(result.bytes / 1024).toFixed(2)} KB`;
  els.foot.textContent = result.fontSize > 0 ? `自动字号 ${Math.round(result.fontSize)}px` : '无文字';

  if (result.warnings.length) {
    box.appendChild(h('ul', { class: 'warn-list' },
      result.warnings.map((warning) => h('li', {}, icon('warn', 12), h('span', { text: warning })))
    ));
  }

  // 预览用 data URI 交给 img 渲染：不经过 innerHTML，天然避开注入
  const stage = h('div', { class: 'preview-stage' });
  const image = h('img', { alt: 'SVG 预览', src: logic.toDataUri(result.svg) });
  stage.appendChild(image);
  box.appendChild(stage);

  const tabs = h('div', { class: 'tabs' },
    [{ id: 'source', label: 'SVG 源码' }, { id: 'datauri', label: 'Data URI' }, { id: 'css', label: 'CSS' }].map((tab) =>
      h('button', {
        type: 'button',
        'aria-selected': String(outputTab === tab.id),
        onclick: () => {
          outputTab = tab.id;
          renderPreview();
        }
      }, tab.label)
    )
  );
  box.appendChild(tabs);

  const content = outputTab === 'datauri'
    ? logic.toDataUri(result.svg)
    : outputTab === 'css'
      ? logic.toCssBackground(result.svg)
      : result.svg;
  box.appendChild(h('pre', { class: 'code-box', text: content }));

  if (outputTab === 'datauri') {
    box.appendChild(h('div', { class: 'note' }, '可直接用于 <img src> 或背景图，无需额外请求'));
  }

  renderActions(result.svg);
}

function renderActions(svg) {
  const box = $('#actions');
  clear(box);
  if (!svg) return;

  box.appendChild(copyButton(() => lastSvg, { label: '复制 SVG', title: '复制 SVG 源码' }));
  box.appendChild(copyButton(() => logic.toDataUri(lastSvg), { label: '复制 URI', title: '复制 Data URI' }));

  const downloadButton = h('button', { class: 'btn btn-sm', type: 'button' }, icon('download', 12), h('span', { text: '下载 SVG' }));
  downloadButton.addEventListener('click', () => {
    downloadText(`placeholder-${state.width}x${state.height}.svg`, lastSvg, 'image/svg+xml;charset=utf-8');
    toast.ok('已导出 SVG');
  });
  box.appendChild(downloadButton);
}

/* ── 渲染 ─────────────────────────────────────────────────── */

function render({ keepForm = false } = {}) {
  if (!keepForm) renderForm();
  renderPreview();
}

function init() {
  els.status = $('#status');
  els.foot = $('#foot');

  $('#btn-sample').addEventListener('click', () => {
    Object.assign(state, {
      width: 1200, height: 675, background: '#0f172a', backgroundEnd: '#1e3a8a',
      text: '封面占位图', textColor: '#e0f2fe', pattern: 'grid', radius: 0, circle: false, fontSize: 0
    });
    persist();
    render();
    toast.ok('已载入示例');
  });

  mountTool({
    actions: [
      { id: 'og', label: 'OG 图 1200×630', icon: 'web', primary: true, keywords: 'og 1200 630 分享图', run: () => preset({ width: 1200, height: 630, text: '1200 × 630' }) },
      { id: 'avatar', label: '头像 256 圆形', icon: 'star', keywords: 'avatar 头像 圆形', run: () => preset({ width: 256, height: 256, circle: true, radius: 0, text: 'AB' }) },
      { id: 'square', label: '正方形 600', icon: 'color', keywords: 'square 正方形', run: () => preset({ width: 600, height: 600, circle: false, text: '600 × 600' }) },
      { id: 'grid', label: '网格纹理', icon: 'network', keywords: 'grid 网格 纹理', run: () => preset({ pattern: 'grid' }) },
      { id: 'dots', label: '点阵纹理', icon: 'dot', keywords: 'dots 点阵 纹理', run: () => preset({ pattern: 'dots' }) },
      { id: 'clear-text', label: '只留纯色块', icon: 'close', keywords: 'plain 纯色 无文字', run: () => preset({ text: '', pattern: 'solid', backgroundEnd: '' }) }
    ]
  });

  render();
}

function preset(patch) {
  Object.assign(state, patch);
  persist();
  render();
}

init();
