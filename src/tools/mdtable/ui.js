/* Markdown 表格生成器界面层：可编辑网格 + 实时 Markdown 输出 + CSV/TSV/Markdown 导入。 */

import { h, mount, clear, $, debounce } from '../../core/dom.js';
import { mountTool } from '../../core/app.js';
import { icon } from '../../core/icons.js';
import { copyButton, downloadText } from '../../core/widgets.js';
import { read, write } from '../../core/storage.js';
import * as toast from '../../core/toast.js';
import * as logic from './logic.js';

const STORAGE_ID = 'mdtable';
const saved = read(`${STORAGE_ID}:state`, null);
const savedMode = read(`${STORAGE_ID}:mode`, 'output');

const state = {
  ...logic.normalizeTable(saved || logic.DEFAULT_TABLE),
  mode: savedMode === 'import' ? 'import' : 'output'
};

const els = {};

const persist = debounce(() => {
  write(`${STORAGE_ID}:state`, {
    hasHeader: state.hasHeader,
    headers: state.headers,
    rows: state.rows,
    alignments: state.alignments
  });
}, 200);

function scheduleSync() {
  persist();
  updateOutput();
}

/* ── 网格 ─────────────────────────────────────────────────── */

function deleteButton(label, onClick) {
  const button = h('button', {
    class: 'delete',
    type: 'button',
    title: label,
    'aria-label': label
  }, icon('close', 12));
  button.addEventListener('click', onClick);
  return button;
}

function deleteColumn(index) {
  if (state.headers.length <= 1) {
    toast.warn('至少保留一列');
    return;
  }
  state.headers.splice(index, 1);
  state.alignments.splice(index, 1);
  for (const row of state.rows) row.splice(index, 1);
  renderGrid();
  scheduleSync();
}

function deleteRow(index) {
  state.rows.splice(index, 1);
  renderGrid();
  scheduleSync();
}

function renderGrid() {
  const table = h('table', { class: 'grid' });
  const thead = h('thead');
  const headRow = h('tr');

  headRow.appendChild(h('th', { class: 'corner', text: '#' }));
  state.headers.forEach((value, column) => {
    const input = h('input', { type: 'text', value, 'aria-label': `表头 第 ${column + 1} 列` });
    input.addEventListener('input', () => {
      state.headers[column] = input.value;
      scheduleSync();
    });
    headRow.appendChild(h('th', {}, input));
  });
  headRow.appendChild(h('th', { class: 'corner' }));
  thead.appendChild(headRow);

  const alignRow = h('tr', { class: 'align-row' });
  alignRow.appendChild(h('th', { class: 'corner', text: '对齐' }));
  state.alignments.forEach((value, column) => {
    const select = h('select', { 'aria-label': `第 ${column + 1} 列对齐` },
      logic.ALIGNMENTS.map((option) => h('option', { value: option.id, selected: option.id === value }, option.label))
    );
    select.addEventListener('change', () => {
      state.alignments[column] = select.value;
      scheduleSync();
    });
    alignRow.appendChild(h('th', {}, select, deleteButton(`删除第 ${column + 1} 列`, () => deleteColumn(column))));
  });
  alignRow.appendChild(h('th', { class: 'corner' }));
  thead.appendChild(alignRow);
  table.appendChild(thead);

  const tbody = h('tbody');
  state.rows.forEach((row, rowIndex) => {
    const tr = h('tr');
    tr.appendChild(h('td', { class: 'corner', text: String(rowIndex + 1) }));
    row.forEach((value, column) => {
      const input = h('input', { type: 'text', value, 'aria-label': `第 ${rowIndex + 1} 行第 ${column + 1} 列` });
      input.addEventListener('input', () => {
        state.rows[rowIndex][column] = input.value;
        scheduleSync();
      });
      tr.appendChild(h('td', {}, input));
    });
    tr.appendChild(h('td', { class: 'corner' }, deleteButton(`删除第 ${rowIndex + 1} 行`, () => deleteRow(rowIndex))));
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  mount(els.grid, table);
}

/* ── 输出与导入 ───────────────────────────────────────────── */

function markdown() {
  return logic.buildMarkdown(state);
}

function renderActions() {
  clear(els.actions);
  if (state.mode !== 'output') return;

  els.actions.appendChild(copyButton(() => markdown(), { label: '复制 Markdown' }));

  const download = h('button', { class: 'btn btn-sm', type: 'button' }, icon('download', 12), h('span', { text: '下载 .md' }));
  download.addEventListener('click', () => {
    downloadText('table.md', markdown(), 'text/markdown;charset=utf-8');
    toast.ok('已导出 table.md');
  });
  els.actions.appendChild(download);

  const csv = h('button', { class: 'btn btn-sm', type: 'button' }, icon('download', 12), h('span', { text: '下载 .csv' }));
  csv.addEventListener('click', () => {
    downloadText('table.csv', logic.toDelimited(state, ','));
    toast.ok('已导出 table.csv');
  });
  els.actions.appendChild(csv);
}

function renderOutput() {
  for (const tab of els.modes.querySelectorAll('[role="tab"]')) {
    tab.setAttribute('aria-selected', String(tab.dataset.mode === state.mode));
  }

  clear(els.output);

  if (state.mode === 'import') {
    const textarea = h('textarea', {
      class: 'mono import-area',
      id: 'import-text',
      spellcheck: 'false',
      'aria-label': '导入内容',
      placeholder: '粘贴 CSV、TSV 或已有的 Markdown 表格，然后点「导入并替换」'
    });

    const button = h('button', { class: 'btn btn-primary', type: 'button', id: 'btn-import', text: '导入并替换' });
    button.addEventListener('click', () => {
      try {
        const parsed = logic.parseTableText(textarea.value);
        Object.assign(state, parsed);
        renderGrid();
        state.mode = 'output';
        write(`${STORAGE_ID}:mode`, state.mode);
        persist();
        renderOutput();
        renderActions();
        toast.ok(`已导入 ${parsed.rows.length} 行 × ${parsed.headers.length} 列`);
      } catch (error) {
        toast.fail(error.message);
      }
    });

    els.output.appendChild(textarea);
    els.output.appendChild(h('div', { class: 'row', style: { marginTop: '8px' } }, button));
    els.output.appendChild(h('div', { class: 'note' }, '首行会作为表头；Markdown 表格的对齐标记会自动识别。'));
    els.foot.textContent = '';
    return;
  }

  const pre = h('pre', { class: 'output-box', id: 'md-output' });
  pre.textContent = markdown();
  els.output.appendChild(pre);
  els.foot.textContent = '单元格里的 | 会转义为 \\|，换行会转成 <br>。';
}

function updateOutput() {
  els.status.textContent = `${state.rows.length} 行 × ${state.headers.length} 列`;
  if (state.mode === 'output') {
    renderOutput();
    renderActions();
  }
}

/* ── 结构操作 ─────────────────────────────────────────────── */

function addRow() {
  if (state.rows.length >= logic.MAX_ROWS) {
    toast.warn(`最多 ${logic.MAX_ROWS} 行`);
    return;
  }
  state.rows.push(Array.from({ length: state.headers.length }, () => ''));
  renderGrid();
  scheduleSync();
}

function addColumn() {
  if (state.headers.length >= logic.MAX_COLUMNS) {
    toast.warn(`最多 ${logic.MAX_COLUMNS} 列`);
    return;
  }
  state.headers.push(`列 ${state.headers.length + 1}`);
  state.alignments.push('none');
  for (const row of state.rows) row.push('');
  renderGrid();
  scheduleSync();
}

function resetTable() {
  const fresh = logic.normalizeTable(logic.DEFAULT_TABLE);
  state.hasHeader = fresh.hasHeader;
  state.headers = fresh.headers;
  state.rows = fresh.rows;
  state.alignments = fresh.alignments;
  els['has-header'].checked = state.hasHeader;
  renderGrid();
  scheduleSync();
  toast.ok('已恢复默认表格');
}

/* ── 初始化 ───────────────────────────────────────────────── */

function init() {
  els.grid = $('#grid');
  els.output = $('#output');
  els.actions = $('#actions');
  els.status = $('#status');
  els.foot = $('#foot');
  els.modes = $('#modes');

  els['has-header'] = $('#has-header');
  els['has-header'].checked = state.hasHeader;
  els['has-header'].addEventListener('change', () => {
    state.hasHeader = els['has-header'].checked;
    scheduleSync();
  });

  $('#btn-add-row').addEventListener('click', addRow);
  $('#btn-add-col').addEventListener('click', addColumn);
  $('#btn-reset').addEventListener('click', resetTable);

  for (const tab of els.modes.querySelectorAll('[role="tab"]')) {
    tab.addEventListener('click', () => {
      state.mode = tab.dataset.mode;
      write(`${STORAGE_ID}:mode`, state.mode);
      renderOutput();
      renderActions();
    });
  }

  mountTool({
    actions: [
      { id: 'copy', label: '复制 Markdown', icon: 'copy', primary: true, keywords: 'copy markdown 复制', run: () => copyButton(() => markdown()).click() },
      { id: 'add-row', label: '添加一行', icon: 'expand', keywords: 'row 行 添加', run: addRow },
      { id: 'add-col', label: '添加一列', icon: 'expand', keywords: 'column 列 添加', run: addColumn },
      { id: 'import', label: '导入表格', icon: 'download', keywords: 'import csv tsv markdown 导入', run: () => { state.mode = 'import'; renderOutput(); renderActions(); } }
    ]
  });

  renderGrid();
  renderOutput();
  renderActions();
  updateOutput();
}

init();
