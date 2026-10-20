/* JSON 工具界面层：编辑器、树形浏览、JSONPath、TS / Schema 生成、转义 */

import { h, mount, clear, $, debounce, formatBytes } from '../../core/dom.js';
import { mountTool } from '../../core/app.js';
import { icon } from '../../core/icons.js';
import { copy } from '../../core/clipboard.js';
import { recall, remember } from '../../core/storage.js';
import { createFold } from '../../core/widgets.js';
import * as toast from '../../core/toast.js';
import * as logic from './logic.js';

const STORAGE_ID = 'json';

const SAMPLE = JSON.stringify(
  {
    name: '码匣 CodeCrate',
    version: '2.0.0',
    private: false,
    keywords: ['json', 'toolkit', 'extension'],
    repository: { type: 'git', url: 'https://example.com/codecrate.git' },
    maintainers: [
      { id: 1, login: 'ada', roles: ['owner'], active: true },
      { id: 2, login: 'linus', roles: ['reviewer'], active: false, email: 'linus@example.com' }
    ],
    limits: { memory: null, timeoutMs: 3000 }
  },
  null,
  2
);

const els = {};
const state = {
  mode: 'tree',
  indent: 2,
  value: null,
  error: null,
  path: '$..login',
  escapeSource: '',
  escapeResult: ''
};

/* ── 工具函数 ─────────────────────────────────────────────── */

function currentText() {
  return els.input.value;
}

function truncate(text, max = 400) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function formatPrimitive(value, kind) {
  if (kind === 'string') return truncate(JSON.stringify(value));
  if (kind === 'null') return 'null';
  return String(value);
}

function renderIssue(error) {
  const box = h('div', { class: 'issue error' },
    h('div', { class: 'issue-msg', text: `JSON 解析失败：${error.message}` }),
    error.line
      ? h('div', { class: 'issue-pos', text: `第 ${error.line} 行，第 ${error.column} 列` })
      : h('div', { class: 'issue-pos', text: '无法确定具体位置' })
  );

  if (error.position !== null && error.position !== undefined) {
    const locate = h('button', { class: 'btn btn-sm issue-fix', type: 'button' }, '定位到出错位置');
    locate.addEventListener('click', () => {
      const area = els.input;
      const position = Math.min(error.position, area.value.length);
      area.focus();
      area.setSelectionRange(position, Math.min(position + 1, area.value.length));
      const lineHeight = 18.6;
      area.scrollTop = Math.max(0, (error.line - 3) * lineHeight);
    });
    box.appendChild(locate);
  }
  return box;
}

/* ── 树形视图 ─────────────────────────────────────────────── */

function treeNode(key, value, path, isRoot) {
  const kind = logic.valueKind(value);
  const isContainer = kind === 'object' || kind === 'array';
  const node = h('div', { class: 'jt-node' });
  const row = h('div', { class: 'jt-row' });

  if (isContainer) {
    const toggle = h('button', {
      class: 'jt-toggle',
      type: 'button',
      'aria-label': '展开或折叠',
      title: '展开 / 折叠'
    }, '▾');
    toggle.addEventListener('click', () => node.classList.toggle('collapsed'));
    row.appendChild(toggle);
  } else {
    row.appendChild(h('span', { class: 'jt-spacer' }));
  }

  if (!isRoot) {
    row.appendChild(h('span', { class: 'jt-key', text: key }));
    row.appendChild(h('span', { class: 'jt-colon' }, ':'));
  }

  if (isContainer) {
    const size = kind === 'array' ? value.length : Object.keys(value).length;
    row.appendChild(h('span', { class: `jt-${kind}`, text: kind === 'array' ? '[' : '{' }));
    row.appendChild(h('span', { class: 'jt-meta', text: kind === 'array' ? `${size} 项` : `${size} 个键` }));
  } else {
    row.appendChild(h('span', { class: `jt-${kind}`, text: formatPrimitive(value, kind) }));
  }

  const copyNode = h('button', {
    class: 'jt-copy',
    type: 'button',
    title: `复制该节点（${path}）`,
    'aria-label': `复制节点 ${path}`
  }, icon('copy', 11));
  copyNode.addEventListener('click', async (event) => {
    event.stopPropagation();
    const ok = await copy(JSON.stringify(value, null, 2));
    if (ok) toast.ok('已复制该节点');
    else toast.fail('复制失败');
  });
  row.appendChild(copyNode);

  node.appendChild(row);

  if (isContainer) {
    const children = h('div', { class: 'jt-children' });
    if (kind === 'array') {
      value.forEach((item, index) => children.appendChild(treeNode(String(index), item, `${path}[${index}]`, false)));
    } else {
      for (const childKey of Object.keys(value)) {
        children.appendChild(treeNode(childKey, value[childKey], `${path}.${childKey}`, false));
      }
    }
    if (!children.childElementCount) children.appendChild(h('div', { class: 'jt-meta', text: '（空）' }));
    node.appendChild(children);
  }

  return node;
}

function renderTree(container) {
  const tree = h('div', { class: 'jt' }, treeNode('', state.value, '$', true));
  container.appendChild(tree);
}

/* ── JSONPath ─────────────────────────────────────────────── */

function renderPath(container) {
  const input = h('input', {
    type: 'text',
    class: 'mono',
    value: state.path,
    spellcheck: 'false',
    'aria-label': 'JSONPath 表达式',
    placeholder: '$.store.books[*].title'
  });

  const results = h('div', { id: 'path-results' });

  const update = () => {
    state.path = input.value;
    remember(`${STORAGE_ID}:path`, state.path);
    clear(results);

    const result = logic.queryJsonPath(state.value, state.path);
    if (!result.ok) {
      results.appendChild(h('div', { class: 'issue error' }, h('div', { class: 'issue-msg', text: result.error })));
      return;
    }
    if (!result.matches.length) {
      results.appendChild(h('div', { class: 'empty' }, '没有匹配的节点'));
      return;
    }

    results.appendChild(h('div', { class: 'match-count', text: `匹配到 ${result.matches.length} 个节点` }));
    for (const match of result.matches) {
      const valueText = typeof match.value === 'string' ? match.value : JSON.stringify(match.value, null, 2);
      const copyPath = h('button', {
        class: 'btn btn-sm btn-ghost',
        type: 'button',
        title: '复制路径'
      }, icon('copy', 12));

      copyPath.addEventListener('click', async () => {
        if (await copy(match.path)) toast.ok('路径已复制');
        else toast.fail('复制失败');
      });

      results.appendChild(h('div', { class: 'match' },
        h('div', { class: 'match-path' },
          h('span', { class: 'grow', text: match.path, title: match.path }),
          copyPath
        ),
        h('pre', { class: 'match-value', text: truncate(String(valueText), 4000) })
      ));
    }
  };

  input.addEventListener('input', debounce(update, 120));
  container.appendChild(h('div', { class: 'path-bar' }, input));
  container.appendChild(results);
  update();
}

/* ── 代码输出 ─────────────────────────────────────────────── */

function renderCode(container, code) {
  container.appendChild(h('pre', { class: 'code-out', text: code }));
}

function renderTypeScript(container) {
  const nameInput = h('input', {
    type: 'text',
    value: recall(`${STORAGE_ID}:rootName`, 'Root'),
    spellcheck: 'false',
    'aria-label': '根类型名'
  });

  const out = h('div', { class: 'grow', style: { minHeight: '0' } });
  const regenerate = () => {
    remember(`${STORAGE_ID}:rootName`, nameInput.value);
    clear(out);
    const result = logic.toTypeScript(state.value, nameInput.value.trim() || 'Root');
    if (result.ok) renderCode(out, result.code);
    else out.appendChild(h('div', { class: 'issue error' }, h('div', { class: 'issue-msg', text: result.error })));
  };

  nameInput.addEventListener('input', debounce(regenerate, 200));
  container.appendChild(h('div', { class: 'sub-bar' },
    h('span', { class: 'label', text: '根类型名' }),
    nameInput
  ));
  container.appendChild(out);
  regenerate();
}

function renderSchema(container) {
  const titleInput = h('input', {
    type: 'text',
    value: recall(`${STORAGE_ID}:schemaTitle`, 'Root'),
    spellcheck: 'false',
    'aria-label': 'Schema 标题'
  });
  const out = h('div', { class: 'grow' });

  const regenerate = () => {
    remember(`${STORAGE_ID}:schemaTitle`, titleInput.value);
    clear(out);
    const result = logic.toJsonSchema(state.value, titleInput.value.trim() || 'Root');
    if (result.ok) renderCode(out, result.code);
    else out.appendChild(h('div', { class: 'issue error' }, h('div', { class: 'issue-msg', text: result.error })));
  };

  titleInput.addEventListener('input', debounce(regenerate, 200));
  container.appendChild(h('div', { class: 'sub-bar' },
    h('span', { class: 'label', text: '标题' }),
    titleInput
  ));
  container.appendChild(out);
  regenerate();
}

/* ── 转义 ─────────────────────────────────────────────────── */

function renderEscape(container) {
  const source = h('textarea', {
    class: 'mono',
    spellcheck: 'false',
    placeholder: '粘贴需要转义或还原的文本 / JSON 字符串'
  });
  source.value = state.escapeSource || '';

  const result = h('textarea', { class: 'mono', spellcheck: 'false', readonly: true });
  result.value = state.escapeResult || '';

  const run = (fn) => {
    state.escapeSource = source.value;
    try {
      state.escapeResult = fn(source.value);
      result.value = state.escapeResult;
    } catch (error) {
      result.value = '';
      toast.fail(`转换失败：${error.message}`);
    }
  };

  const row = h('div', { class: 'row wrap' },
    h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => run(logic.escapeJsonString) }, '转为 JSON 字符串'),
    h('button', { class: 'btn btn-sm', type: 'button', onclick: () => run(logic.unescapeJsonString) }, '还原为文本'),
    h('span', { class: 'spacer grow' }),
    h('button', {
      class: 'btn btn-sm',
      type: 'button',
      onclick: async () => {
        if (await copy(result.value)) toast.ok('已复制');
        else toast.fail('复制失败');
      }
    }, '复制结果')
  );

  container.appendChild(h('div', { class: 'escape-grid' },
    h('div', { class: 'field' }, h('label', { text: '原文' }), source),
    row,
    h('div', { class: 'field' }, h('label', { text: '结果' }), result)
  ));
}

/* ── 状态与输出渲染 ───────────────────────────────────────── */

function renderInputStatus() {
  const box = els.inputStatus;
  clear(box);
  const text = currentText();

  if (!text.trim()) {
    box.appendChild(h('span', { class: 'hint', text: '等待输入' }));
    return;
  }

  if (state.error) {
    box.appendChild(h('span', { class: 'err', text: `✗ ${state.error.message}` }));
    if (state.error.line) {
      box.appendChild(h('span', { class: 'pos', text: `第 ${state.error.line} 行 : 第 ${state.error.column} 列` }));
    }
    return;
  }

  const stats = logic.jsonStats(state.value);
  box.appendChild(h('span', { class: 'ok', text: '✓ 合法 JSON' }));
  box.appendChild(h('span', { class: 'hint', text: `${stats.nodes} 节点 · 深度 ${stats.depth} · ${formatBytes(new Blob([text]).size)}` }));
}

function renderOutputActions() {
  const box = els.outputActions;
  clear(box);

  const addCopy = (getValue, label) => {
    const button = h('button', { class: 'btn btn-sm', type: 'button' }, icon('copy', 12), h('span', { text: label }));
    button.addEventListener('click', async () => {
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

  if (state.mode === 'tree' && state.value !== null) {
    box.appendChild(h('button', {
      class: 'btn btn-sm',
      type: 'button',
      onclick: () => {
        for (const node of els.output.querySelectorAll('.jt-node')) node.classList.remove('collapsed');
      }
    }, '展开全部'));
    box.appendChild(h('button', {
      class: 'btn btn-sm',
      type: 'button',
      onclick: () => {
        for (const node of els.output.querySelectorAll('.jt-node')) {
          if (node.querySelector('.jt-children')) node.classList.add('collapsed');
        }
      }
    }, '收起全部'));
    addCopy(() => JSON.stringify(state.value, null, logic.indentUnit(state.indent)), '复制 JSON');
  } else if (state.mode === 'path') {
    addCopy(() => JSON.stringify(logic.queryJsonPath(state.value, state.path).matches.map((m) => m.value), null, 2), '复制结果');
  } else if (state.mode === 'ts') {
    addCopy(() => logic.toTypeScript(state.value, $('#output input')?.value || 'Root').code, '复制代码');
  } else if (state.mode === 'schema') {
    addCopy(() => logic.toJsonSchema(state.value, $('#output input')?.value || 'Root').code, '复制 Schema');
  }
}

const MODE_HINTS = {
  tree: '点击 ▾ 折叠或展开，悬停任意行可复制该节点',
  path: '支持 .key、[n]、[*]、..key、..*、[a:b]、[a,b]',
  ts: '依据当前 JSON 结构推断接口，同名结构会自动合并',
  schema: '生成 JSON Schema 2020-12，可直接用于校验',
  escape: '在原始文本与 JSON 字符串字面量之间互转'
};

function renderOutput() {
  const box = els.output;
  clear(box);

  for (const tab of els.modes.querySelectorAll('[role="tab"]')) {
    tab.setAttribute('aria-selected', String(tab.dataset.mode === state.mode));
  }

  els.outputStatus.textContent = MODE_HINTS[state.mode] || '';

  if (state.mode !== 'escape') {
    if (state.error) {
      box.appendChild(renderIssue(state.error));
      renderOutputActions();
      return;
    }
    if (state.value === null || state.value === undefined) {
      box.appendChild(h('div', { class: 'empty' }, '输入 JSON 后在此查看结果'));
      renderOutputActions();
      return;
    }
  }

  if (state.mode === 'tree') renderTree(box);
  else if (state.mode === 'path') renderPath(box);
  else if (state.mode === 'ts') renderTypeScript(box);
  else if (state.mode === 'schema') renderSchema(box);
  else if (state.mode === 'escape') renderEscape(box);

  renderOutputActions();
}

/* ── 行号 ─────────────────────────────────────────────────── */

function updateGutter() {
  const lines = currentText().split('\n').length;
  if (els.gutter.childElementCount !== lines) {
    const fragment = document.createDocumentFragment();
    for (let i = 1; i <= lines; i += 1) fragment.appendChild(h('div', { text: String(i) }));
    mount(els.gutter, fragment);
  }
  els.gutter.scrollTop = els.input.scrollTop;
}

/* ── 主流程 ───────────────────────────────────────────────── */

/* 折叠状态下改文本是看不见的（命令面板仍可触发），先把输入区放出来。
   setText 是所有程序化改写的唯一收口，格式化/压缩/排序/示例/清空都经过它。 */
function expandForEdit() {
  if (els.fold.get()) els.fold.set(false);
}

function setText(next, { silent = false } = {}) {
  expandForEdit();
  els.input.value = next;
  refresh({ silent });
}

function refresh() {
  updateGutter();
  remember(STORAGE_ID, currentText());

  const parsed = logic.parseJson(currentText());
  if (parsed.ok) {
    state.value = parsed.value;
    state.error = null;
  } else {
    state.value = null;
    state.error = parsed.error;
  }

  renderInputStatus();
  renderOutput();
}

function applyTransform(fn, successMessage) {
  try {
    const next = fn(currentText());
    setText(next);
    if (successMessage) toast.ok(successMessage);
  } catch (error) {
    toast.fail(error.message);
    if (typeof error.position === 'number') {
      const area = els.input;
      const position = Math.min(error.position, area.value.length);
      area.focus();
      area.setSelectionRange(position, Math.min(position + 1, area.value.length));
    }
  }
}

function init() {
  els.input = $('#json-input');
  els.gutter = $('#gutter');
  els.output = $('#output');
  els.inputStatus = $('#input-status');
  els.outputStatus = $('#output-status');
  els.outputActions = $('#output-actions');
  els.modes = $('#modes');
  els.indent = $('#indent');

  els.input.value = recall(STORAGE_ID, '') || SAMPLE;
  state.indent = Number(recall(`${STORAGE_ID}:indent`, 2)) || 2;
  state.path = recall(`${STORAGE_ID}:path`, '$..login');
  if (String(state.indent) === 'tab') els.indent.value = 'tab';
  else els.indent.value = String(state.indent);

  els.input.addEventListener('input', debounce(refresh, 180));
  els.input.addEventListener('scroll', () => {
    els.gutter.scrollTop = els.input.scrollTop;
  });
  els.input.addEventListener('keydown', (event) => {
    // Tab 插入缩进而不是切换焦点，符合代码编辑器直觉
    if (event.key === 'Tab' && !event.shiftKey) {
      event.preventDefault();
      const area = els.input;
      const start = area.selectionStart;
      const end = area.selectionEnd;
      const unit = logic.indentUnit(els.indent.value === 'tab' ? 'tab' : Number(els.indent.value));
      area.setRangeText(unit, start, end, 'end');
      refresh();
    }
  });

  $('#indent').addEventListener('change', (event) => {
    state.indent = event.target.value === 'tab' ? 'tab' : Number(event.target.value);
    remember(`${STORAGE_ID}:indent`, state.indent);
    refresh();
  });

  $('#btn-format').addEventListener('click', () =>
    applyTransform((text) => logic.formatJson(text, els.indent.value === 'tab' ? 'tab' : Number(els.indent.value)), '已格式化')
  );
  $('#btn-minify').addEventListener('click', () => applyTransform(logic.minifyJson, '已压缩'));
  $('#btn-sort').addEventListener('click', () =>
    applyTransform((text) => logic.formatSorted(text, els.indent.value === 'tab' ? 'tab' : Number(els.indent.value)), '已按键名排序')
  );
  $('#btn-sample').addEventListener('click', () => setText(SAMPLE));
  $('#btn-clear').addEventListener('click', () => setText(''));

  for (const tab of els.modes.querySelectorAll('[role="tab"]')) {
    tab.addEventListener('click', () => {
      state.mode = tab.dataset.mode;
      renderOutput();
    });
  }

  mountTool({
    actions: [
      {
        id: 'format',
        label: '格式化 JSON',
        icon: 'check',
        keys: 'Ctrl+Enter',
        primary: true,
        keywords: 'format beautify 格式化',
        run: () => $('#btn-format').click()
      },
      { id: 'minify', label: '压缩 JSON', icon: 'codec', keywords: 'minify compress 压缩', run: () => $('#btn-minify').click() },
      { id: 'sort', label: '按键名排序', icon: 'sliders', keywords: 'sort keys 排序', run: () => $('#btn-sort').click() },
      { id: 'sample', label: '载入示例数据', icon: 'markdown', keywords: 'sample example 示例', run: () => $('#btn-sample').click() },
      { id: 'clear', label: '清空输入', icon: 'close', keywords: 'clear 清空', run: () => $('#btn-clear').click() },
      {
        id: 'fold-input',
        label: '折叠或展开输入区',
        icon: 'collapse',
        keywords: 'fold collapse 折叠 展开 收起 输入区 侧栏',
        run: () => {
          els.fold.set(!els.fold.get());
          els.fold.button.focus();
        }
      }
    ]
  });

  els.fold = createFold({
    layout: $('#json-layout'),
    head: $('#input-head'),
    storageKey: `${STORAGE_ID}:folded`,
    noun: '输入区',
    controls: 'input-body'
  });

  refresh();
}

init();
