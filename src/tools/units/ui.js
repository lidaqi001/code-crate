/* 进制与单位界面层 */

import { h, mount, clear, $, debounce } from '../../core/dom.js';
import { mountTool } from '../../core/app.js';
import { icon } from '../../core/icons.js';
import { copyButton } from '../../core/widgets.js';
import { read, write } from '../../core/storage.js';
import * as logic from './logic.js';

const STORAGE_ID = 'units';

const els = {};
const state = {
  mode: 'base',
  base: { value: '255', from: 10, group: false },
  bits: { a: '1100', aBase: 2, b: '1010', bBase: 2, op: 'and', width: 32 },
  units: { category: 'data', from: 'mb', to: 'mib', value: '1' },
  ...(read(`${STORAGE_ID}:state`, null) || {})
};

function persist() {
  write(`${STORAGE_ID}:state`, {
    mode: state.mode,
    base: state.base,
    bits: state.bits,
    units: state.units
  });
}

/* ── 通用小部件 ───────────────────────────────────────────── */

function field(labelText, control, { wide = false } = {}) {
  return h('div', { class: `field${wide ? ' wide' : ''}` }, h('label', { text: labelText }), control);
}

function textInput(value, { mono = true, placeholder = '', ariaLabel } = {}) {
  return h('input', {
    type: 'text',
    class: mono ? 'mono' : '',
    value,
    placeholder,
    spellcheck: 'false',
    autocomplete: 'off',
    'aria-label': ariaLabel || placeholder || '输入'
  });
}

function select(options, value, ariaLabel, onChange) {
  const node = h('select', { 'aria-label': ariaLabel },
    options.map((option) => h('option', { value: String(option.value), selected: String(option.value) === String(value) }, option.label))
  );
  node.value = String(value);
  node.addEventListener('change', () => onChange(node.value));
  return node;
}

function resultRow(name, value, { primary = false } = {}) {
  return h('tr', {},
    h('td', { class: 'col-name', text: name }),
    h('td', { class: `col-value${primary ? ' primary' : ''}`, text: value }),
    h('td', { class: 'col-actions' }, copyButton(() => value, { title: `复制${name}` }))
  );
}

function errorBox(message) {
  return h('div', { class: 'inline-error' }, icon('close', 13), h('span', { text: message }));
}

/* ── 视图一：进制转换 ─────────────────────────────────────── */

function renderBase(container) {
  const { base } = state;

  const valueInput = textInput(base.value, { placeholder: '输入整数', ariaLabel: '待转换的数值' });
  const baseSelect = select(
    Array.from({ length: 35 }, (_, index) => ({ value: index + 2, label: `${index + 2} 进制` })),
    base.from,
    '源进制',
    (value) => {
      base.from = Number(value);
      persist();
      renderStage();
    }
  );

  const groupBox = h('input', { type: 'checkbox', id: 'opt-group', checked: base.group });
  groupBox.addEventListener('change', () => {
    base.group = groupBox.checked;
    persist();
    update();
  });

  valueInput.addEventListener('input', debounce(() => {
    base.value = valueInput.value;
    persist();
    update();
  }, 180));

  container.appendChild(h('div', { class: 'work-row' },
    field('数值', valueInput, { wide: true }),
    field('源进制', baseSelect),
    h('label', { class: 'check', for: 'opt-group' }, groupBox, h('span', { text: '按 4 位分组' }))
  ));

  const quick = h('div', { class: 'quick-bases' },
    logic.COMMON_BASES.map((entry) =>
      h('button', {
        class: 'chip',
        type: 'button',
        'aria-pressed': String(entry.base === base.from),
        onclick: () => {
          base.from = entry.base;
          persist();
          renderStage();
        }
      }, entry.label)
    )
  );
  container.appendChild(h('div', { class: 'section-label' }, '快捷源进制'));
  container.appendChild(quick);

  const output = h('div');
  container.appendChild(output);

  function update() {
    clear(output);
    clear(els.status);
    els.status.className = 'panel-foot';

    const text = base.value.trim();
    if (text === '') {
      output.appendChild(h('div', { class: 'section-label' }, '结果'));
      output.appendChild(h('div', { class: 'empty' }, '输入一个整数即可看到各进制表示'));
      return;
    }

    let integer;
    try {
      integer = logic.parseInBase(text, base.from);
    } catch (error) {
      els.status.className = 'panel-foot text-err';
      els.status.textContent = `✗ ${error.message}`;
      output.appendChild(h('div', { class: 'section-label' }, '结果'));
      output.appendChild(errorBox(error.message));
      return;
    }

    const stats = logic.describeInteger(integer);
    output.appendChild(h('div', { class: 'section-label' }, '规模'));
    output.appendChild(h('div', { class: 'stat-row' },
      h('div', { class: 'stat-cell' }, h('div', { class: 'k', text: '二进制位' }), h('div', { class: 'v', text: String(stats.bits) })),
      h('div', { class: 'stat-cell' }, h('div', { class: 'k', text: '占用字节' }), h('div', { class: 'v', text: String(stats.bytes) })),
      h('div', { class: 'stat-cell' }, h('div', { class: 'k', text: '置位个数' }), h('div', { class: 'v', text: String(stats.ones) })),
      h('div', { class: 'stat-cell' }, h('div', { class: 'k', text: '十进制' }), h('div', { class: 'v', text: logic.formatInBase(integer, 10) }))
    ));

    output.appendChild(h('div', { class: 'section-label' }, '各进制表示'));
    const table = h('table', { class: 'result-table' },
      h('thead', {}, h('tr', {}, h('th', { text: '进制' }), h('th', { text: '数值' }), h('th', {})))
    );
    const body = h('tbody');
    for (const entry of logic.COMMON_BASES) {
      const rendered = logic.formatInBase(integer, entry.base, {
        upper: entry.base === 16,
        group: base.group && (entry.base === 2 || entry.base === 16) ? 4 : 0,
        prefix: entry.prefix !== ''
      });
      body.appendChild(resultRow(`${entry.label}（${entry.base}）`, rendered, { primary: entry.base === base.from }));
    }
    if (!logic.COMMON_BASES.some((entry) => entry.base === base.from)) {
      body.appendChild(resultRow(`${base.from} 进制（源）`, logic.formatInBase(integer, base.from), { primary: true }));
    }
    table.appendChild(body);
    output.appendChild(table);

    output.appendChild(h('div', { class: 'section-label' }, '字节序'));
    const swapped = logic.swapEndianness(integer, stats.bytes);
    const swapTable = h('table', { class: 'result-table' }, h('tbody'));
    swapTable.querySelector('tbody').appendChild(resultRow(`按 ${stats.bytes} 字节翻转`, logic.formatInBase(swapped, 16, { upper: true, prefix: true })));
    swapTable.querySelector('tbody').appendChild(resultRow('翻转后十进制', logic.formatInBase(swapped, 10)));
    output.appendChild(swapTable);

    els.status.textContent = `已识别为 ${base.from} 进制整数`;
  }

  update();
}

/* ── 视图二：位运算 ───────────────────────────────────────── */

function renderBits(container) {
  const { bits } = state;

  const aInput = textInput(bits.a, { placeholder: '操作数 a', ariaLabel: '操作数 a' });
  const aBaseSelect = select(
    logic.COMMON_BASES.map((entry) => ({ value: entry.base, label: `a 是${entry.label}` })),
    bits.aBase,
    'a 的进制',
    (value) => {
      bits.aBase = Number(value);
      persist();
      update();
    }
  );

  const bInput = textInput(bits.b, { placeholder: '操作数 b', ariaLabel: '操作数 b' });
  const bBaseSelect = select(
    logic.COMMON_BASES.map((entry) => ({ value: entry.base, label: `b 是${entry.label}` })),
    bits.bBase,
    'b 的进制',
    (value) => {
      bits.bBase = Number(value);
      persist();
      update();
    }
  );

  const opSelect = select(
    logic.BIT_OPERATIONS.map((operation) => ({ value: operation.id, label: `${operation.label}（${operation.symbol}）` })),
    bits.op,
    '位运算',
    (value) => {
      bits.op = value;
      persist();
      renderStage();
    }
  );
  opSelect.classList.add('operator-select');

  const widthInput = h('input', { type: 'number', min: '1', max: '1024', value: String(bits.width), 'aria-label': 'NOT 的位宽' });
  widthInput.addEventListener('input', debounce(() => {
    bits.width = Math.min(1024, Math.max(1, Number(widthInput.value) || 32));
    persist();
    update();
  }, 200));

  aInput.addEventListener('input', debounce(() => {
    bits.a = aInput.value;
    persist();
    update();
  }, 180));
  bInput.addEventListener('input', debounce(() => {
    bits.b = bInput.value;
    persist();
    update();
  }, 180));

  const isNot = bits.op === 'not';

  container.appendChild(h('div', { class: 'work-row' },
    field('操作数 a', aInput, { wide: true }),
    field('进制', aBaseSelect)
  ));

  if (!isNot) {
    container.appendChild(h('div', { class: 'work-row' },
      field('操作数 b', bInput, { wide: true }),
      field('进制', bBaseSelect)
    ));
  }

  container.appendChild(h('div', { class: 'work-row' },
    field('运算', opSelect),
    isNot ? field('位宽', widthInput) : null
  ));

  const output = h('div');
  container.appendChild(output);

  function update() {
    clear(output);
    clear(els.status);
    els.status.className = 'panel-foot';

    let left;
    let right = 0n;
    try {
      left = logic.parseInBase(bits.a, bits.aBase);
      if (!isNot) right = logic.parseInBase(bits.b, bits.bBase);
    } catch (error) {
      els.status.className = 'panel-foot text-err';
      els.status.textContent = `✗ ${error.message}`;
      output.appendChild(errorBox(error.message));
      return;
    }

    let result;
    try {
      result = logic.applyBitOperation(bits.op, left, right, { width: bits.width });
    } catch (error) {
      els.status.className = 'panel-foot text-err';
      els.status.textContent = `✗ ${error.message}`;
      output.appendChild(errorBox(error.message));
      return;
    }

    const operation = logic.BIT_OPERATIONS.find((entry) => entry.id === bits.op);
    const expression = isNot
      ? `~a（按 ${bits.width} 位取反）`
      : `${logic.formatInBase(left, bits.aBase)} ${operation.label.split(' ')[1]} ${logic.formatInBase(right, bits.bBase)}`;

    output.appendChild(h('div', { class: 'formula', text: `${expression}  =  ${logic.formatInBase(result, 10)}` }));

    const stats = logic.describeInteger(result);
    output.appendChild(h('div', { class: 'stat-row' },
      h('div', { class: 'stat-cell' }, h('div', { class: 'k', text: '二进制位' }), h('div', { class: 'v', text: String(stats.bits) })),
      h('div', { class: 'stat-cell' }, h('div', { class: 'k', text: '占用字节' }), h('div', { class: 'v', text: String(stats.bytes) })),
      h('div', { class: 'stat-cell' }, h('div', { class: 'k', text: '置位个数' }), h('div', { class: 'v', text: String(stats.ones) }))
    ));

    const table = h('table', { class: 'result-table' },
      h('thead', {}, h('tr', {}, h('th', { text: '进制' }), h('th', { text: '结果' }), h('th', {})))
    );
    const body = h('tbody');
    for (const entry of logic.COMMON_BASES) {
      body.appendChild(resultRow(`${entry.label}（${entry.base}）`, logic.formatInBase(result, entry.base, {
        upper: entry.base === 16,
        prefix: entry.prefix !== ''
      }), { primary: entry.base === 10 }));
    }
    table.appendChild(body);
    output.appendChild(table);

    els.status.textContent = '位运算使用 BigInt，不会像 32 位整数那样溢出';
  }

  update();
}

/* ── 视图三：单位换算 ─────────────────────────────────────── */

function renderUnits(container) {
  const { units } = state;

  const category = logic.getCategory(units.category) || logic.UNIT_CATEGORIES[0];
  if (!category.units.some((unit) => unit.id === units.from)) units.from = category.units[0].id;
  if (!category.units.some((unit) => unit.id === units.to)) {
    units.to = category.units[Math.min(1, category.units.length - 1)].id;
  }

  const categorySelect = select(
    logic.UNIT_CATEGORIES.map((entry) => ({ value: entry.id, label: entry.label })),
    units.category,
    '单位类别',
    (value) => {
      units.category = value;
      const next = logic.getCategory(value);
      units.from = next.units[0].id;
      units.to = next.units[Math.min(1, next.units.length - 1)].id;
      persist();
      renderStage();
    }
  );

  const valueInput = h('input', {
    type: 'text',
    class: 'mono',
    value: units.value,
    spellcheck: 'false',
    'aria-label': '待换算的数值'
  });

  const fromSelect = select(
    category.units.map((unit) => ({ value: unit.id, label: unit.label })),
    units.from,
    '源单位',
    (value) => {
      units.from = value;
      persist();
      update();
    }
  );

  const toSelect = select(
    category.units.map((unit) => ({ value: unit.id, label: unit.label })),
    units.to,
    '目标单位',
    (value) => {
      units.to = value;
      persist();
      update();
    }
  );

  const swapButton = h('button', { class: 'btn btn-sm', type: 'button', title: '互换源与目标单位' }, '⇅');
  swapButton.addEventListener('click', () => {
    const previous = units.from;
    units.from = units.to;
    units.to = previous;
    persist();
    renderStage();
  });

  valueInput.addEventListener('input', debounce(() => {
    units.value = valueInput.value;
    persist();
    update();
  }, 180));

  container.appendChild(h('div', { class: 'work-row' },
    field('类别', categorySelect),
    field('数值', valueInput, { wide: true })
  ));

  container.appendChild(h('div', { class: 'work-row' },
    field('从', fromSelect),
    swapButton,
    field('到', toSelect)
  ));

  const output = h('div');
  container.appendChild(output);

  function update() {
    clear(output);
    clear(els.status);
    els.status.className = 'panel-foot';

    const text = units.value.trim();
    if (text === '') {
      output.appendChild(h('div', { class: 'empty' }, '输入数值即可换算'));
      return;
    }

    let amount;
    let converted;
    try {
      amount = logic.parseNumber(text);
      converted = logic.convertUnit(amount, units.category, units.from, units.to);
    } catch (error) {
      els.status.className = 'panel-foot text-err';
      els.status.textContent = `✗ ${error.message}`;
      output.appendChild(errorBox(error.message));
      return;
    }

    const fromUnit = category.units.find((unit) => unit.id === units.from);
    const toUnit = category.units.find((unit) => unit.id === units.to);

    output.appendChild(h('div', { class: 'stat-row' },
      h('div', { class: 'stat-cell' }, h('div', { class: 'k', text: '输入' }), h('div', { class: 'v', text: `${logic.formatNumber(amount)} ${fromUnit.label}` })),
      h('div', { class: 'stat-cell' }, h('div', { class: 'k', text: '结果' }), h('div', { class: 'v', text: `${logic.formatNumber(converted)} ${toUnit.label}` }))
    ));

    output.appendChild(h('div', { class: 'section-label' }, `换算成${category.label}的其它单位`));
    const table = h('table', { class: 'result-table' },
      h('thead', {}, h('tr', {}, h('th', { text: '单位' }), h('th', { text: '数值' }), h('th', {})))
    );
    const body = h('tbody');
    for (const row of logic.convertToAllUnits(amount, units.category, units.from)) {
      const rendered = `${logic.formatNumber(row.value)} ${row.label}`;
      body.appendChild(resultRow(row.label, rendered, { primary: row.id === units.to }));
    }
    table.appendChild(body);
    output.appendChild(table);

    els.status.textContent = category.id === 'temperature'
      ? '温度换算带偏移量，不是简单倍率'
      : '结果已消除浮点噪声（保留 12 位有效数字）';
  }

  update();
}

/* ── 渲染与初始化 ─────────────────────────────────────────── */

const RENDERERS = { base: renderBase, bits: renderBits, units: renderUnits };

const HINTS = {
  base: '使用 BigInt，任意精度都不丢位',
  bits: '位运算在 BigInt 上进行，不受 32 位限制',
  units: '7 类常用单位，含十进制与二进制存储单位'
};

function renderStage() {
  for (const tab of els.modes.querySelectorAll('[role="tab"]')) {
    tab.setAttribute('aria-selected', String(tab.dataset.mode === state.mode));
  }
  clear(els.stage);
  (RENDERERS[state.mode] || renderBase)(els.stage);
  els.hint.textContent = HINTS[state.mode] || '';
}

function init() {
  els.modes = $('#modes');
  els.stage = $('#stage');
  els.status = $('#status');
  els.hint = $('#hint');

  if (!RENDERERS[state.mode]) state.mode = 'base';

  for (const tab of els.modes.querySelectorAll('[role="tab"]')) {
    tab.addEventListener('click', () => {
      state.mode = tab.dataset.mode;
      persist();
      renderStage();
    });
  }

  mountTool({
    actions: [
      { id: 'mode-base', label: '进制转换', icon: 'codec', primary: true, keywords: 'base 进制 hex binary', run: () => switchMode('base') },
      { id: 'mode-bits', label: '位运算', icon: 'sliders', keywords: 'bit and or xor shift 位运算', run: () => switchMode('bits') },
      { id: 'mode-units', label: '单位换算', icon: 'converter', keywords: 'unit convert 单位 换算', run: () => switchMode('units') },
      {
        id: 'common-bases',
        label: '用十六进制查看当前数值',
        icon: 'codec',
        keywords: 'hex 十六进制',
        run: () => {
          state.mode = 'base';
          state.base.from = 16;
          persist();
          renderStage();
        }
      }
    ]
  });

  renderStage();
}

function switchMode(mode) {
  state.mode = mode;
  persist();
  renderStage();
}

init();
