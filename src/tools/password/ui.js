/* 密码与随机串界面层：选项即时生效，输出与强度实时更新。 */

import { h, mount, clear, $, debounce } from '../../core/dom.js';
import { mountTool } from '../../core/app.js';
import { icon } from '../../core/icons.js';
import { copyButton, field } from '../../core/widgets.js';
import { read, write } from '../../core/storage.js';
import * as toast from '../../core/toast.js';
import * as logic from './logic.js';

const STORAGE_ID = 'password';

const DEFAULTS = {
  length: 20,
  lower: true,
  upper: true,
  digits: true,
  symbols: true,
  avoidAmbiguous: false,
  requireEach: true,
  randomBytes: 16,
  randomFormat: 'hex'
};

const saved = read(`${STORAGE_ID}:state`, null) || {};
const state = {
  ...DEFAULTS,
  ...saved,
  length: logic.clampLength(saved.length ?? DEFAULTS.length),
  randomBytes: Math.min(logic.MAX_RANDOM_BYTES, Math.max(1, Number(saved.randomBytes) || DEFAULTS.randomBytes)),
  randomFormat: saved.randomFormat === 'base64url' ? 'base64url' : 'hex'
};

const els = {};

function persist() {
  write(`${STORAGE_ID}:state`, state);
}

/* ── 选项表单 ─────────────────────────────────────────────── */

function toggle(id, labelText, checked, onChange) {
  const input = h('input', { type: 'checkbox', id, checked });
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'toggle', for: id }, input, h('span', { text: labelText }));
}

function applyLength(value) {
  state.length = logic.clampLength(value);
  persist();
  regenerate();
}

function renderForm() {
  const form = els.form;
  clear(form);

  form.appendChild(h('div', { class: 'section-label first' }, '预设'));
  form.appendChild(h('div', { class: 'preset-row' },
    logic.PRESETS.map((preset) =>
      h('button', {
        class: 'chip',
        type: 'button',
        text: preset.label,
        onclick: () => {
          state.length = preset.length;
          Object.assign(state, preset.sets);
          state.avoidAmbiguous = preset.avoidAmbiguous;
          persist();
          renderForm();
          regenerate();
        }
      })
    )
  ));

  const range = h('input', {
    type: 'range',
    id: 'length-range',
    min: String(logic.MIN_LENGTH),
    max: String(logic.MAX_LENGTH),
    value: String(state.length),
    'aria-label': '密码长度'
  });
  const number = h('input', {
    type: 'number',
    id: 'length',
    min: String(logic.MIN_LENGTH),
    max: String(logic.MAX_LENGTH),
    value: String(state.length)
  });
  range.addEventListener('input', () => {
    number.value = range.value;
    applyLength(range.value);
  });
  number.addEventListener('input', debounce(() => {
    range.value = String(logic.clampLength(number.value));
    applyLength(number.value);
  }, 160));

  form.appendChild(h('div', { class: 'section-label' }, '长度'));
  form.appendChild(h('div', { class: 'form-grid' },
    field('密码长度', h('div', { class: 'range-row' }, range, h('output', { text: String(state.length) }))),
    field('精确值', number)
  ));

  form.appendChild(h('div', { class: 'section-label' }, '字符类型'));
  form.appendChild(h('div', { class: 'toggle-grid' },
    toggle('set-lower', '小写 a-z', state.lower, (value) => { state.lower = value; persist(); regenerate(); }),
    toggle('set-upper', '大写 A-Z', state.upper, (value) => { state.upper = value; persist(); regenerate(); }),
    toggle('set-digits', '数字 0-9', state.digits, (value) => { state.digits = value; persist(); regenerate(); }),
    toggle('set-symbols', '符号 !@#$', state.symbols, (value) => { state.symbols = value; persist(); regenerate(); })
  ));

  form.appendChild(h('div', { class: 'toggle-grid' },
    toggle('avoid-ambiguous', `排除易混字符 ${logic.AMBIGUOUS_CHARS}`, state.avoidAmbiguous, (value) => {
      state.avoidAmbiguous = value;
      persist();
      regenerate();
    }),
    toggle('require-each', '每种类型至少出现一次', state.requireEach, (value) => {
      state.requireEach = value;
      persist();
      regenerate();
    })
  ));

  form.appendChild(h('div', { class: 'note' }, '随机数来自 crypto.getRandomValues，并使用拒绝采样避免取模偏差；密码只在当前页面内存中生成，不会保存或上传。'));
}

/* ── 输出 ─────────────────────────────────────────────────── */

function regenerate() {
  try {
    const value = logic.generatePassword(state);
    els.password.value = value;
    els.password.removeAttribute('aria-invalid');

    const bits = logic.entropyBits(state);
    const strength = logic.strengthOf(bits);
    els.bar.style.width = `${strength.percent}%`;
    els.bar.className = strength.tone;
    els.label.textContent = strength.label;
    els.bits.textContent = `${bits.toFixed(1)} bit`;

    els.status.className = 'panel-foot';
    els.status.textContent = `${value.length} 位 · 候选池 ${logic.poolOf(state).length} 个字符`;
  } catch (error) {
    els.password.value = '';
    els.password.setAttribute('aria-invalid', 'true');
    els.bar.style.width = '0%';
    els.label.textContent = '—';
    els.bits.textContent = '';
    els.status.className = 'panel-foot text-err';
    els.status.textContent = `✗ ${error.message}`;
  }
}

function regenerateRandom() {
  els.random.value = logic.randomString(state.randomBytes, state.randomFormat);
}

function renderOutput() {
  clear(els.output);

  els.password = h('input', {
    type: 'text',
    id: 'password-value',
    class: 'mono password-value',
    readonly: true,
    spellcheck: 'false',
    'aria-label': '生成的密码'
  });

  els.random = h('input', {
    type: 'text',
    id: 'random-value',
    class: 'mono random-value',
    readonly: true,
    spellcheck: 'false',
    'aria-label': '随机串结果'
  });

  els.bar = h('span');
  els.label = h('span', { class: 'strength-label' });
  els.bits = h('span', { class: 'strength-bits' });

  els.output.appendChild(field('密码', els.password));
  els.output.appendChild(h('div', { class: 'strength' },
    h('div', { class: 'strength-bar' }, els.bar),
    els.label,
    els.bits
  ));

  els.output.appendChild(h('div', { class: 'section-label' }, '随机串'));
  els.output.appendChild(h('div', { class: 'random-row' },
    field('字节数', numberInput()),
    field('格式', formatSelect()),
    h('div', { class: 'field wide' },
      h('label', { for: 'random-value', text: '结果' }),
      els.random,
      h('button', {
        class: 'btn btn-sm',
        type: 'button',
        text: '重新生成',
        onclick: regenerateRandom
      })
    )
  ));
}

function numberInput() {
  const input = h('input', {
    type: 'number',
    id: 'random-bytes',
    min: '1',
    max: String(logic.MAX_RANDOM_BYTES),
    value: String(state.randomBytes)
  });
  input.addEventListener('change', () => {
    const value = Math.min(logic.MAX_RANDOM_BYTES, Math.max(1, Math.trunc(Number(input.value)) || 16));
    state.randomBytes = value;
    input.value = String(value);
    persist();
    regenerateRandom();
  });
  return input;
}

function formatSelect() {
  const select = h('select', { id: 'random-format', 'aria-label': '随机串格式' },
    h('option', { value: 'hex', selected: state.randomFormat === 'hex' }, '十六进制'),
    h('option', { value: 'base64url', selected: state.randomFormat === 'base64url' }, 'Base64URL')
  );
  select.value = state.randomFormat;
  select.addEventListener('change', () => {
    state.randomFormat = select.value;
    persist();
    regenerateRandom();
  });
  return select;
}

/* ── 初始化 ───────────────────────────────────────────────── */

function init() {
  els.form = $('#form');
  els.output = $('#output');
  els.status = $('#status');
  els.foot = $('#foot');
  els.actions = $('#actions');

  $('#btn-reset').addEventListener('click', () => {
    Object.assign(state, DEFAULTS);
    persist();
    renderForm();
    renderOutput();
    regenerate();
    regenerateRandom();
    toast.ok('已恢复默认选项');
  });

  mount(els.actions,
    copyButton(() => els.password.value, { label: '复制密码' }),
    copyButton(() => els.random.value, { label: '复制随机串' }),
    h('button', {
      class: 'btn btn-sm',
      type: 'button',
      text: '重新生成',
      onclick: () => {
        regenerate();
        regenerateRandom();
      }
    })
  );

  mountTool({
    actions: [
      { id: 'regenerate', label: '重新生成密码', icon: 'refresh', primary: true, keywords: 'regenerate random 重新 生成', run: regenerate },
      { id: 'copy-password', label: '复制密码', icon: 'copy', keywords: 'copy 复制 密码', run: () => copyButton(() => els.password.value).click() },
      { id: 'copy-random', label: '复制随机串', icon: 'copy', keywords: 'copy 复制 随机串', run: () => copyButton(() => els.random.value).click() },
      { id: 'random-regenerate', label: '重新生成随机串', icon: 'uuid', keywords: 'random token 随机 令牌', run: regenerateRandom }
    ]
  });

  renderForm();
  renderOutput();
  regenerate();
  regenerateRandom();
  els.foot.textContent = '密码不会保存到本地存储；刷新页面即重新生成。';
}

init();
