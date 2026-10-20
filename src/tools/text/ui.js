/* 文本处理界面层：所有操作都是「读取当前文本 -> 生成新文本」，并支持撤销 */

import { h, mount, clear, $, debounce } from '../../core/dom.js';
import { mountTool } from '../../core/app.js';
import { icon } from '../../core/icons.js';
import { read, write } from '../../core/storage.js';
import * as toast from '../../core/toast.js';
import * as logic from './logic.js';

const STORAGE_ID = 'text';
const HISTORY_LIMIT = 40;

const SAMPLE = [
  '  CodeCrate  Release Notes ',
  '',
  'item10: 支持 JSON 工具',
  'item2: 支持正则测试',
  'item1: 支持时间戳换算',
  'ITEM1: 支持时间戳换算',
  '',
  '   <p>联系方式：<b>dev@example.com</b></p>   '
].join('\n');

const els = {};
const state = {
  mode: read(`${STORAGE_ID}:mode`, 'case')
};

const history = [];

function persist() {
  write(`${STORAGE_ID}:text`, els.text.value);
  write(`${STORAGE_ID}:mode`, state.mode);
}

/* ── 应用一次变换 ─────────────────────────────────────────── */

function apply(transform, message) {
  const before = els.text.value;
  let next;
  try {
    next = transform(before);
  } catch (error) {
    toast.fail(error.message);
    return;
  }

  if (next === before) {
    toast.warn(message ? `${message}：内容没有变化` : '内容没有变化');
    return;
  }

  history.push(before);
  if (history.length > HISTORY_LIMIT) history.shift();

  els.text.value = next;
  afterChange();
  if (message) toast.ok(message);
}

function afterChange() {
  persist();
  updateMeta();
  if (state.mode === 'stats') renderOps();
}

function undo() {
  if (!history.length) {
    toast.warn('没有可撤销的操作');
    return;
  }
  els.text.value = history.pop();
  afterChange();
  toast.ok('已撤销');
}

/* ── 小部件 ───────────────────────────────────────────────── */

function opButton(label, transform, { message, title } = {}) {
  const button = h('button', {
    class: 'op-btn',
    type: 'button',
    title: title || label
  }, label);
  button.addEventListener('click', () => apply(transform, message || label));
  return button;
}

function field(labelText, control, extraClass = '') {
  return h('div', { class: `field ${extraClass}`.trim() },
    h('label', { text: labelText }),
    control
  );
}

function textInput(value, { placeholder, width } = {}) {
  return h('input', {
    type: 'text',
    class: 'mono',
    value,
    placeholder,
    spellcheck: 'false',
    style: width ? { width } : undefined
  });
}

function select(options, value) {
  const node = h('select', {},
    options.map((option) => h('option', { value: option.id, selected: option.id === value }, option.label))
  );
  node.value = value;
  return node;
}

function checkbox(labelText, checked) {
  const box = h('input', { type: 'checkbox', checked });
  return { node: h('label', { class: 'check' }, box, h('span', { text: labelText })), box };
}

function section(titleText, children) {
  return h('div', { class: 'op-section' },
    titleText ? h('div', { class: 'op-title', text: titleText }) : null,
    Array.isArray(children) ? children : [children]
  );
}

/* ── 各分类的操作 ─────────────────────────────────────────── */

function renderCase(container) {
  container.appendChild(section('转换',
    h('div', { class: 'op-grid' },
      logic.CASE_OPS.map((op) => opButton(op.label, op.run, { message: `已应用：${op.label}` }))
    )
  ));
}

function renderLines(container) {
  // 排序
  const order = select([{ id: 'asc', label: '升序' }, { id: 'desc', label: '降序' }], 'asc');
  const by = select(logic.SORT_MODES, 'text');
  const sortBtn = h('button', { class: 'btn btn-sm btn-primary', type: 'button' }, '排序');
  sortBtn.addEventListener('click', () => apply(
    (text) => logic.sortLines(text, { order: order.value, by: by.value }),
    '已排序'
  ));
  container.appendChild(section('排序',
    h('div', { class: 'op-form' },
      field('顺序', order),
      field('依据', by),
      sortBtn
    )
  ));

  // 去重
  const ignoreCase = checkbox('忽略大小写', false);
  const trimCompare = checkbox('按去空白比较', false);
  const dedupeBtn = h('button', { class: 'btn btn-sm btn-primary', type: 'button' }, '去重');
  dedupeBtn.addEventListener('click', () => apply(
    (text) => logic.dedupeLines(text, { caseSensitive: !ignoreCase.box.checked, trim: trimCompare.box.checked }),
    '已去重'
  ));
  container.appendChild(section('去重',
    h('div', { class: 'op-form' },
      ignoreCase.node,
      trimCompare.node,
      dedupeBtn
    )
  ));

  // 行序与基础编辑
  container.appendChild(section('行编辑',
    h('div', { class: 'op-grid' },
      opButton('反转行序', logic.reverseLines, { message: '已反转行序' }),
      opButton('随机打乱', (text) => logic.shuffleLines(text), { message: '已随机打乱' }),
      opButton('去空行', (text) => logic.removeEmptyLines(text), { message: '已去除空行' }),
      opButton('去每行首尾空白', logic.trimLines, { message: '已去除行首尾空白' })
    )
  ));

  // 行号
  const startInput = h('input', { type: 'number', value: '1', min: '0' });
  const separatorInput = textInput('. ', { placeholder: '. ' });
  const padBox = checkbox('补零对齐', false);
  const numberBtn = h('button', { class: 'btn btn-sm btn-primary', type: 'button' }, '添加行号');
  numberBtn.addEventListener('click', () => apply(
    (text) => logic.numberLines(text, {
      start: Number(startInput.value) || 0,
      separator: separatorInput.value,
      pad: padBox.box.checked
    }),
    '已添加行号'
  ));
  container.appendChild(section('行号',
    h('div', { class: 'op-form' },
      field('起始', startInput),
      field('分隔符', separatorInput, 'grow-field'),
      padBox.node,
      numberBtn
    )
  ));

  // 前后缀
  const prefixInput = textInput('', { placeholder: '例如 - ' });
  const suffixInput = textInput('', { placeholder: '例如 ;' });
  const affixBtn = h('button', { class: 'btn btn-sm btn-primary', type: 'button' }, '添加前后缀');
  affixBtn.addEventListener('click', () => apply(
    (text) => logic.addAffix(text, { prefix: prefixInput.value, suffix: suffixInput.value }),
    '已添加前后缀'
  ));
  container.appendChild(section('前后缀',
    h('div', { class: 'op-form' },
      field('前缀', prefixInput, 'grow-field'),
      field('后缀', suffixInput, 'grow-field'),
      affixBtn
    )
  ));

  // 按正则筛选
  const patternInput = textInput('', { placeholder: '例如 ^\\d' });
  const invertBox = checkbox('反向（剔除匹配行）', false);
  const filterBtn = h('button', { class: 'btn btn-sm btn-primary', type: 'button' }, '筛选');
  filterBtn.addEventListener('click', () => {
    if (!patternInput.value) {
      toast.warn('请先填写正则');
      return;
    }
    apply(
      (text) => logic.filterLines(text, patternInput.value, { invert: invertBox.box.checked }),
      '已筛选行'
    );
  });
  container.appendChild(section('按正则筛选行',
    h('div', { class: 'op-form' },
      field('正则', patternInput, 'grow-field'),
      invertBox.node,
      filterBtn
    )
  ));

  // 合并 / 拆分 / 换行
  const joinSep = textInput(', ', { placeholder: ', ' });
  const joinBtn = h('button', { class: 'btn btn-sm', type: 'button' }, '合并为一行');
  joinBtn.addEventListener('click', () => apply(
    (text) => logic.joinLines(text, joinSep.value),
    '已合并为一行'
  ));

  const splitSep = textInput(',', { placeholder: ',' });
  const splitBtn = h('button', { class: 'btn btn-sm', type: 'button' }, '按分隔符拆行');
  splitBtn.addEventListener('click', () => apply(
    (text) => logic.splitToLines(text, splitSep.value),
    '已拆分为行'
  ));

  const widthInput = h('input', { type: 'number', value: '80', min: '1', max: '500' });
  const wrapBtn = h('button', { class: 'btn btn-sm', type: 'button' }, '按宽度换行');
  wrapBtn.addEventListener('click', () => apply(
    (text) => logic.wrapText(text, Number(widthInput.value) || 80),
    '已按宽度换行'
  ));

  container.appendChild(section('连接与换行',
    h('div', { class: 'op-form' },
      field('合并分隔符', joinSep),
      joinBtn,
      field('拆分分隔符', splitSep),
      splitBtn
    ),
    h('div', { class: 'op-form' },
      field('每行宽度', widthInput),
      wrapBtn
    )
  ));
}

function renderClean(container) {
  container.appendChild(section('空白',
    h('div', { class: 'op-grid' },
      opButton('合并多余空格', logic.collapseSpaces, { message: '已合并多余空格' }),
      opButton('删除全部空白', logic.removeAllSpaces, { message: '已删除全部空白' }),
      opButton('删除换行', (text) => logic.removeLineBreaks(text), { message: '已删除换行' }),
      opButton('合并多余空行', logic.collapseBlankLines, { message: '已合并多余空行' }),
      opButton('去每行首尾空白', logic.trimLines, { message: '已去除行首尾空白' })
    )
  ));

  container.appendChild(section('内容',
    h('div', { class: 'op-grid' },
      opButton('移除 HTML 标签', logic.stripHtmlTags, { message: '已移除 HTML 标签' }),
      opButton('移除标点符号', logic.removePunctuation, { message: '已移除标点' })
    )
  ));
}

function renderEscape(container) {
  container.appendChild(section('转义',
    h('div', { class: 'op-grid' },
      logic.ESCAPE_OPS.map((op) => opButton(op.label, op.run, { message: `已应用：${op.label}`, title: op.hint }))
    )
  ));
  container.appendChild(h('div', { class: 'hint' },
    '转义会把整个文本当作一个值处理，适合放进代码或命令行'
  ));
}

function renderStats(container) {
  const stats = logic.textStats(els.text.value);
  const items = [
    ['字符数', stats.chars],
    ['字符数（不含空白）', stats.charsNoSpaces],
    ['英文单词', stats.words],
    ['中文字符', stats.cjk],
    ['行数', stats.lines],
    ['段落数', stats.paragraphs],
    ['空行数', stats.emptyLines],
    ['最长行', stats.longestLine],
    ['UTF-8 字节', stats.bytes]
  ];

  container.appendChild(section('统计',
    h('div', { class: 'stat-grid' },
      items.map(([label, value]) => h('div', { class: 'stat-box' },
        h('div', { class: 'k', text: label }),
        h('div', { class: 'v', text: String(value) })
      ))
    )
  ));
}

/* ── 渲染与状态 ───────────────────────────────────────────── */

const RENDERERS = {
  case: renderCase,
  lines: renderLines,
  clean: renderClean,
  escape: renderEscape,
  stats: renderStats
};

function renderOps() {
  for (const tab of els.modes.querySelectorAll('[role="tab"]')) {
    tab.setAttribute('aria-selected', String(tab.dataset.mode === state.mode));
  }
  const box = $('#ops');
  clear(box);
  (RENDERERS[state.mode] || renderCase)(box);
  els.status.textContent = STATUS_HINTS[state.mode] || '';
  els.undoBtn.disabled = history.length === 0;
}

const STATUS_HINTS = {
  case: '转换作用于整个文本，不只是单个单词',
  lines: '所有操作都按行处理，空行会被保留除非显式去除',
  clean: '清理类操作不可逆，可用左上角「撤销」回退',
  escape: '把文本当作单个值进行转义，便于粘贴进代码',
  stats: '字符数按 Unicode 码点计算，emoji 与中文均计为 1'
};

function updateMeta() {
  const value = els.text.value;
  const lines = value === '' ? 0 : value.split('\n').length;
  els.meta.textContent = `${lines} 行 · ${[...value].length} 字符`;
}

/* ── 初始化 ───────────────────────────────────────────────── */

function init() {
  els.modes = $('#modes');
  els.text = $('#text');
  els.meta = $('#meta');
  els.status = $('#status');
  els.undoBtn = $('#btn-undo');

  els.text.value = read(`${STORAGE_ID}:text`, '') || SAMPLE;
  if (!RENDERERS[state.mode]) state.mode = 'case';

  els.text.addEventListener('input', debounce(() => {
    persist();
    updateMeta();
    if (state.mode === 'stats') renderOps();
  }, 180));

  els.text.addEventListener('keydown', (event) => {
    const mod = event.ctrlKey || event.metaKey;
    if (mod && !event.shiftKey && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      undo();
    }
  });

  els.undoBtn.addEventListener('click', undo);
  $('#btn-sample').addEventListener('click', () => {
    history.push(els.text.value);
    els.text.value = SAMPLE;
    afterChange();
    toast.ok('已载入示例文本');
  });
  $('#btn-clear').addEventListener('click', () => {
    if (!els.text.value) return;
    history.push(els.text.value);
    els.text.value = '';
    afterChange();
    toast.ok('已清空');
  });

  for (const tab of els.modes.querySelectorAll('[role="tab"]')) {
    tab.addEventListener('click', () => {
      state.mode = tab.dataset.mode;
      persist();
      renderOps();
    });
  }

  mountTool({
    actions: [
      { id: 'undo', label: '撤销上一次处理', icon: 'refresh', keys: 'Ctrl+Z', primary: true, keywords: 'undo 撤销', run: undo },
      { id: 'mode-case', label: '大小写转换', icon: 'text', keywords: 'case 大小写', run: () => switchMode('case') },
      { id: 'mode-lines', label: '行处理：排序 / 去重', icon: 'sliders', keywords: 'line sort dedupe 排序 去重', run: () => switchMode('lines') },
      { id: 'mode-clean', label: '清理空白与标签', icon: 'codec', keywords: 'clean 清理 空白', run: () => switchMode('clean') },
      { id: 'mode-escape', label: '转义为代码可用文本', icon: 'markdown', keywords: 'escape 转义', run: () => switchMode('escape') },
      { id: 'mode-stats', label: '查看文本统计', icon: 'search', keywords: 'stats 统计 字数', run: () => switchMode('stats') }
    ]
  });

  updateMeta();
  renderOps();
}

function switchMode(mode) {
  state.mode = mode;
  persist();
  renderOps();
}

init();
