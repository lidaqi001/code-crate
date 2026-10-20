/* 文本 Diff 界面层：统一视图 + 行内词级高亮 + JSON 结构差异 */

import { h, mount, clear, $, debounce } from '../../core/dom.js';
import { mountTool } from '../../core/app.js';
import { icon } from '../../core/icons.js';
import { copyButton } from '../../core/widgets.js';
import { read, write } from '../../core/storage.js';
import * as toast from '../../core/toast.js';
import * as logic from './logic.js';

const STORAGE_ID = 'diff';

const SAMPLES = {
  lines: {
    left: ['function greet(name) {', '  const msg = "hello " + name;', '  console.log(msg);', '  return msg;', '}', '', 'greet("world");'].join('\n'),
    right: ['function greet(name, greeting = "hello") {', '  const msg = `${greeting} ${name}`;', '  console.log(msg);', '  return msg;', '}', '', 'greet("world", "hi");', 'greet("codecrate");'].join('\n')
  },
  words: {
    left: '订单 A-1001 金额 128.00 元，状态 待支付',
    right: '订单 A-1001 金额 256.50 元，状态 已支付'
  },
  json: {
    left: JSON.stringify({ name: 'codecrate', version: '2.0.0', tags: ['json', 'tool'], limits: { timeout: 3000 }, private: false }, null, 2),
    right: JSON.stringify({ name: 'codecrate', version: '2.1.0', tags: ['json', 'tool', 'diff'], limits: { timeout: 5000 }, maintainers: [{ id: 1 }] }, null, 2)
  }
};

const els = {};
const state = {
  mode: read(`${STORAGE_ID}:mode`, 'lines'),
  ignoreCase: read(`${STORAGE_ID}:ignoreCase`, false),
  ignoreWhitespace: read(`${STORAGE_ID}:ignoreWhitespace`, false),
  showPatch: read(`${STORAGE_ID}:showPatch`, false)
};

function persist() {
  write(`${STORAGE_ID}:mode`, state.mode);
  write(`${STORAGE_ID}:ignoreCase`, state.ignoreCase);
  write(`${STORAGE_ID}:ignoreWhitespace`, state.ignoreWhitespace);
  write(`${STORAGE_ID}:showPatch`, state.showPatch);
}

/* ── 行内词级高亮 ─────────────────────────────────────────── */

function pairSegments(leftText, rightText, side) {
  const wanted = side === 'delete' ? 'delete' : 'insert';
  return logic.inlineSegments(leftText, rightText, {
    ignoreCase: state.ignoreCase,
    ignoreWhitespace: state.ignoreWhitespace
  }).filter((segment) => segment.type === 'equal' || segment.type === wanted);
}

function renderText(container) {
  const left = els.left.value;
  const right = els.right.value;

  if (!left && !right) {
    container.appendChild(h('div', { class: 'empty' }, '在上方输入两段文本后自动比较'));
    return;
  }

  const result = logic.diffLines(left, right, {
    ignoreCase: state.ignoreCase,
    ignoreWhitespace: state.ignoreWhitespace
  });

  if (state.showPatch) {
    container.appendChild(h('pre', { class: 'patch-view', text: logic.unifiedDiff(result) }));
    renderStats(result);
    return;
  }

  const view = h('div', { class: 'diff-view' });
  const ops = result.ops;
  let index = 0;

  while (index < ops.length) {
    const op = ops[index];

    if (op.type === 'equal') {
      view.appendChild(diffLine('equal', op.text, op.leftIndex + 1, op.rightIndex + 1));
      index += 1;
      continue;
    }

    // 收集一段连续的改动，便于把「删除行 / 新增行」配对做行内高亮
    const block = [];
    while (index < ops.length && ops[index].type !== 'equal') {
      block.push(ops[index]);
      index += 1;
    }

    const deletions = block.filter((entry) => entry.type === 'delete');
    const insertions = block.filter((entry) => entry.type === 'insert');
    const pairs = Math.min(deletions.length, insertions.length);

    deletions.forEach((entry, order) => {
      const segments = order < pairs ? pairSegments(entry.text, insertions[order].text, 'delete') : null;
      view.appendChild(diffLine('delete', entry.text, entry.leftIndex + 1, null, segments));
    });
    insertions.forEach((entry, order) => {
      const segments = order < pairs ? pairSegments(deletions[order].text, entry.text, 'insert') : null;
      view.appendChild(diffLine('insert', entry.text, null, entry.rightIndex + 1, segments));
    });
  }

  container.appendChild(view);
  renderStats(result, container);
}

function diffLine(kind, text, leftNo, rightNo, segments) {
  const sign = kind === 'insert' ? '+' : kind === 'delete' ? '-' : ' ';
  const textNode = h('span', { class: 'text' });

  if (segments && segments.length) {
    for (const segment of segments) {
      const cls = segment.type === 'insert' ? 'word-add' : segment.type === 'delete' ? 'word-del' : '';
      if (cls) textNode.appendChild(h('span', { class: cls }, segment.text));
      else textNode.appendChild(document.createTextNode(segment.text));
    }
  } else {
    textNode.textContent = text === '' ? ' ' : text;
  }

  return h('div', { class: `diff-line ${kind === 'insert' ? 'add' : kind === 'delete' ? 'del' : ''}` },
    h('span', { class: 'ln', text: leftNo === null || leftNo === undefined ? '' : String(leftNo) }),
    h('span', { class: 'ln', text: rightNo === null || rightNo === undefined ? '' : String(rightNo) }),
    h('span', { class: 'sign', text: sign }),
    textNode
  );
}

function renderStats(result, container) {
  const { added, removed, unchanged, similarity } = result.stats;
  const bar = h('i', { style: { width: `${Math.round(similarity * 100)}%` } });
  const stats = h('div', { class: 'diff-stats' },
    h('span', { class: 'stat-chip add' }, h('b', { text: `+${added}` }), '新增'),
    h('span', { class: 'stat-chip del' }, h('b', { text: `-${removed}` }), '删除'),
    h('span', { class: 'stat-chip' }, h('b', { text: String(unchanged) }), '未变'),
    h('span', { class: 'stat-chip sim' }, h('b', { text: `${Math.round(similarity * 100)}%` }), '相似度'),
    h('span', { class: 'similarity-bar' }, bar)
  );

  const status = $('#output-status');
  clear(status);
  mount(status, stats);

  if (result.truncated) {
    status.appendChild(h('span', { class: 'text-warn', text: '内容过大，已退化为整段替换' }));
  }
  if (container && !container.querySelector('.diff-view') && !container.querySelector('.patch-view')) {
    return;
  }
}

/* ── 词级比较 ─────────────────────────────────────────────── */

function renderWords(container) {
  const left = els.left.value;
  const right = els.right.value;
  if (!left && !right) {
    container.appendChild(h('div', { class: 'empty' }, '在上方输入两段文本后自动比较'));
    return;
  }

  container.appendChild(h('div', { class: 'label', style: { padding: '8px 10px 2px' } }, '原内容'));
  container.appendChild(h('div', { class: 'diff-view' }, h('div', { class: 'diff-line del' },
    h('span', { class: 'ln' }), h('span', { class: 'ln' }), h('span', { class: 'sign', text: '-' }),
    segmentsNode(logic.inlineSegments(left, right, { ignoreCase: state.ignoreCase }), 'delete')
  )));

  container.appendChild(h('div', { class: 'label', style: { padding: '8px 10px 2px' } }, '新内容'));
  container.appendChild(h('div', { class: 'diff-view' }, h('div', { class: 'diff-line add' },
    h('span', { class: 'ln' }), h('span', { class: 'ln' }), h('span', { class: 'sign', text: '+' }),
    segmentsNode(logic.inlineSegments(left, right, { ignoreCase: state.ignoreCase }), 'insert')
  )));

  const stats = logic.diffWords(left, right, { ignoreCase: state.ignoreCase, ignoreWhitespace: state.ignoreWhitespace });
  clear($('#output-status'));
  mount($('#output-status'), h('div', { class: 'diff-stats' },
    h('span', { class: 'stat-chip add' }, h('b', { text: `+${stats.stats.added}` }), '词'),
    h('span', { class: 'stat-chip del' }, h('b', { text: `-${stats.stats.removed}` }), '词'),
    h('span', { class: 'stat-chip sim' }, h('b', { text: `${Math.round(stats.stats.similarity * 100)}%` }), '相似度')
  ));
}

function segmentsNode(segments, side) {
  const wanted = side === 'delete' ? 'delete' : 'insert';
  const node = h('span', { class: 'text' });
  for (const segment of segments) {
    if (segment.type === 'equal') node.appendChild(document.createTextNode(segment.text));
    else if (segment.type === wanted) node.appendChild(h('span', { class: segment.type === 'insert' ? 'word-add' : 'word-del' }, segment.text));
  }
  return node;
}

/* ── JSON 结构比较 ────────────────────────────────────────── */

function renderJson(container) {
  const left = els.left.value;
  const right = els.right.value;
  if (!left && !right) {
    container.appendChild(h('div', { class: 'empty' }, '在上方输入两个 JSON 后自动比较'));
    return;
  }

  const result = logic.diffJson(left, right);
  clear($('#output-status'));

  if (!result.ok) {
    container.appendChild(h('div', { class: 'issue error' }, h('div', { class: 'issue-msg', text: result.error })));
    return;
  }

  if (!result.changes.length) {
    container.appendChild(h('div', { class: 'empty' }, '两个 JSON 结构完全一致'));
    $('#output-status').textContent = '没有差异';
    return;
  }

  const label = { added: '新增', removed: '删除', changed: '变更' };
  for (const change of result.changes) {
    const values = h('span', { class: 'jd-values' });
    if (change.type === 'removed') values.appendChild(h('span', { class: 'jd-old', text: summarize(change.left) }));
    else if (change.type === 'added') values.appendChild(h('span', { class: 'jd-new', text: summarize(change.right) }));
    else {
      values.appendChild(h('span', { class: 'jd-old', text: summarize(change.left) }));
      values.appendChild(h('span', { class: 'jd-arrow', text: '→' }));
      values.appendChild(h('span', { class: 'jd-new', text: summarize(change.right) }));
    }

    container.appendChild(h('div', { class: 'json-diff-row' },
      h('span', { class: `jd-type ${change.type}`, text: label[change.type] }),
      h('span', { class: 'jd-path', text: change.path }),
      values,
      copyButton(() => change.path, { title: '复制路径' })
    ));
  }

  const counts = result.changes.reduce((acc, change) => {
    acc[change.type] = (acc[change.type] || 0) + 1;
    return acc;
  }, {});
  mount($('#output-status'), h('div', { class: 'diff-stats' },
    h('span', { class: 'stat-chip add' }, h('b', { text: `+${counts.added || 0}` }), '新增'),
    h('span', { class: 'stat-chip del' }, h('b', { text: `-${counts.removed || 0}` }), '删除'),
    h('span', { class: 'stat-chip' }, h('b', { text: String(counts.changed || 0) }), '变更')
  ));
}

function summarize(value) {
  if (typeof value === 'string') return JSON.stringify(value);
  const text = JSON.stringify(value);
  if (text === undefined) return 'undefined';
  return text.length > 160 ? `${text.slice(0, 160)}…` : text;
}

/* ── 顶部选项与动作 ───────────────────────────────────────── */

function renderOptions() {
  const bar = $('#opt-bar');
  const make = (labelText, key) => {
    const box = h('input', { type: 'checkbox', id: `opt-${key}`, checked: state[key] });
    box.addEventListener('change', () => {
      state[key] = box.checked;
      persist();
      update();
    });
    return h('label', { class: 'check', for: `opt-${key}` }, box, h('span', { text: labelText }));
  };

  const patchBox = h('input', { type: 'checkbox', id: 'opt-patch', checked: state.showPatch });
  patchBox.addEventListener('change', () => {
    state.showPatch = patchBox.checked;
    persist();
    update();
  });

  mount(bar,
    make('忽略大小写', 'ignoreCase'),
    make('忽略空白差异', 'ignoreWhitespace'),
    state.mode === 'lines' || state.mode === 'words'
      ? h('label', { class: 'check', for: 'opt-patch' }, patchBox, h('span', { text: '显示为统一补丁' }))
      : null
  );
}

function renderActions() {
  const box = $('#actions');
  clear(box);

  const add = (label, getValue, iconName) => {
    const button = h('button', { class: 'btn btn-sm', type: 'button' }, icon(iconName, 12), h('span', { text: label }));
    button.addEventListener('click', async () => {
      const { copy } = await import('../../core/clipboard.js');
      const value = getValue();
      if (!value) {
        toast.warn('没有可复制的内容');
        return;
      }
      if (await copy(value)) toast.ok('已复制');
      else toast.fail('复制失败');
    });
    box.appendChild(button);
  };

  if (state.mode === 'json') {
    add('复制变更清单', () => {
      const result = logic.diffJson(els.left.value, els.right.value);
      if (!result.ok) return '';
      return result.changes.map((c) => `${c.type}\t${c.path}`).join('\n');
    }, 'copy');
    return;
  }

  const result = logic.diffLines(els.left.value, els.right.value, {
    ignoreCase: state.ignoreCase,
    ignoreWhitespace: state.ignoreWhitespace
  });
  add('复制统一补丁', () => logic.unifiedDiff(result), 'download');
  add('仅复制新增行', () => result.ops.filter((op) => op.type === 'insert').map((op) => op.text).join('\n'), 'copy');
  add('仅复制删除行', () => result.ops.filter((op) => op.type === 'delete').map((op) => op.text).join('\n'), 'copy');
}

/* ── 主流程 ───────────────────────────────────────────────── */

const RENDERERS = { lines: renderText, words: renderWords, json: renderJson };

const MODE_HINTS = {
  lines: '基于最长公共子序列，插入一行只会产生一处差异',
  words: '按词切分，适合看清单行内的具体改动',
  json: '递归比较键值，路径使用 JSONPath 风格表示'
};

function update() {
  for (const tab of els.modes.querySelectorAll('[role="tab"]')) {
    tab.setAttribute('aria-selected', String(tab.dataset.mode === state.mode));
  }

  els.leftMeta.textContent = `${logic.splitLines(els.left.value).length} 行`;
  els.rightMeta.textContent = `${logic.splitLines(els.right.value).length} 行`;

  for (const key of ['left', 'right']) {
    write(`${STORAGE_ID}:${key}`, els[key].value);
  }

  const box = $('#output');
  clear(box);
  clear($('#output-status'));

  (RENDERERS[state.mode] || renderText)(box);

  renderOptions();
  renderActions();
  els.inputStatus.textContent = MODE_HINTS[state.mode] || '';
}

function setInputs(left, right) {
  els.left.value = left;
  els.right.value = right;
  update();
}

function init() {
  els.modes = $('#modes');
  els.left = $('#left');
  els.right = $('#right');
  els.leftMeta = $('#left-meta');
  els.rightMeta = $('#right-meta');
  els.inputStatus = $('#input-status');

  els.left.value = read(`${STORAGE_ID}:left`, '') || SAMPLES.lines.left;
  els.right.value = read(`${STORAGE_ID}:right`, '') || SAMPLES.lines.right;

  els.left.addEventListener('input', debounce(update, 200));
  els.right.addEventListener('input', debounce(update, 200));

  for (const tab of els.modes.querySelectorAll('[role="tab"]')) {
    tab.addEventListener('click', () => {
      state.mode = tab.dataset.mode;
      persist();
      update();
    });
  }

  $('#btn-swap').addEventListener('click', () => setInputs(els.right.value, els.left.value));
  $('#btn-sample').addEventListener('click', () => {
    const sample = SAMPLES[state.mode] || SAMPLES.lines;
    setInputs(sample.left, sample.right);
  });
  $('#btn-clear').addEventListener('click', () => {
    setInputs('', '');
    toast.ok('已清空');
  });

  mountTool({
    actions: [
      { id: 'mode-lines', label: '文本行比较', icon: 'diff', primary: true, keywords: 'line 行', run: () => switchMode('lines') },
      { id: 'mode-words', label: '文本词比较', icon: 'text', keywords: 'word 词', run: () => switchMode('words') },
      { id: 'mode-json', label: 'JSON 结构比较', icon: 'json', keywords: 'json 结构', run: () => switchMode('json') },
      { id: 'swap', label: '交换左右内容', icon: 'refresh', keywords: 'swap 交换', run: () => $('#btn-swap').click() },
      { id: 'sample', label: '载入示例', icon: 'markdown', keywords: 'sample 示例', run: () => $('#btn-sample').click() },
      {
        id: 'copy-patch',
        label: '复制统一补丁',
        icon: 'copy',
        keywords: 'patch 补丁 copy',
        run: async () => {
          const { copy } = await import('../../core/clipboard.js');
          const result = logic.diffLines(els.left.value, els.right.value, {
            ignoreCase: state.ignoreCase,
            ignoreWhitespace: state.ignoreWhitespace
          });
          if (await copy(logic.unifiedDiff(result))) toast.ok('已复制统一补丁');
          else toast.fail('复制失败');
        }
      }
    ]
  });

  update();
}

function switchMode(mode) {
  state.mode = mode;
  persist();
  update();
}

init();
