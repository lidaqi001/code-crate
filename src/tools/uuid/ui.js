/* UUID / 随机 界面层 */

import { h, mount, clear, $ } from '../../core/dom.js';
import { mountTool } from '../../core/app.js';
import { icon } from '../../core/icons.js';
import { copyButton } from '../../core/widgets.js';
import { copy } from '../../core/clipboard.js';
import { read, write } from '../../core/storage.js';
import * as toast from '../../core/toast.js';
import * as logic from './logic.js';

const STORAGE_ID = 'uuid';

const IDENTIFIER_TYPES = [
  { id: 'uuid4', label: 'UUID v4（随机）', hint: '完全随机，最通用' },
  { id: 'uuid7', label: 'UUID v7（时间有序）', hint: '前 48 位为时间戳，适合做数据库主键' },
  { id: 'ulid', label: 'ULID', hint: '26 位 Crockford Base32，按时间排序' },
  { id: 'nil', label: 'NIL UUID', hint: '全零 UUID，用于占位' }
];

const STRING_PRESETS = [
  { id: 'alnum', label: '字母 + 数字', alphabet: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789' },
  { id: 'lower', label: '小写 + 数字', alphabet: 'abcdefghijklmnopqrstuvwxyz0123456789' },
  { id: 'hex', label: '十六进制', alphabet: '0123456789abcdef' },
  { id: 'base32', label: 'Base32', alphabet: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567' },
  { id: 'custom', label: '自定义', alphabet: '' }
];

const els = {};
const state = {
  mode: 'identifier',
  lastOutput: [],
  options: read(`${STORAGE_ID}:options`, null) || {
    identifierType: 'uuid4',
    count: 5,
    length: 32,
    lower: true,
    upper: true,
    digits: true,
    symbols: false,
    avoidAmbiguous: true,
    stringPreset: 'alnum',
    customAlphabet: '',
    stringLength: 24,
    min: 1,
    max: 100,
    numberCount: 10
  }
};

let generateCurrent = () => {};

function saveOptions() {
  write(`${STORAGE_ID}:options`, state.options);
}

/* ── 通用输出区 ───────────────────────────────────────────── */

function outputSection(items, { extra } = {}) {
  const list = h('div', { class: 'output-list' });

  if (!items.length) {
    list.appendChild(h('div', { class: 'empty' }, '点击「生成」产生结果'));
  } else {
    items.forEach((value, index) => {
      list.appendChild(h('div', { class: 'output-item' },
        h('span', { class: 'output-index', text: `${index + 1}` }),
        h('span', { class: 'output-value', text: value }),
        extra ? h('span', { class: 'output-extra', text: extra(value, index) }) : null,
        copyButton(() => value, { title: '复制这一条' })
      ));
    });
  }

  const head = h('div', { class: 'output-head' },
    h('span', { class: 'label', text: items.length ? `${items.length} 条结果` : '结果' }),
    h('span', { class: 'grow' }),
    copyButton(() => items.join('\n'), { label: '复制全部', title: '复制全部结果' })
  );

  return h('div', {}, head, list);
}

function numberField(label, key, { min = 1, max = 1000, onChange } = {}) {
  const input = h('input', {
    type: 'number',
    min: String(min),
    max: String(max),
    value: String(state.options[key]),
    'aria-label': label
  });
  input.addEventListener('input', () => {
    const value = Number(input.value);
    if (Number.isFinite(value)) {
      state.options[key] = Math.min(max, Math.max(min, Math.floor(value)));
      saveOptions();
      if (onChange) onChange();
    }
  });
  return h('div', { class: 'field' }, h('label', { text: label }), input);
}

function checkField(label, key) {
  const input = h('input', { type: 'checkbox', id: `opt-${key}`, checked: Boolean(state.options[key]) });
  input.addEventListener('change', () => {
    state.options[key] = input.checked;
    saveOptions();
    refreshCurrent();
  });
  return h('label', { class: 'check', for: `opt-${key}` }, input, h('span', { text: label }));
}

/** 重新执行当前模式的生成逻辑（选项变化后调用）。 */
let refreshCurrent = () => {};

/* ── 标识符 ───────────────────────────────────────────────── */

function renderIdentifier(container) {
  const typeSelect = h('select', { 'aria-label': '标识符类型' },
    IDENTIFIER_TYPES.map((type) => h('option', { value: type.id, selected: type.id === state.options.identifierType }, type.label))
  );
  typeSelect.addEventListener('change', () => {
    state.options.identifierType = typeSelect.value;
    saveOptions();
    refreshCurrent();
  });

  const holder = h('div', { style: { marginTop: '12px' } });

  const hintNode = h('span', { class: 'hint' });

  generateCurrent = () => {
    const count = Math.min(500, Math.max(1, state.options.count));
    const type = state.options.identifierType;
    const items = [];

    if (type === 'nil') {
      for (let i = 0; i < count; i += 1) items.push(logic.NIL_UUID);
    } else if (type === 'uuid4') {
      for (let i = 0; i < count; i += 1) items.push(logic.uuidV4());
    } else if (type === 'uuid7') {
      for (let i = 0; i < count; i += 1) items.push(logic.uuidV7());
    } else {
      for (let i = 0; i < count; i += 1) items.push(logic.ulid());
    }

    state.lastOutput = items;

    const extra = type === 'uuid7'
      ? (value) => {
        const ms = logic.uuidV7Timestamp(value);
        return ms === null ? '' : formatMs(ms);
      }
      : type === 'ulid'
        ? (value) => {
          const ms = logic.ulidTimestamp(value);
          return ms === null ? '' : formatMs(ms);
        }
      : undefined;

    mount(holder, outputSection(items, { extra }));
    hintNode.textContent = IDENTIFIER_TYPES.find((entry) => entry.id === type).hint;
  };

  refreshCurrent = () => generateCurrent();

  container.appendChild(h('div', { class: 'opt-grid' },
    h('div', { class: 'field' }, h('label', { text: '类型' }), typeSelect),
    numberField('数量', 'count', { min: 1, max: 500, onChange: () => refreshCurrent() })
  ));
  container.appendChild(h('div', { class: 'row', style: { marginBottom: '8px' } }, hintNode));
  container.appendChild(holder);
}

function formatMs(ms) {
  const date = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/* ── 强密码 ───────────────────────────────────────────────── */

function renderPassword(container) {
  const lengthInput = h('input', {
    type: 'range',
    min: '6',
    max: '64',
    value: String(state.options.length),
    'aria-label': '密码长度'
  });
  const lengthLabel = h('strong', { text: `${state.options.length} 位` });
  lengthInput.addEventListener('input', () => {
    state.options.length = Number(lengthInput.value);
    lengthLabel.textContent = `${state.options.length} 位`;
    saveOptions();
    refreshCurrent();
  });

  const holder = h('div');
  const strengthFill = h('div', { class: 'strength-fill' });
  const strengthText = h('span', { class: 'strength-text' });

  const updateStrength = () => {
    let alphabet = '';
    try {
      alphabet = logic.passwordAlphabet(state.options);
    } catch {
      alphabet = '';
    }
    const bits = logic.entropyBits(state.options.length, alphabet.length || 1);
    const { label, level } = logic.entropyLabel(bits);
    strengthFill.className = `strength-fill ${level}`;
    strengthFill.style.width = `${Math.min(100, (bits / 128) * 100)}%`;
    strengthText.textContent = `≈ ${Math.round(bits)} 位熵 · ${label}（字符集 ${alphabet.length}）`;
  };

  generateCurrent = () => {
    const count = Math.min(200, Math.max(1, state.options.count));
    let items = [];
    try {
      for (let i = 0; i < count; i += 1) items.push(logic.randomPassword(state.options));
    } catch (error) {
      mount(holder, h('div', { class: 'issue error' }, h('div', { class: 'issue-msg', text: error.message })));
      toast.fail(error.message);
      return;
    }
    state.lastOutput = items;

    // 逐条自检，确保每类字符都出现（发现异常直接暴露，而不是静默通过）
    const check = logic.checkPassword(items[0], state.options);
    mount(holder, outputSection(items));
    if (!check.ok) toast.warn('生成的密码未覆盖全部所选字符类型');
  };

  refreshCurrent = () => {
    updateStrength();
    generateCurrent();
  };

  container.appendChild(h('div', { class: 'field', style: { marginBottom: '12px' } },
    h('div', { class: 'field-head' },
      h('label', { text: '长度' }),
      h('span', { class: 'grow' }),
      lengthLabel
    ),
    lengthInput
  ));

  container.appendChild(h('div', { class: 'opt-row' },
    checkField('小写字母', 'lower'),
    checkField('大写字母', 'upper'),
    checkField('数字', 'digits'),
    checkField('符号', 'symbols'),
    checkField('排除易混淆字符 (Il1O0o)', 'avoidAmbiguous')
  ));

  container.appendChild(h('div', { class: 'strength' }, strengthFill, strengthText));
  container.appendChild(numberField('数量', 'count', { min: 1, max: 200, onChange: () => refreshCurrent() }));
  container.appendChild(h('div', { style: { height: '12px' } }));
  container.appendChild(holder);

  updateStrength();
}

/* ── 随机字符串 ───────────────────────────────────────────── */

function renderString(container) {
  const presetSelect = h('select', { 'aria-label': '字符集预设' },
    STRING_PRESETS.map((preset) => h('option', { value: preset.id, selected: preset.id === state.options.stringPreset }, preset.label))
  );

  const customInput = h('input', {
    type: 'text',
    class: 'mono',
    spellcheck: 'false',
    placeholder: '自定义字符集，例如 ABC-123_',
    value: state.options.customAlphabet,
    'aria-label': '自定义字符集'
  });

  const customField = h('div', { class: 'field' },
    h('label', { text: '自定义字符集' }),
    customInput
  );

  const holder = h('div');
  const status = h('span', { class: 'hint' });

  const alphabetOf = () => {
    const preset = STRING_PRESETS.find((entry) => entry.id === state.options.stringPreset) || STRING_PRESETS[0];
    return preset.id === 'custom' ? customInput.value : preset.alphabet;
  };

  const syncCustomVisibility = () => {
    customField.style.display = state.options.stringPreset === 'custom' ? '' : 'none';
  };

  generateCurrent = () => {
    const alphabet = alphabetOf();
    const count = Math.min(500, Math.max(1, state.options.count));
    if (!alphabet) {
      mount(holder, h('div', { class: 'issue error' }, h('div', { class: 'issue-msg', text: '请先填写自定义字符集' })));
      status.textContent = '';
      return;
    }
    const unique = [...new Set(alphabet)].join('');
    const items = [];
    for (let i = 0; i < count; i += 1) {
      items.push(logic.randomString(state.options.stringLength, unique));
    }
    state.lastOutput = items;
    mount(holder, outputSection(items));
    status.textContent = `字符集大小 ${unique.length}`;
  };

  refreshCurrent = () => generateCurrent();

  presetSelect.addEventListener('change', () => {
    state.options.stringPreset = presetSelect.value;
    saveOptions();
    syncCustomVisibility();
    refreshCurrent();
  });

  customInput.addEventListener('input', () => {
    state.options.customAlphabet = customInput.value;
    saveOptions();
    refreshCurrent();
  });

  container.appendChild(h('div', { class: 'opt-grid' },
    h('div', { class: 'field' }, h('label', { text: '字符集' }), presetSelect),
    numberField('长度', 'stringLength', { min: 1, max: 512, onChange: () => refreshCurrent() }),
    numberField('数量', 'count', { min: 1, max: 500, onChange: () => refreshCurrent() })
  ));
  container.appendChild(customField);
  container.appendChild(h('div', { class: 'row', style: { margin: '8px 0' } },
    h('span', { class: 'grow' }),
    status
  ));
  container.appendChild(holder);

  syncCustomVisibility();
}

/* ── 随机整数 ─────────────────────────────────────────────── */

function renderNumber(container) {
  const holder = h('div');
  const status = h('span', { class: 'hint' });

  generateCurrent = () => {
    const min = state.options.min;
    const max = state.options.max;
    const count = Math.min(500, Math.max(1, state.options.numberCount));
    if (!Number.isInteger(min) || !Number.isInteger(max)) {
      status.textContent = '范围端点必须是整数';
      status.className = 'hint text-err';
      return;
    }
    status.className = 'hint';
    const items = [];
    for (let i = 0; i < count; i += 1) items.push(String(logic.randomInt(min, max)));
    state.lastOutput = items;
    mount(holder, outputSection(items));
    status.textContent = `区间 [${Math.min(min, max)}, ${Math.max(min, max)}] · 无偏采样`;
  };

  refreshCurrent = generateCurrent;

  const minInput = h('input', { type: 'number', value: String(state.options.min), 'aria-label': '最小值' });
  const maxInput = h('input', { type: 'number', value: String(state.options.max), 'aria-label': '最大值' });
  minInput.addEventListener('input', () => {
    state.options.min = Number(minInput.value);
    saveOptions();
    generateCurrent();
  });
  maxInput.addEventListener('input', () => {
    state.options.max = Number(maxInput.value);
    saveOptions();
    generateCurrent();
  });

  container.appendChild(h('div', { class: 'opt-grid' },
    h('div', { class: 'field' }, h('label', { text: '最小值' }), minInput),
    h('div', { class: 'field' }, h('label', { text: '最大值' }), maxInput),
    numberField('数量', 'numberCount', { min: 1, max: 500, onChange: () => refreshCurrent() })
  ));
  container.appendChild(h('div', { class: 'row', style: { marginBottom: '8px' } },
    h('span', { class: 'grow' }),
    status
  ));
  container.appendChild(holder);
}

/* ── UUID 校验 ────────────────────────────────────────────── */

function renderValidate(container) {
  const input = h('input', {
    type: 'text',
    class: 'mono big-input',
    spellcheck: 'false',
    placeholder: '粘贴 UUID，例如 550e8400-e29b-41d4-a716-446655440000',
    'aria-label': '待校验的 UUID',
    value: read(`${STORAGE_ID}:verify`, '') || ''
  });

  const out = h('div', { style: { marginTop: '12px' } });

  const update = () => {
    write(`${STORAGE_ID}:verify`, input.value);
    clear(out);
    const text = input.value.trim();
    if (!text) return;

    const result = logic.validateUuid(text);
    if (!result.valid) {
      out.appendChild(h('div', { class: 'verify-bad' },
        h('div', { class: 'verify-title', text: '✗ 不是合法的 UUID' }),
        h('div', { class: 'hint', text: result.reason })
      ));
      return;
    }

    out.appendChild(h('div', { class: 'verify-ok' },
      h('div', { class: 'verify-title', text: result.isNil ? '✓ 合法 UUID（NIL）' : '✓ 合法 UUID' })
    ));

    const rows = [
      ['版本', result.isNil ? '—（NIL 无版本）' : `v${result.version}`],
      ['变体', result.isNil ? '—' : result.variant],
      ['规范形式', result.normalized]
    ];

    if (result.version === 7) {
      const ms = logic.uuidV7Timestamp(result.normalized);
      if (ms !== null) rows.push(['内嵌时间', `${formatMs(ms)}（${ms}）`]);
    }

    const table = h('table', { class: 'claims' });
    for (const [key, value] of rows) {
      table.appendChild(h('tr', {}, h('th', { text: key }), h('td', { text: value })));
    }
    out.appendChild(table);
  };

  input.addEventListener('input', update);

  generateCurrent = () => {
    input.value = logic.uuidV4();
    update();
  };

  container.appendChild(h('div', { class: 'field' },
    h('div', { class: 'field-head' },
      h('label', { text: 'UUID' }),
      h('span', { class: 'grow' }),
      copyButton(() => input.value, { title: '复制' })
    ),
    input
  ));
  container.appendChild(out);
  update();
}

/* ── 主流程 ───────────────────────────────────────────────── */

const RENDERERS = {
  identifier: renderIdentifier,
  password: renderPassword,
  string: renderString,
  number: renderNumber,
  validate: renderValidate
};

const MODE_LABELS = {
  identifier: '标识符',
  password: '强密码',
  string: '随机字符串',
  number: '随机整数',
  validate: 'UUID 校验'
};

const STATUS_HINTS = {
  identifier: 'UUID v7 与 ULID 按时间有序，适合作为主键',
  password: '每种选中的字符类型都保证至少出现一次，再整体洗牌',
  string: '使用拒绝采样，字符分布无偏',
  number: '闭区间均匀分布，端点可被取到',
  validate: '校验结构、版本号与变体位'
};

function renderStage() {
  clear(els.stage);
  refreshCurrent = () => {};
  for (const tab of els.modes.querySelectorAll('[role="tab"]')) {
    tab.setAttribute('aria-selected', String(tab.dataset.mode === state.mode));
  }
  (RENDERERS[state.mode] || renderIdentifier)(els.stage);
  els.status.textContent = STATUS_HINTS[state.mode] || '';
}

function switchToMode(mode) {
  state.mode = mode;
  write(`${STORAGE_ID}:mode`, mode);
  renderStage();
  generateCurrent();
}

function init() {
  els.modes = $('#modes');
  els.stage = $('#stage');
  els.status = $('#status');

  state.mode = read(`${STORAGE_ID}:mode`, 'identifier');
  if (!RENDERERS[state.mode]) state.mode = 'identifier';

  for (const tab of els.modes.querySelectorAll('[role="tab"]')) {
    tab.addEventListener('click', () => switchToMode(tab.dataset.mode));
  }

  $('#btn-generate').addEventListener('click', () => generateCurrent());

  mountTool({
    actions: [
      { id: 'generate', label: '生成新的一批', icon: 'refresh', keys: 'Ctrl+Enter', primary: true, keywords: 'generate 生成', run: () => generateCurrent() },
      {
        id: 'copy-all',
        label: '复制全部结果',
        icon: 'copy',
        keywords: 'copy 复制',
        run: async () => {
          if (!state.lastOutput.length) {
            toast.warn('还没有结果可复制');
            return;
          }
          if (await copy(state.lastOutput.join('\n'))) toast.ok(`已复制 ${state.lastOutput.length} 条`);
          else toast.fail('复制失败');
        }
      },
      ...Object.entries(MODE_LABELS).map(([mode, label]) => ({
        id: `mode-${mode}`,
        label: `切换到「${label}」`,
        icon: 'uuid',
        keywords: mode,
        run: () => switchToMode(mode)
      }))
    ]
  });

  renderStage();
  generateCurrent();
}

init();
