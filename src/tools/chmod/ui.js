/* 文件权限计算界面层 */

import { h, mount, clear, $, debounce } from '../../core/dom.js';
import { mountTool } from '../../core/app.js';
import { icon } from '../../core/icons.js';
import { copyButton } from '../../core/widgets.js';
import { read, write } from '../../core/storage.js';
import * as toast from '../../core/toast.js';
import * as logic from './logic.js';

const STORAGE_ID = 'chmod';
const GROUPS = [
  { id: 'u', label: '所有者' },
  { id: 'g', label: '所属组' },
  { id: 'o', label: '其他人' }
];
const PERMISSIONS = [
  { id: 'r', bit: 4, label: 'r' },
  { id: 'w', bit: 2, label: 'w' },
  { id: 'x', bit: 1, label: 'x' }
];

const els = {};
const state = {
  mode: logic.parseOctal(read(`${STORAGE_ID}:mode`, '755')) || 0o755,
  tryChange: read(`${STORAGE_ID}:tryChange`, '') || ''
};

let syncing = false;

function persist() {
  write(`${STORAGE_ID}:mode`, logic.toOctal(state.mode));
  write(`${STORAGE_ID}:tryChange`, state.tryChange);
}

/* ── 逐位勾选 ─────────────────────────────────────────────── */

function renderGrid() {
  const box = $('#grid');
  clear(box);

  for (const group of GROUPS) {
    const shift = group.id === 'u' ? 6 : group.id === 'g' ? 3 : 0;
    const bits = (state.mode >> shift) & 7;

    const row = h('div', { class: 'perm-row' },
      h('span', { class: 'perm-owner', text: group.label }),
      ...PERMISSIONS.map((permission) =>
        h('button', {
          class: 'perm-toggle',
          type: 'button',
          'aria-pressed': String((bits & permission.bit) !== 0),
          'aria-label': `${group.label}的${permission.label}权限`,
          title: `${group.label} ${permission.label}`,
          onclick: () => {
            const current = (state.mode >> shift) & 7;
            const next = current ^ permission.bit;
            state.mode = (state.mode & ~(7 << shift)) | (next << shift);
            persist();
            syncFromState();
          }
        }, permission.label)
      ),
      h('span', { class: 'perm-octal', text: String(bits) }),
      h('span', { class: 'perm-hint', text: describeBits(bits) })
    );

    box.appendChild(row);
  }

  const specials = h('div', { class: 'special-row' },
    logic.SPECIAL_BITS.map((entry) => {
      const box = h('input', { type: 'checkbox', id: `special-${entry.id}`, checked: (state.mode & entry.mask) !== 0 });
      box.addEventListener('change', () => {
        state.mode = box.checked ? state.mode | entry.mask : state.mode & ~entry.mask;
        persist();
        syncFromState();
      });
      return h('label', { class: 'check', for: `special-${entry.id}`, title: entry.note }, box, h('span', { text: entry.label }));
    })
  );
  box.appendChild(specials);
}

function describeBits(bits) {
  const labels = [];
  if (bits & 4) labels.push('读');
  if (bits & 2) labels.push('写');
  if (bits & 1) labels.push('执行');
  return labels.length ? labels.join(' · ') : '无权限';
}

/* ── 常用权限 ─────────────────────────────────────────────── */

function renderCommon() {
  const box = $('#common');
  mount(box, logic.COMMON_MODES.map((entry) =>
    h('button', {
      class: 'common-item',
      type: 'button',
      title: `使用 ${logic.toOctal(entry.mode)}`,
      onclick: () => {
        state.mode = entry.mode;
        persist();
        syncFromState();
        toast.ok(`已选择 ${logic.toOctal(entry.mode)}`);
      }
    },
      h('span', { class: 'common-octal', text: logic.toOctal(entry.mode) }),
      h('span', { class: 'common-symbolic', text: entry.label }),
      h('span', { class: 'common-note', text: entry.note })
    )
  ));
}

/* ── 结果渲染 ─────────────────────────────────────────────── */

function resultRow(name, value) {
  return h('tr', {},
    h('td', { class: 'col-name', text: name }),
    h('td', { class: 'col-value', text: value }),
    h('td', { class: 'col-actions' }, copyButton(() => value, { title: `复制${name}` }))
  );
}

function renderOutput() {
  const box = $('#output');
  clear(box);
  clear(els.foot);

  const summary = logic.summarize(state.mode);

  box.appendChild(h('div', { class: 'summary-card' },
    h('div', { class: 'big', text: summary.octal }),
    h('div', { class: 'sub', text: summary.lsStyle })
  ));

  if (summary.specials.length) {
    box.appendChild(h('div', { style: { marginBottom: '12px' } },
      summary.specials.map((name) => h('span', { class: 'special-tag', text: name }))
    ));
  }

  const table = h('table', { class: 'result-table' },
    h('thead', {}, h('tr', {}, h('th', { text: '表示' }), h('th', { text: '值' }), h('th', {})))
  );
  const body = h('tbody');
  body.appendChild(resultRow('八进制', summary.octal));
  body.appendChild(resultRow('四位八进制', summary.octalWithSpecial));
  body.appendChild(resultRow('符号', summary.symbolic));
  body.appendChild(resultRow('ls -l 风格', summary.lsStyle));
  table.appendChild(body);
  box.appendChild(table);

  box.appendChild(h('div', { class: 'section-label' }, '逐组说明'));
  const detail = h('table', { class: 'result-table' },
    h('thead', {}, h('tr', {}, h('th', { text: '对象' }), h('th', { text: '字符' }), h('th', { text: '八进制' }), h('th', { text: '含义' })))
  );
  const detailBody = h('tbody');
  for (const group of summary.groups) {
    detailBody.appendChild(h('tr', {},
      h('td', { class: 'col-name', text: group.label }),
      h('td', { class: 'col-value', text: group.text }),
      h('td', { class: 'col-value', text: group.octal }),
      h('td', { class: 'col-name', text: group.labels.join('、') })
    ));
  }
  detail.appendChild(detailBody);
  box.appendChild(detail);

  box.appendChild(h('div', { class: 'section-label' }, '可用的命令'));
  const commands = [
    `chmod ${summary.octal} <文件>`,
    `chmod ${summary.symbolic.slice(0, 3)},${summary.symbolic.slice(3, 6)},${summary.symbolic.slice(6)} <文件>`
  ];
  box.appendChild(h('pre', { class: 'code-block', text: commands.join('\n') }));
  box.appendChild(h('div', { class: 'row', style: { marginTop: '8px' } },
    copyButton(() => commands.join('\n'), { label: '复制命令', title: '复制 chmod 命令' })
  ));

  // 试算增量改动
  const tryInput = h('input', {
    type: 'text',
    class: 'mono',
    value: state.tryChange,
    placeholder: '试试 u+x 或 go-w 或 a=rw',
    spellcheck: 'false',
    'aria-label': '增量改动'
  });
  const tryResult = h('div', { style: { marginTop: '8px' } });

  const runTry = () => {
    state.tryChange = tryInput.value;
    persist();
    clear(tryResult);
    const text = tryInput.value.trim();
    if (text === '') return;
    try {
      const next = logic.applySymbolicChange(state.mode, text);
      const relation = logic.compareModes(state.mode, next);
      const relationText = relation === 'wider' ? '放宽' : relation === 'narrower' ? '收紧' : relation === 'same' ? '无变化' : '部分变化';
      tryResult.appendChild(h('div', { class: 'hint' },
        `${logic.toOctal(state.mode)} → `,
        h('strong', { class: 'mono', text: logic.toOctal(next) }),
        `（${logic.toSymbolic(next)}）· ${relationText}`
      ));
      const applyButton = h('button', { class: 'btn btn-sm', type: 'button', style: { marginTop: '6px' } }, '应用这个结果');
      applyButton.addEventListener('click', () => {
        state.mode = next;
        persist();
        syncFromState();
      });
      tryResult.appendChild(applyButton);
    } catch (error) {
      tryResult.appendChild(h('div', { class: 'hint text-err', text: error.message }));
    }
  };

  tryInput.addEventListener('input', debounce(runTry, 220));
  box.appendChild(h('div', { class: 'section-label' }, '试算增量改动'));
  box.appendChild(h('div', { class: 'try-row' }, h('div', { class: 'field' }, tryInput)));
  box.appendChild(tryResult);
  runTry();

  els.foot.textContent = state.mode === 0o777
    ? '⚠ 777 会让所有人拥有完全权限，生产环境请谨慎'
    : '特殊位：setuid / setgid / sticky，按 ls -l 惯例显示为 s 与 t';
}

/* ── 输入与同步 ───────────────────────────────────────────── */

function parseInput(text) {
  const source = String(text ?? '').trim();
  if (source === '') return null;
  if (/^[0-7]{3,4}$/.test(source) || /^0o[0-7]{3,4}$/i.test(source)) return logic.parseOctal(source);
  const parsed = logic.parseSymbolic(source);
  return parsed.mode;
}

function syncFromState() {
  syncing = true;
  els.input.value = logic.toOctal(state.mode);
  els.input.classList.remove('invalid');
  els.status.className = 'panel-foot';
  els.status.textContent = `${logic.toSymbolic(state.mode)} · ${logic.toOctal(state.mode)}`;
  syncing = false;

  renderGrid();
  renderOutput();
}

function handleInput() {
  if (syncing) return;
  const text = els.input.value.trim();

  if (text === '') {
    els.input.classList.remove('invalid');
    els.status.className = 'panel-foot';
    els.status.textContent = '等待输入';
    return;
  }

  try {
    const mode = parseInput(text);
    if (mode === null) return;
    state.mode = mode;
    persist();
    els.input.classList.remove('invalid');
    els.status.className = 'panel-foot';
    els.status.textContent = `${logic.toSymbolic(state.mode)} · ${logic.toOctal(state.mode)}`;
    renderGrid();
    renderOutput();
  } catch (error) {
    els.input.classList.add('invalid');
    els.status.className = 'panel-foot text-err';
    els.status.textContent = `✗ ${error.message}`;
  }
}

/* ── 初始化 ───────────────────────────────────────────────── */

function init() {
  els.input = $('#mode-input');
  els.status = $('#status');
  els.foot = $('#foot');

  els.input.value = logic.toOctal(state.mode);
  els.input.addEventListener('input', debounce(handleInput, 220));

  $('#btn-clear').addEventListener('click', () => {
    state.mode = 0;
    persist();
    syncFromState();
    els.input.focus();
  });

  renderCommon();

  mountTool({
    actions: [
      { id: 'focus', label: '编辑权限输入', icon: 'sliders', primary: true, keywords: 'input 输入', run: () => els.input.focus() },
      { id: 'reset-644', label: '设为 644（普通文件）', icon: 'markdown', keywords: '644 file', run: () => setMode(0o644) },
      { id: 'reset-755', label: '设为 755（可执行 / 目录）', icon: 'markdown', keywords: '755 dir', run: () => setMode(0o755) },
      { id: 'reset-600', label: '设为 600（私钥）', icon: 'markdown', keywords: '600 key', run: () => setMode(0o600) },
      { id: 'reset-700', label: '设为 700（~/.ssh）', icon: 'markdown', keywords: '700 ssh', run: () => setMode(0o700) },
      {
        id: 'copy-command',
        label: '复制 chmod 命令',
        icon: 'copy',
        keywords: 'copy 复制 命令',
        run: async () => {
          const { copy } = await import('../../core/clipboard.js');
          const summary = logic.summarize(state.mode);
          if (await copy(`chmod ${summary.octal} <文件>`)) toast.ok('已复制命令');
          else toast.fail('复制失败');
        }
      }
    ]
  });

  syncFromState();
}

function setMode(mode) {
  state.mode = mode;
  persist();
  syncFromState();
}

init();
