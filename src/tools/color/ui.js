/* 颜色工具界面层 */

import { h, mount, clear, $, debounce } from '../../core/dom.js';
import { mountTool } from '../../core/app.js';
import { copyButton } from '../../core/widgets.js';
import { read, write } from '../../core/storage.js';
import * as toast from '../../core/toast.js';
import * as logic from './logic.js';

const STORAGE_ID = 'color';

const els = {};
const state = {
  rgba: { r: 91, g: 140, b: 255, a: 1 },
  compare: { r: 255, g: 255, b: 255, a: 1 },
  mode: read(`${STORAGE_ID}:mode`, 'contrast'),
  harmony: read(`${STORAGE_ID}:harmony`, 'complementary')
};

function persist() {
  write(`${STORAGE_ID}:color`, state.rgba);
  write(`${STORAGE_ID}:compare`, state.compare);
  write(`${STORAGE_ID}:mode`, state.mode);
  write(`${STORAGE_ID}:harmony`, state.harmony);
}

/* ── 颜色设置与同步 ───────────────────────────────────────── */

function setColor(rgba, { message, skipHexSync = false } = {}) {
  state.rgba = { r: Math.round(rgba.r), g: Math.round(rgba.g), b: Math.round(rgba.b), a: rgba.a ?? 1 };
  persist();
  syncControls({ skipHexSync });
  renderOutput();
  if (message) toast.ok(message);
}

function syncControls({ skipHexSync = false } = {}) {
  const color = state.rgba;
  els.swatchFill.style.background = logic.formatColor(color, 'rgb');
  els.picker.value = logic.rgbToHex(color);
  // 用户正在 HEX 输入框里打字时不要回写，否则每敲一个字符都会被规范化打断
  if (!skipHexSync) els.hexInput.value = logic.formatColor(color, 'hex');

  const rgbFields = els.rgbInputs;
  rgbFields.r.value = String(color.r);
  rgbFields.g.value = String(color.g);
  rgbFields.b.value = String(color.b);

  const hsl = logic.rgbToHsl(color);
  els.hslInputs.h.value = String(Math.round(hsl.h));
  els.hslInputs.s.value = String(Math.round(hsl.s));
  els.hslInputs.l.value = String(Math.round(hsl.l));

  els.alpha.value = String(Math.round(color.a * 100));
  els.alphaValue.textContent = `${Math.round(color.a * 100)}%`;

  const isPublicText = color.a < 1;
  els.inputStatus.textContent = isPublicText
    ? `带透明度，HEX 表示为 ${logic.formatColor(color, 'hex')}`
    : `不透明度 100%`;
}

/* ── 控件构建 ─────────────────────────────────────────────── */

function numberField(label, { min, max, step = 1, onInput }) {
  const input = h('input', { type: 'number', min: String(min), max: String(max), step: String(step), 'aria-label': label });
  input.addEventListener('input', () => onInput(input));
  return { node: h('div', { class: 'field' }, h('label', { text: label }), input), input };
}

function buildChannels() {
  const container = $('#channels');
  clear(container);

  const fromRgb = () => {
    const r = Number(els.rgbInputs.r.value);
    const g = Number(els.rgbInputs.g.value);
    const b = Number(els.rgbInputs.b.value);
    if (![r, g, b].every(Number.isFinite)) return;
    setColor({ r, g, b, a: state.rgba.a });
  };

  const fromHsl = () => {
    const hue = Number(els.hslInputs.h.value);
    const saturation = Number(els.hslInputs.s.value);
    const lightness = Number(els.hslInputs.l.value);
    if (![hue, saturation, lightness].every(Number.isFinite)) return;
    setColor({ ...logic.hslToRgb({ h: hue, s: saturation, l: lightness }), a: state.rgba.a });
  };

  els.rgbInputs = {
    r: numberField('R', { min: 0, max: 255, onInput: fromRgb }).input,
    g: numberField('G', { min: 0, max: 255, onInput: fromRgb }).input,
    b: numberField('B', { min: 0, max: 255, onInput: fromRgb }).input
  };
  els.hslInputs = {
    h: numberField('H', { min: 0, max: 360, onInput: fromHsl }).input,
    s: numberField('S', { min: 0, max: 100, onInput: fromHsl }).input,
    l: numberField('L', { min: 0, max: 100, onInput: fromHsl }).input
  };

  container.appendChild(h('div', { class: 'channel-group' },
    h('div', { class: 'op-title', text: 'RGB' }),
    h('div', { class: 'channel-grid' },
      h('div', { class: 'field' }, h('label', { text: 'R' }), els.rgbInputs.r),
      h('div', { class: 'field' }, h('label', { text: 'G' }), els.rgbInputs.g),
      h('div', { class: 'field' }, h('label', { text: 'B' }), els.rgbInputs.b)
    )
  ));

  container.appendChild(h('div', { class: 'channel-group' },
    h('div', { class: 'op-title', text: 'HSL' }),
    h('div', { class: 'channel-grid' },
      h('div', { class: 'field' }, h('label', { text: 'H' }), els.hslInputs.h),
      h('div', { class: 'field' }, h('label', { text: 'S' }), els.hslInputs.s),
      h('div', { class: 'field' }, h('label', { text: 'L' }), els.hslInputs.l)
    )
  ));

  els.alpha = h('input', { type: 'range', min: '0', max: '100', id: 'alpha', 'aria-label': '透明度' });
  els.alpha.addEventListener('input', () => {
    setColor({ ...state.rgba, a: Number(els.alpha.value) / 100 });
  });
  $('#alpha-field').appendChild(els.alpha);
}

/* ── 对比度视图 ───────────────────────────────────────────── */

const WCAG_ITEMS = [
  { key: 'aaNormal', label: 'AA 正文', requirement: '≥ 4.5' },
  { key: 'aaLarge', label: 'AA 大字', requirement: '≥ 3' },
  { key: 'aaaNormal', label: 'AAA 正文', requirement: '≥ 7' },
  { key: 'aaaLarge', label: 'AAA 大字', requirement: '≥ 4.5' }
];

function renderContrast(container) {
  const ratio = logic.contrastRatio(state.rgba, state.compare);
  const levels = logic.wcagLevels(ratio);
  const best = logic.bestTextColor(state.rgba);

  const compareInput = h('input', {
    type: 'text',
    class: 'mono',
    spellcheck: 'false',
    value: logic.formatColor(state.compare, 'hex'),
    'aria-label': '对比色'
  });
  compareInput.addEventListener('input', debounce(() => {
    const parsed = logic.parseColor(compareInput.value);
    if (!parsed.ok) return;
    state.compare = { ...parsed.rgba, a: 1 };
    persist();
    renderOutput();
  }, 250));

  const comparePicker = h('input', { type: 'color', value: logic.rgbToHex(state.compare), 'aria-label': '选择对比色' });
  comparePicker.addEventListener('input', () => {
    state.compare = { ...logic.parseColor(comparePicker.value).rgba, a: 1 };
    persist();
    renderOutput();
  });

  const preview = h('div', { class: 'contrast-preview', style: { background: logic.formatColor(state.rgba, 'rgb'), color: best.color } },
    h('div', { class: 'big', text: '示例文字 Sample 123' }),
    h('div', { class: 'small', text: `自动推荐文字色 ${best.color}（对比度 ${best.ratio.toFixed(2)}）` })
  );

  container.appendChild(h('div', { class: 'contrast-head' },
    h('span', { class: 'contrast-ratio', text: ratio.toFixed(2) }),
    h('div', {},
      h('div', { class: 'label', text: '对比度' }),
      h('div', { class: 'hint', text: ratio >= 4.5 ? '达到 AA 正文标准' : ratio >= 3 ? '仅达到大字标准' : '未达到无障碍标准' })
    )
  ));

  container.appendChild(h('div', { class: 'wcag-grid' },
    WCAG_ITEMS.map((item) => h('div', { class: `wcag-item ${levels[item.key] ? 'pass' : 'fail'}` },
      h('span', { class: 'mark', text: levels[item.key] ? '✓' : '✗' }),
      h('span', { class: 'label', text: item.label }),
      h('span', { class: 'req', text: item.requirement })
    ))
  ));

  container.appendChild(preview);

  container.appendChild(h('div', { class: 'field', style: { marginBottom: '10px' } },
    h('label', { text: '对比色' }),
    h('div', { class: 'compare-row' },
      h('span', { class: 'mini-swatch', style: { background: logic.formatColor(state.compare, 'rgb') } }),
      comparePicker,
      h('span', { style: { flex: '1 1 auto', minWidth: '120px' } }, compareInput)
    )
  ));

  container.appendChild(h('div', { class: 'ip-rows' },
    h('div', { class: 'ip-row' },
      h('span', { class: 'k', text: '推荐文字色' }),
      h('span', { class: 'v', text: `${best.color}（对比度 ${best.ratio.toFixed(2)}）` }),
      copyButton(() => best.color, { title: '复制推荐文字色' })
    )
  ));
}

/* ── 色阶视图 ─────────────────────────────────────────────── */

function renderScale(container) {
  const scale = logic.colorScale(state.rgba);
  const list = h('div', { class: 'scale-list' });

  for (const step of scale) {
    const hex = step.hex;
    const row = h('div', {
      class: 'scale-row',
      title: '点击应用该颜色',
      onclick: () => setColor({ ...step.color, a: state.rgba.a }, { message: `已应用 ${hex}` })
    },
      h('span', { class: 'scale-chip', style: { background: hex } }),
      h('span', { class: 'scale-name', text: step.name }),
      h('span', { class: 'scale-hex', text: hex }),
      h('span', { class: 'scale-contrast', text: `对白 ${logic.contrastRatio(step.color, { r: 255, g: 255, b: 255 }).toFixed(2)}` }),
      copyButton(() => hex, { title: `复制 ${hex}` })
    );
    list.appendChild(row);
  }

  container.appendChild(h('div', { class: 'op-title' }, '50 – 900 色阶（亮度自上而下递减）'));
  container.appendChild(list);

  const strip = h('div', { class: 'swatch-strip' },
    scale.map((step) => h('span', { style: { background: step.hex }, title: `${step.name} ${step.hex}` }))
  );
  container.appendChild(strip);

  container.appendChild(h('div', { class: 'op-title' }, '浅色 / 深色序列'));
  container.appendChild(h('div', { class: 'swatch-strip' },
    logic.tints(state.rgba, 6).map((color) => h('span', { style: { background: logic.rgbToHex(color) }, title: logic.rgbToHex(color) }))
  ));
  container.appendChild(h('div', { class: 'swatch-strip' },
    logic.shades(state.rgba, 6).map((color) => h('span', { style: { background: logic.rgbToHex(color) }, title: logic.rgbToHex(color) }))
  ));

  container.appendChild(h('div', { class: 'row', style: { marginTop: '8px' } },
    copyButton(() => scale.map((step) => `${step.name}: ${step.hex}`).join('\n'), { label: '复制整条色阶', title: '复制整条色阶' })
  ));
}

/* ── 配色视图 ─────────────────────────────────────────────── */

function renderHarmony(container) {
  const select = h('select', { 'aria-label': '配色方案' },
    logic.HARMONY_KINDS.map((kind) => h('option', { value: kind.id, selected: kind.id === state.harmony }, kind.label))
  );
  select.addEventListener('change', () => {
    state.harmony = select.value;
    persist();
    renderOutput();
  });

  const colors = logic.harmony(state.rgba, state.harmony);
  const kind = logic.HARMONY_KINDS.find((entry) => entry.id === state.harmony);
  const roles = ['基色', ...kind.angles.map((angle) => `${angle > 0 ? '+' : ''}${angle}°`)];

  const list = h('div', { class: 'harmony-list' },
    colors.map((color, index) => {
      const hex = logic.rgbToHex(color);
      return h('div', {
        class: 'harmony-item',
        title: '点击应用该颜色',
        onclick: () => setColor({ ...color, a: state.rgba.a }, { message: `已应用 ${hex}` })
      },
        h('div', { class: 'chip', style: { background: hex } }),
        h('div', { class: 'meta' },
          h('span', { text: hex }),
          h('span', { class: 'role', text: roles[index] })
        )
      );
    })
  );

  container.appendChild(h('div', { class: 'row', style: { marginBottom: '12px' } },
    h('span', { class: 'label', text: '配色方案' }),
    select,
    h('span', { class: 'grow', style: { flex: '1 1 auto' } }),
    copyButton(() => colors.map((color) => logic.rgbToHex(color)).join(', '), { label: '复制配色', title: '复制全部颜色' })
  ));
  container.appendChild(list);

  container.appendChild(h('div', { class: 'swatch-strip', style: { marginTop: '12px' } },
    colors.map((color) => h('span', { style: { background: logic.rgbToHex(color) } }))
  ));
}

/* ── 格式视图 ─────────────────────────────────────────────── */

function renderFormats(container) {
  const rows = logic.FORMATS.map((format) => {
    const value = logic.formatColor(state.rgba, format.id);
    return h('div', { class: 'format-row' },
      h('span', { class: 'format-name', text: format.label }),
      h('span', { class: 'format-value', text: value }),
      copyButton(() => value, { title: `复制 ${format.label}` })
    );
  });

  container.appendChild(h('div', {}, rows));
  container.appendChild(h('div', { class: 'hint', style: { marginTop: '10px' } },
    'CSS 变量值可直接用于 hsl(var(--x) / <alpha>) 这种现代写法'
  ));
}

/* ── 渲染 ─────────────────────────────────────────────────── */

const RENDERERS = {
  contrast: renderContrast,
  scale: renderScale,
  harmony: renderHarmony,
  formats: renderFormats
};

const MODE_HINTS = {
  contrast: '对比度按 WCAG 2.1 相对亮度公式计算，阈值 4.5 / 3 / 7 / 4.5',
  scale: '色阶由与白/黑的混合比例生成，因此亮度严格单调递减',
  harmony: '配色方案保持明度不变，只旋转色相',
  formats: '同一种颜色在不同写法下的表示'
};

function renderOutput() {
  for (const tab of els.modes.querySelectorAll('[role="tab"]')) {
    tab.setAttribute('aria-selected', String(tab.dataset.mode === state.mode));
  }
  const box = $('#output');
  clear(box);
  (RENDERERS[state.mode] || renderContrast)(box);
  els.status.textContent = MODE_HINTS[state.mode] || '';
}

/* ── 初始化 ───────────────────────────────────────────────── */

function init() {
  els.modes = $('#modes');
  els.output = $('#output');
  els.inputStatus = $('#input-status');
  els.status = $('#status');

  const savedColor = read(`${STORAGE_ID}:color`, null);
  if (savedColor && Number.isFinite(savedColor.r)) state.rgba = savedColor;
  const savedCompare = read(`${STORAGE_ID}:compare`, null);
  if (savedCompare && Number.isFinite(savedCompare.r)) state.compare = savedCompare;
  if (!RENDERERS[state.mode]) state.mode = 'contrast';

  els.swatch = $('#swatch');
  els.swatchFill = h('i');
  els.swatch.appendChild(els.swatchFill);

  els.picker = $('#picker');
  els.picker.addEventListener('input', () => {
    const parsed = logic.parseColor(els.picker.value);
    if (parsed.ok) setColor({ ...parsed.rgba, a: state.rgba.a });
  });

  els.hexInput = $('#hex-input');
  els.hexInput.addEventListener('input', () => {
    const parsed = logic.parseColor(els.hexInput.value);
    els.hexInput.classList.toggle('invalid', !parsed.ok);
    if (parsed.ok) setColor({ ...parsed.rgba, a: state.rgba.a }, { skipHexSync: true });
  });
  // 输入完成后再统一规范化为标准 HEX
  els.hexInput.addEventListener('change', () => syncControls());

  els.alphaValue = $('#alpha-value');

  buildChannels();

  $('#btn-random').addEventListener('click', () => {
    setColor({ ...logic.randomColor(), a: state.rgba.a }, { message: '已生成随机颜色' });
  });

  $('#btn-swap-compare').addEventListener('click', () => {
    const previous = state.rgba;
    state.rgba = state.compare;
    state.compare = previous;
    persist();
    syncControls();
    renderOutput();
    toast.ok('已与对比色互换');
  });

  for (const tab of els.modes.querySelectorAll('[role="tab"]')) {
    tab.addEventListener('click', () => {
      state.mode = tab.dataset.mode;
      persist();
      renderOutput();
    });
  }

  mountTool({
    actions: [
      { id: 'mode-contrast', label: '检查对比度', icon: 'color', primary: true, keywords: 'contrast 对比度 无障碍', run: () => switchMode('contrast') },
      { id: 'mode-scale', label: '生成色阶', icon: 'sliders', keywords: 'scale 色阶 调色板', run: () => switchMode('scale') },
      { id: 'mode-harmony', label: '生成配色方案', icon: 'star', keywords: 'harmony 配色 互补', run: () => switchMode('harmony') },
      { id: 'mode-formats', label: '查看各种格式', icon: 'codec', keywords: 'format 格式 hex rgb hsl', run: () => switchMode('formats') },
      {
        id: 'random',
        label: '随机颜色',
        icon: 'refresh',
        keywords: 'random 随机',
        run: () => $('#btn-random').click()
      },
      {
        id: 'copy-hex',
        label: '复制当前 HEX',
        icon: 'copy',
        keywords: 'copy 复制 hex',
        run: async () => {
          const { copy } = await import('../../core/clipboard.js');
          if (await copy(logic.formatColor(state.rgba, 'hex'))) toast.ok('已复制 HEX');
          else toast.fail('复制失败');
        }
      }
    ]
  });

  syncControls();
  renderOutput();
}

function switchMode(mode) {
  state.mode = mode;
  persist();
  renderOutput();
}

init();
