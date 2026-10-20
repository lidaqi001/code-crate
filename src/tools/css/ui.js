/* CSS 生成器界面层：左侧表单、右侧预览与代码。
   状态变化时只重建预览与代码，只有结构变化（切类型/预设/增删）才重建表单，
   避免输入过程中焦点丢失。 */

import { h, mount, clear, $ } from '../../core/dom.js';
import { mountTool } from '../../core/app.js';
import { icon } from '../../core/icons.js';
import { copyButton, field } from '../../core/widgets.js';
import { read, write } from '../../core/storage.js';
import * as toast from '../../core/toast.js';
import * as logic from './logic.js';

const STORAGE_ID = 'css';

const els = {};
let codeText = '';

function defaultGradient() {
  return {
    type: 'linear',
    angle: 135,
    shape: 'circle',
    x: 50,
    y: 50,
    stops: logic.DEFAULT_STOPS.map((stop) => ({ ...stop }))
  };
}

function defaultShadow() {
  return { layers: logic.DEFAULT_LAYERS.map((layer) => ({ ...layer })) };
}

const saved = read(`${STORAGE_ID}:state`, null) || {};
const state = {
  mode: saved.mode === 'shadow' ? 'shadow' : 'gradient',
  gradient: { ...defaultGradient(), ...(saved.gradient || {}) },
  shadow: { ...defaultShadow(), ...(saved.shadow || {}) }
};

// 存储里可能是旧结构或脏数据，统一走逻辑层的规范化
state.gradient.stops = logic.normalizeStops(state.gradient.stops);
state.gradient.angle = logic.normalizeAngle(state.gradient.angle);
state.gradient.x = logic.clampNumber(state.gradient.x, 0, 100, 50);
state.gradient.y = logic.clampNumber(state.gradient.y, 0, 100, 50);
state.shadow.layers = logic.normalizeLayers(state.shadow.layers);
if (!state.shadow.layers.length) state.shadow.layers = defaultShadow().layers;

function persist() {
  write(`${STORAGE_ID}:state`, { mode: state.mode, gradient: state.gradient, shadow: state.shadow });
}

/* ── 控件工厂 ─────────────────────────────────────────────── */

function select(id, options, value, ariaLabel, onChange) {
  const node = h('select', { id, 'aria-label': ariaLabel },
    options.map((option) => h('option', { value: String(option.id ?? option.value), selected: String(option.id ?? option.value) === String(value) }, option.label))
  );
  node.value = String(value);
  node.addEventListener('change', () => onChange(node.value));
  return node;
}

function numberInput(props) {
  const { id, value, min, max, step = 1, label, onInput } = props;
  const node = h('input', {
    type: 'number',
    id,
    min: String(min),
    max: String(max),
    step: String(step),
    value: String(value),
    'aria-label': label
  });
  node.addEventListener('input', () => onInput(Number(node.value)));
  return node;
}

function rangeRow(id, value, min, max, step, label, onInput) {
  const output = h('output', { text: String(value) });
  const range = h('input', {
    type: 'range',
    id,
    min: String(min),
    max: String(max),
    step: String(step),
    value: String(value),
    'aria-label': label
  });
  range.addEventListener('input', () => {
    output.textContent = range.value;
    onInput(Number(range.value));
  });
  return h('div', { class: 'range-row' }, range, output);
}

/* rangeRow 返回的是容器而不是控件，不能直接交给 widgets.field（它会找 control.id）。
   这里显式把 label 的 for 指向内部 range 的 id。 */
function labeledField(labelText, controlId, control) {
  return h('div', { class: 'field' }, h('label', { for: controlId, text: labelText }), control);
}

function presetChips(presets, onPick) {
  return h('div', { class: 'preset-row' },
    presets.map((preset) =>
      h('button', {
        class: 'chip',
        type: 'button',
        text: preset.label,
        onclick: () => onPick(preset)
      })
    )
  );
}

/* ── 渐变表单 ─────────────────────────────────────────────── */

function renderGradientForm(box) {
  const g = state.gradient;

  const typeOptions = logic.GRADIENT_TYPES;
  const typeNode = select('gradient-type', typeOptions, g.type, '渐变类型', (value) => {
    g.type = value;
    persist();
    renderForm();
    sync();
  });

  const angleNode = rangeRow('gradient-angle', g.angle, 0, 360, 1, '角度', (value) => {
    g.angle = value;
    sync();
  });

  const shapeNode = select('gradient-shape', logic.RADIAL_SHAPES, g.shape, '径向形状', (value) => {
    g.shape = value;
    sync();
  });

  const positionRow = h('div', { class: 'form-grid' },
    labeledField('水平位置', 'gradient-x', rangeRow('gradient-x', g.x, 0, 100, 1, '水平位置', (value) => {
      g.x = value;
      sync();
    })),
    labeledField('垂直位置', 'gradient-y', rangeRow('gradient-y', g.y, 0, 100, 1, '垂直位置', (value) => {
      g.y = value;
      sync();
    }))
  );

  const grid = h('div', { class: 'form-grid' }, field('类型', typeNode));
  if (g.type === 'radial') {
    grid.appendChild(field('形状', shapeNode));
  }
  if (g.type === 'linear' || g.type === 'conic') {
    grid.appendChild(labeledField('角度', 'gradient-angle', angleNode));
  }
  box.appendChild(grid);
  if (g.type === 'radial' || g.type === 'conic') box.appendChild(positionRow);

  box.appendChild(h('div', { class: 'section-label' }, '预设'));
  box.appendChild(presetChips(logic.GRADIENT_PRESETS, (preset) => {
    Object.assign(g, {
      type: preset.type,
      angle: preset.angle ?? g.angle,
      shape: preset.shape ?? g.shape,
      x: preset.x ?? g.x,
      y: preset.y ?? g.y,
      stops: preset.stops.map((stop) => ({ ...stop }))
    });
    persist();
    renderForm();
    sync();
  }));

  box.appendChild(h('div', { class: 'section-label' }, '色标'));
  const list = h('div', { class: 'stop-list' });
  g.stops.forEach((stop, index) => {
    const color = h('input', {
      type: 'color',
      id: `stop-${index}-color`,
      value: stop.color,
      'aria-label': `色标 ${index + 1} 颜色`
    });
    color.addEventListener('input', () => {
      stop.color = color.value;
      sync();
    });

    const position = numberInput({
      id: `stop-${index}-pos`,
      value: stop.position,
      min: 0,
      max: 100,
      label: `色标 ${index + 1} 位置`,
      onInput: (value) => {
        stop.position = Number.isFinite(value) ? value : 0;
        sync();
      }
    });

    const remove = h('button', {
      class: 'btn btn-icon btn-sm',
      type: 'button',
      title: '删除色标',
      'aria-label': `删除色标 ${index + 1}`,
      disabled: g.stops.length <= 2
    }, icon('close', 12));
    remove.addEventListener('click', () => {
      g.stops.splice(index, 1);
      persist();
      renderForm();
      sync();
    });

    list.appendChild(h('div', { class: 'stop-row' }, color, position, h('span', { class: 'unit', text: '%' }), remove));
  });
  box.appendChild(list);

  const add = h('button', {
    class: 'btn btn-sm',
    type: 'button',
    text: '+ 添加色标',
    disabled: g.stops.length >= logic.MAX_STOPS
  });
  add.addEventListener('click', () => {
    const last = g.stops[g.stops.length - 1];
    const next = last ? Math.min(100, last.position) : 100;
    g.stops.push({ color: '#ffffff', position: next });
    persist();
    renderForm();
    sync();
  });
  box.appendChild(h('div', { class: 'row-actions' }, add));
  box.appendChild(h('div', { class: 'note' }, `最多 ${logic.MAX_STOPS} 个色标；位置会自动按从小到大排序。`));
}

/* ── 阴影表单 ─────────────────────────────────────────────── */

function renderShadowForm(box) {
  const layers = state.shadow.layers;

  box.appendChild(h('div', { class: 'section-label first' }, '预设'));
  box.appendChild(presetChips(logic.SHADOW_PRESETS, (preset) => {
    state.shadow.layers = preset.layers.map((layer) => ({ ...layer }));
    persist();
    renderForm();
    sync();
  }));

  box.appendChild(h('div', { class: 'section-label' }, '阴影层'));
  const list = h('div', { class: 'layer-list' });

  layers.forEach((layer, index) => {
    const color = h('input', {
      type: 'color',
      id: `layer-${index}-color`,
      value: layer.color,
      'aria-label': `第 ${index + 1} 层颜色`
    });
    color.addEventListener('input', () => {
      layer.color = color.value;
      sync();
    });

    const alpha = rangeRow(`layer-${index}-alpha`, layer.alpha, 0, 1, 0.05, `第 ${index + 1} 层不透明度`, (value) => {
      layer.alpha = value;
      sync();
    });

    const inset = h('input', { type: 'checkbox', id: `layer-${index}-inset`, checked: layer.inset });
    inset.addEventListener('change', () => {
      layer.inset = inset.checked;
      sync();
    });

    const remove = h('button', {
      class: 'btn btn-icon btn-sm',
      type: 'button',
      title: '删除阴影层',
      'aria-label': `删除第 ${index + 1} 层`
    }, icon('close', 12));
    remove.addEventListener('click', () => {
      layers.splice(index, 1);
      if (!layers.length) layers.push(...defaultShadow().layers);
      persist();
      renderForm();
      sync();
    });

    list.appendChild(h('div', { class: 'layer-row' },
      h('div', { class: 'field-mini' }, 'X', numberInput({
        id: `layer-${index}-x`, value: layer.x, min: -100, max: 100,
        label: `第 ${index + 1} 层水平偏移`,
        onInput: (value) => { layer.x = value; sync(); }
      })),
      h('div', { class: 'field-mini' }, 'Y', numberInput({
        id: `layer-${index}-y`, value: layer.y, min: -100, max: 100,
        label: `第 ${index + 1} 层垂直偏移`,
        onInput: (value) => { layer.y = value; sync(); }
      })),
      h('div', { class: 'field-mini' }, '模糊', numberInput({
        id: `layer-${index}-blur`, value: layer.blur, min: 0, max: 200,
        label: `第 ${index + 1} 层模糊半径`,
        onInput: (value) => { layer.blur = value; sync(); }
      })),
      h('div', { class: 'field-mini' }, '扩散', numberInput({
        id: `layer-${index}-spread`, value: layer.spread, min: -100, max: 100,
        label: `第 ${index + 1} 层扩散半径`,
        onInput: (value) => { layer.spread = value; sync(); }
      })),
      color,
      h('div', { class: 'grow' }, alpha),
      h('label', { class: 'inset-toggle', for: `layer-${index}-inset` }, inset, '内阴影'),
      remove
    ));
  });
  box.appendChild(list);

  const add = h('button', {
    class: 'btn btn-sm',
    type: 'button',
    text: '+ 添加阴影层',
    disabled: layers.length >= logic.MAX_LAYERS
  });
  add.addEventListener('click', () => {
    layers.push({ x: 0, y: 4, blur: 12, spread: 0, color: '#000000', alpha: 0.2, inset: false });
    persist();
    renderForm();
    sync();
  });
  box.appendChild(h('div', { class: 'row-actions' }, add));
  box.appendChild(h('div', { class: 'note' }, `最多 ${logic.MAX_LAYERS} 层；多层按从上到下的顺序叠加。`));
}

/* ── 渲染 ─────────────────────────────────────────────────── */

function renderForm() {
  for (const tab of els.modes.querySelectorAll('[role="tab"]')) {
    tab.setAttribute('aria-selected', String(tab.dataset.mode === state.mode));
  }
  clear(els.form);
  if (state.mode === 'gradient') renderGradientForm(els.form);
  else renderShadowForm(els.form);
}

function sync() {
  clear(els.preview);

  if (state.mode === 'gradient') {
    const value = logic.buildGradient(state.gradient);
    codeText = logic.buildGradientRule(state.gradient);
    els.preview.appendChild(h('div', { class: 'preview-stage' },
      h('div', { class: 'gradient-swatch', style: { background: value } })
    ));
    els.status.textContent = `${logic.GRADIENT_TYPES.find((type) => type.id === state.gradient.type)?.label || '线性'}渐变 · ${state.gradient.stops.length} 个色标`;
    els.foot.textContent = '渐变是纯 CSS，可直接用于 background；预览与代码实时同步。';
  } else {
    const value = logic.buildShadow(state.shadow.layers);
    codeText = logic.buildShadowRule(state.shadow.layers);
    els.preview.appendChild(h('div', { class: 'preview-stage' },
      h('div', { class: 'shadow-card', style: { boxShadow: value } })
    ));
    els.status.textContent = `${state.shadow.layers.length} 层阴影`;
    els.foot.textContent = '阴影层按列表顺序叠加；数值超出范围时会被夹紧到合法区间。';
  }

  const code = h('pre', { class: 'code-box' });
  code.textContent = codeText;
  els.preview.appendChild(code);

  persist();
}

function setMode(mode) {
  state.mode = mode === 'shadow' ? 'shadow' : 'gradient';
  persist();
  renderForm();
  sync();
}

function resetCurrent() {
  if (state.mode === 'gradient') {
    state.gradient = defaultGradient();
  } else {
    state.shadow = defaultShadow();
  }
  persist();
  renderForm();
  sync();
  toast.ok('已恢复默认');
}

/* ── 初始化 ───────────────────────────────────────────────── */

function init() {
  els.modes = $('#modes');
  els.form = $('#form');
  els.preview = $('#preview');
  els.status = $('#status');
  els.foot = $('#foot');
  els.actions = $('#actions');

  for (const tab of els.modes.querySelectorAll('[role="tab"]')) {
    tab.addEventListener('click', () => setMode(tab.dataset.mode));
  }
  $('#btn-reset').addEventListener('click', resetCurrent);

  mount(els.actions, copyButton(() => codeText, { label: '复制 CSS' }));

  mountTool({
    actions: [
      { id: 'copy', label: '复制 CSS', icon: 'copy', primary: true, keywords: 'copy css 复制', run: () => copyButton(() => codeText).click() },
      { id: 'mode-gradient', label: '渐变生成器', icon: 'color', keywords: 'gradient 渐变', run: () => setMode('gradient') },
      { id: 'mode-shadow', label: '阴影生成器', icon: 'sliders', keywords: 'shadow box-shadow 阴影', run: () => setMode('shadow') },
      { id: 'reset', label: '恢复默认', icon: 'refresh', keywords: 'reset 重置 默认', run: resetCurrent }
    ]
  });

  renderForm();
  sync();
}

init();
