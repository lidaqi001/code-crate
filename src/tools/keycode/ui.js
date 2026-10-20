/* 按键速查界面层 */

import { h, mount, clear, $, debounce } from '../../core/dom.js';
import { mountTool } from '../../core/app.js';
import { copyButton } from '../../core/widgets.js';
import { read, write } from '../../core/storage.js';
import * as logic from './logic.js';

const STORAGE_ID = 'keycode';
const TABLE_LIMIT = 200;

const els = {};
const state = {
  query: '',
  category: read(`${STORAGE_ID}:category`, '') || ''
};

/* ── 实时按键 ─────────────────────────────────────────────── */

function renderLiveShell() {
  const zone = h('div', {
    class: 'live-zone',
    tabindex: '0',
    role: 'button',
    'aria-label': '点击此处后按下任意键查看信息'
  },
    h('div', { class: 'live-combo', id: 'live-combo', text: '点击这里，然后按任意键' }),
    h('div', { class: 'live-sub', id: 'live-sub', text: '按键信息会实时显示在下面' })
  );

  const fields = h('div', { class: 'live-fields', id: 'live-fields' });
  const hint = h('div', { class: 'code-hint', id: 'live-code' });

  const container = $('#live');
  mount(container, zone, fields, hint);

  const show = (event) => {
    const info = logic.describeKeyPress(event);
    $('#live-combo').textContent = info.combo || '(无键名)';
    $('#live-sub').textContent = info.note;

    mount(fields,
      row('event.key', info.key),
      row('event.code', info.code),
      row('event.keyCode', info.keyCode === null ? '—' : String(info.keyCode)),
      row('类别', info.category)
    );

    const snippet = logic.suggestHandler(event);
    clear(hint);
    if (snippet) {
      hint.appendChild(h('div', { class: 'section-label' }, '可用于代码的判定'));
      hint.appendChild(h('pre', { text: snippet }));
      hint.appendChild(h('div', { class: 'row', style: { marginTop: '8px' } },
        copyButton(() => snippet, { label: '复制片段', title: '复制代码片段' })
      ));
    }
  };

  zone.addEventListener('focus', () => zone.classList.add('armed'));
  zone.addEventListener('blur', () => zone.classList.remove('armed'));
  zone.addEventListener('click', () => zone.focus());
  zone.addEventListener('keydown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    show(event);
  });
}

function row(label, value) {
  return h('div', { class: 'live-row' },
    h('span', { class: 'k', text: label }),
    h('span', { class: 'v', text: value })
  );
}

/* ── 分类筛选 ─────────────────────────────────────────────── */

function renderChips() {
  const box = $('#cats');
  const entries = [{ id: '', label: '全部' }, ...logic.KEY_CATEGORIES.map((name) => ({ id: name, label: name }))];

  mount(box, entries.map((entry) =>
    h('button', {
      class: 'chip',
      type: 'button',
      'aria-pressed': String(state.category === entry.id),
      onclick: () => {
        state.category = entry.id;
        write(`${STORAGE_ID}:category`, entry.id);
        renderChips();
        renderTable();
      }
    }, entry.label)
  ));
}

/* ── 按键表 ───────────────────────────────────────────────── */

function renderTable() {
  const wrap = $('#table');
  clear(wrap);

  const results = logic.searchKeys(state.query, { category: state.category, limit: TABLE_LIMIT });
  $('#count').textContent = `${results.length} 个按键`;

  if (!results.length) {
    wrap.appendChild(h('div', { class: 'empty' }, '没有匹配的按键'));
    els.status.textContent = '';
    return;
  }

  const table = h('table', { class: 'key-table' },
    h('thead', {}, h('tr', {},
      h('th', { class: 'col-key', text: 'event.key' }),
      h('th', { class: 'col-code', text: 'event.code' }),
      h('th', { class: 'col-keycode', text: 'keyCode' }),
      h('th', { class: 'col-category', text: '分类' }),
      h('th', { class: 'col-note', text: '说明' }),
      h('th', { class: 'col-copy' })
    ))
  );

  const body = h('tbody');
  for (const entry of results) {
    body.appendChild(h('tr', {},
      h('td', { class: 'col-key', text: entry.key === ' ' ? 'Space' : entry.key }),
      h('td', { class: 'col-code', text: entry.code }),
      h('td', { class: 'col-keycode', text: String(entry.keyCode) }),
      h('td', { class: 'col-category', text: entry.category }),
      h('td', { class: 'col-note', text: entry.note }),
      h('td', { class: 'col-copy' },
        copyButton(() => `event.code === '${entry.code}'`, { title: `复制判定：${entry.code}` })
      )
    ));
  }
  table.appendChild(body);
  wrap.appendChild(table);

  els.status.textContent = '推荐用 event.code 做快捷键：它对应物理按键位置，不受输入法与键盘布局影响';
}

/* ── 初始化 ───────────────────────────────────────────────── */

function init() {
  els.search = $('#search');
  els.status = $('#status');
  els.liveHint = $('#live-hint');

  renderLiveShell();
  renderChips();

  els.search.addEventListener('input', debounce(() => {
    state.query = els.search.value.trim();
    renderTable();
  }, 150));

  if (!logic.KEY_CATEGORIES.includes(state.category)) state.category = '';
  els.liveHint.textContent = `共收录 ${logic.KEY_ENTRIES.length} 个按键`;

  mountTool({
    actions: [
      { id: 'focus-live', label: '聚焦实时按键区', icon: 'sliders', primary: true, keywords: 'live 实时 按键', run: () => $('.live-zone').focus() },
      { id: 'clear-search', label: '清空搜索与筛选', icon: 'close', keywords: 'clear 清空 搜索', run: () => {
        els.search.value = '';
        state.query = '';
        state.category = '';
        write(`${STORAGE_ID}:category`, '');
        renderChips();
        renderTable();
      } },
      ...logic.KEY_CATEGORIES.map((name) => ({
        id: `cat-${name}`,
        label: `只看${name}`,
        icon: 'search',
        keywords: `category ${name}`,
        run: () => {
          state.category = name;
          write(`${STORAGE_ID}:category`, name);
          renderChips();
          renderTable();
        }
      }))
    ]
  });

  renderTable();
  els.search.focus();
}

init();
