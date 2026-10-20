/* 正则工具界面层 */

import { h, mount, clear, $, debounce } from '../../core/dom.js';
import { mountTool } from '../../core/app.js';
import { icon } from '../../core/icons.js';
import { copyButton } from '../../core/widgets.js';
import { read, write } from '../../core/storage.js';
import * as toast from '../../core/toast.js';
import * as logic from './logic.js';

const STORAGE_ID = 'regex';
const HIGHLIGHT_LIMIT = 200000;
const RENDER_LIMIT = 500;

const els = {};
const state = {
  pattern: read(`${STORAGE_ID}:pattern`, '') || '\\b\\w+@\\w+\\.\\w+\\b',
  flags: new Set(read(`${STORAGE_ID}:flags`, null) || ['g']),
  text: read(`${STORAGE_ID}:text`, '') || '联系 dev@example.com 或 ops@example.org 获取支持',
  replacement: read(`${STORAGE_ID}:replacement`, '') || '',
  mode: read(`${STORAGE_ID}:mode`, 'matches'),
  compiled: null,
  matches: []
};

function persist() {
  write(`${STORAGE_ID}:pattern`, state.pattern);
  write(`${STORAGE_ID}:flags`, [...state.flags]);
  write(`${STORAGE_ID}:text`, state.text);
  write(`${STORAGE_ID}:replacement`, state.replacement);
  write(`${STORAGE_ID}:mode`, state.mode);
}

/* ── 顶部：表达式与标志 ───────────────────────────────────── */

function renderFlags() {
  const row = $('#flag-row');
  mount(row, logic.FLAG_INFO.map((info) => {
    const box = h('input', {
      type: 'checkbox',
      id: `flag-${info.flag}`,
      checked: state.flags.has(info.flag)
    });
    box.addEventListener('change', () => {
      if (box.checked) state.flags.add(info.flag);
      else state.flags.delete(info.flag);
      update();
    });
    return h('label', { class: 'check', for: `flag-${info.flag}` },
      box,
      h('span', { text: `${info.label}` }),
      h('span', { class: 'kbd', text: info.flag })
    );
  }));
}

function renderRisk() {
  const slot = $('#risk-slot');
  clear(slot);
  const risk = logic.detectRisk(state.pattern);
  if (!risk.risky) return;
  slot.appendChild(h('span', {
    class: 'risk-hint',
    title: risk.reasons.join('\n')
  }, icon('close', 12), h('span', { text: '可能存在灾难性回溯' })));
}

/* ── 各结果视图 ───────────────────────────────────────────── */

function renderMatches(container) {
  if (!state.matches.length) {
    container.appendChild(h('div', { class: 'empty' }, '没有匹配项'));
    return;
  }

  const shown = state.matches.slice(0, RENDER_LIMIT);
  for (const [ordinal, match] of shown.entries()) {
    const card = h('div', { class: 'match-card' },
      h('div', { class: 'match-head' },
        h('span', { class: 'match-ordinal', text: `#${ordinal + 1}` }),
        h('span', { class: 'match-range', text: `${match.index} – ${match.end}` }),
        h('span', { class: 'grow', style: { flex: '1 1 auto' } }),
        copyButton(() => match.value, { title: '复制该匹配' })
      ),
      match.value === ''
        ? h('div', { class: 'match-body empty', text: '（零宽匹配）' })
        : h('div', { class: 'match-body', text: match.value })
    );

    for (const group of match.groups) {
      card.appendChild(h('div', { class: 'group-row' },
        h('span', { class: 'group-name', text: `$${group.index}` }),
        group.value === null
          ? h('span', { class: 'group-value unmatched', text: '（未参与匹配）' })
          : h('span', { class: 'group-value', text: group.value })
      ));
    }

    if (match.named) {
      for (const [name, value] of Object.entries(match.named)) {
        card.appendChild(h('div', { class: 'group-row' },
          h('span', { class: 'group-name', text: `$<${name}>` }),
          h('span', { class: 'group-value', text: value === undefined ? '（未参与匹配）' : value })
        ));
      }
    }

    container.appendChild(card);
  }

  if (state.matches.length > shown.length) {
    container.appendChild(h('div', { class: 'hint', text: `仅显示前 ${RENDER_LIMIT} 条，共 ${state.matches.length} 条` }));
  }
}

function renderHighlight(container) {
  const text = state.text;
  if (text.length > HIGHLIGHT_LIMIT) {
    container.appendChild(h('div', { class: 'issue' },
      h('div', { class: 'issue-msg', text: '文本过长，已跳过高亮渲染' }),
      h('div', { class: 'issue-pos', text: `当前 ${text.length} 字符，上限 ${HIGHLIGHT_LIMIT}` })
    ));
    return;
  }

  const view = h('div', { class: 'highlight-view mono' });
  let cursor = 0;

  for (const [ordinal, match] of state.matches.entries()) {
    if (match.index > cursor) {
      view.appendChild(document.createTextNode(text.slice(cursor, match.index)));
    }
    if (match.value === '') {
      view.appendChild(h('span', {
        class: 'zero-width',
        title: `#${ordinal + 1} 零宽匹配 @${match.index}`
      }));
    } else {
      view.appendChild(h('mark', {
        class: 'hl',
        title: `#${ordinal + 1} · ${match.index}–${match.end}`
      }, match.value));
    }
    cursor = Math.max(cursor, match.end);
  }

  if (cursor < text.length) view.appendChild(document.createTextNode(text.slice(cursor)));
  container.appendChild(view);
}

function renderReplace(container) {
  if (!state.compiled) {
    container.appendChild(h('div', { class: 'empty' }, '表达式无效，无法替换'));
    return;
  }

  const input = h('input', {
    type: 'text',
    class: 'mono',
    spellcheck: 'false',
    value: state.replacement,
    placeholder: '替换为… 支持 $1、$<name>、$&',
    'aria-label': '替换内容'
  });

  const result = h('div', { class: 'match-body replace-result' });
  const countLabel = h('span', { class: 'hint' });

  const run = () => {
    state.replacement = input.value;
    persist();
    const { result: output, count } = logic.replaceWith(state.compiled, state.text, input.value);
    result.textContent = output;
    countLabel.textContent = count ? `已替换 ${count} 处` : '没有匹配，未发生替换';
  };

  input.addEventListener('input', debounce(run, 150));

  container.appendChild(h('div', { class: 'field', style: { marginBottom: '12px' } },
    h('div', { class: 'field-head' },
      h('label', { text: '替换为' }),
      h('span', { class: 'grow' }),
      countLabel,
      copyButton(() => result.textContent, { label: '复制结果', title: '复制替换结果' })
    ),
    input
  ));
  container.appendChild(h('div', { class: 'label', text: '替换结果' }));
  container.appendChild(result);
  run();
}

function renderExplain(container) {
  if (!state.pattern) {
    container.appendChild(h('div', { class: 'empty' }, '先输入正则表达式'));
    return;
  }

  const tokens = logic.explainPattern(state.pattern);
  if (!tokens.length) {
    container.appendChild(h('div', { class: 'empty' }, '没有可解释的内容'));
    return;
  }

  const table = h('table', { class: 'explain-table' });
  for (const token of tokens) {
    table.appendChild(h('tr', {},
      h('td', { text: token.token }),
      h('td', { text: token.description })
    ));
  }
  container.appendChild(table);
}

function renderCheatsheet(container) {
  for (const entry of logic.COMMON_PATTERNS) {
    container.appendChild(h('div', { class: 'cheat-item' },
      h('div', { class: 'cheat-head' },
        h('span', { class: 'cheat-name', text: entry.name }),
        h('span', { class: 'grow', style: { flex: '1 1 auto' } }),
        h('button', {
          class: 'btn btn-sm',
          type: 'button',
          onclick: () => {
            $('#pattern').value = entry.pattern;
            state.pattern = entry.pattern;
            state.mode = 'matches';
            update();
            toast.ok(`已载入「${entry.name}」`);
          }
        }, '使用'),
        copyButton(() => entry.pattern, { title: '复制表达式' })
      ),
      h('div', { class: 'cheat-pattern', text: `/${entry.pattern}/` }),
      h('div', { class: 'cheat-note', text: `${entry.note} · 示例：${entry.sample}` })
    ));
  }
}

/* ── 渲染入口 ─────────────────────────────────────────────── */

const RENDERERS = {
  matches: renderMatches,
  highlight: renderHighlight,
  replace: renderReplace,
  explain: renderExplain,
  cheatsheet: renderCheatsheet
};

const MODE_HINTS = {
  matches: '每条匹配都会展开编号分组与命名分组',
  highlight: '高亮显示匹配位置，橙色竖线代表零宽匹配',
  replace: '替换串支持 $1、$<name>、$& 等原生语法',
  explain: '把表达式拆成片段并逐段说明，便于读懂复杂正则',
  cheatsheet: '点击「使用」把常用表达式填入上方'
};

function renderActions() {
  const box = $('#actions');
  clear(box);

  const copyAll = (getValue, label) => {
    const button = h('button', { class: 'btn btn-sm', type: 'button' },
      icon('copy', 12), h('span', { text: label }));
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

  if (state.mode === 'matches' && state.matches.length) {
    copyAll(() => state.matches.map((m) => m.value).join('\n'), '复制全部匹配');
  } else if (state.mode === 'highlight' && state.matches.length) {
    copyAll(() => state.matches.map((m) => `${m.index}: ${m.value}`).join('\n'), '复制位置清单');
  } else if (state.mode === 'explain' && state.pattern) {
    copyAll(() => logic.explainPattern(state.pattern).map((t) => `${t.token}\t${t.description}`).join('\n'), '复制解释');
  }
}

function renderOutput() {
  for (const tab of els.modes.querySelectorAll('[role="tab"]')) {
    tab.setAttribute('aria-selected', String(tab.dataset.mode === state.mode));
  }

  const box = $('#output');
  clear(box);

  if (!state.pattern) {
    box.appendChild(h('div', { class: 'empty' }, '输入正则表达式后开始匹配'));
    renderActions();
    els.status.textContent = MODE_HINTS[state.mode] || '';
    return;
  }

  if (!state.compiled) {
    box.appendChild(h('div', { class: 'issue error' },
      h('div', { class: 'issue-msg', text: `表达式无效：${state.error || '编译失败'}` })
    ));
    renderActions();
    els.status.textContent = '请修正表达式';
    return;
  }

  (RENDERERS[state.mode] || renderMatches)(box);
  renderActions();
  els.status.textContent = MODE_HINTS[state.mode] || '';
}

/* ── 主更新流程 ───────────────────────────────────────────── */

function update() {
  state.pattern = $('#pattern').value;
  state.text = $('#text').value;
  persist();

  const row = $('.pattern-row');
  const compiled = logic.compileRegex(state.pattern, [...state.flags].join(''));

  if (!compiled.ok) {
    state.compiled = null;
    state.matches = [];
    state.error = compiled.error;
    row.classList.add('invalid');
    $('#flags-display').textContent = '';
    $('#match-count').textContent = '';
    $('#status').className = 'panel-foot text-err';
    $('#status').textContent = `✗ ${compiled.error}`;
    renderOutput();
    renderRisk();
    return;
  }

  state.compiled = compiled.regex;
  state.error = null;
  row.classList.remove('invalid');
  $('#flags-display').textContent = compiled.flags.replace('d', '');
  state.matches = state.text ? logic.findMatches(compiled.regex, state.text) : [];
  $('#match-count').textContent = state.text
    ? `${state.matches.length} 处匹配`
    : '';

  renderRisk();
  renderOutput();
}

/* ── 初始化 ───────────────────────────────────────────────── */

function init() {
  els.modes = $('#modes');
  els.status = $('#status');

  const patternInput = $('#pattern');
  const textArea = $('#text');
  patternInput.value = state.pattern;
  textArea.value = state.text;

  patternInput.addEventListener('input', debounce(update, 120));
  textArea.addEventListener('input', debounce(update, 180));

  renderFlags();

  for (const tab of els.modes.querySelectorAll('[role="tab"]')) {
    tab.addEventListener('click', () => {
      state.mode = tab.dataset.mode;
      persist();
      renderOutput();
    });
  }

  mountTool({
    actions: [
      { id: 'mode-matches', label: '查看匹配列表', icon: 'search', primary: true, keywords: 'match 匹配', run: () => setMode('matches') },
      { id: 'mode-highlight', label: '高亮匹配位置', icon: 'regex', keywords: 'highlight 高亮', run: () => setMode('highlight') },
      { id: 'mode-replace', label: '替换', icon: 'refresh', keywords: 'replace 替换', run: () => setMode('replace') },
      { id: 'mode-explain', label: '解释表达式', icon: 'markdown', keywords: 'explain 解释', run: () => setMode('explain') },
      { id: 'mode-cheatsheet', label: '打开常用正则速查', icon: 'star', keywords: 'cheatsheet 速查 常用', run: () => setMode('cheatsheet') },
      {
        id: 'copy-matches',
        label: '复制全部匹配',
        icon: 'copy',
        keywords: 'copy 复制',
        run: async () => {
          const { copy } = await import('../../core/clipboard.js');
          if (!state.matches.length) {
            toast.warn('没有匹配项');
            return;
          }
          if (await copy(state.matches.map((m) => m.value).join('\n'))) toast.ok('已复制全部匹配');
          else toast.fail('复制失败');
        }
      }
    ]
  });

  update();
}

function setMode(mode) {
  state.mode = mode;
  persist();
  renderOutput();
}

init();
