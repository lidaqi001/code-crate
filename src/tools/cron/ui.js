/* Cron 工具界面层 */

import { h, mount, clear, $, debounce } from '../../core/dom.js';
import { mountTool } from '../../core/app.js';
import { icon } from '../../core/icons.js';
import { copy } from '../../core/clipboard.js';
import { read, write } from '../../core/storage.js';
import * as toast from '../../core/toast.js';
import * as logic from './logic.js';

const STORAGE_ID = 'cron';
const RUN_COUNT = 6;

const els = {};
const state = { expression: read(`${STORAGE_ID}:expression`, '') || '0 3 * * *' };

const pad = (value) => String(value).padStart(2, '0');
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function formatDateTime(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())} ${WEEKDAYS[date.getDay()]}`;
}

function formatRelative(date, now) {
  const diff = date.getTime() - now;
  if (diff < 0) return '已过去';
  const units = [
    [86400000, '天'],
    [3600000, '小时'],
    [60000, '分钟'],
    [1000, '秒']
  ];
  for (const [size, label] of units) {
    if (diff >= size) {
      const value = Math.floor(diff / size);
      const rest = Math.floor((diff % size) / (size === 86400000 ? 3600000 : 1000));
      return label === '秒' ? `${Math.round(diff / 1000)} 秒后` : `${value} ${label}${rest ? ` ${rest} ${label === '天' ? '小时' : '分钟'}` : ''}后`;
    }
  }
  return '即将触发';
}

/* ── 常用表达式 ───────────────────────────────────────────── */

function renderCommon() {
  const box = $('#common');
  mount(box, logic.COMMON_EXPRESSIONS.map((entry) =>
    h('button', {
      class: 'common-item',
      type: 'button',
      title: `使用 ${entry.expression}`,
      onclick: () => {
        els.expression.value = entry.expression;
        refresh();
        toast.ok(`已填入「${entry.note}」`);
      }
    },
      h('span', { class: 'common-expr', text: entry.expression }),
      h('span', { class: 'common-note', text: entry.note })
    )
  ));
}

/* ── 结果渲染 ─────────────────────────────────────────────── */

function renderFields(container, detail) {
  const table = h('table', { class: 'field-table' },
    h('thead', {}, h('tr', {},
      h('th', { class: 'col-label', text: '字段' }),
      h('th', { text: '取值' }),
      h('th', { class: 'col-count', text: '个数' })
    ))
  );

  const body = h('tbody');
  for (const field of detail) {
    body.appendChild(h('tr', {},
      h('td', { class: 'col-label', text: field.label }),
      h('td', { class: 'col-raw', text: field.raw }),
      h('td', { class: 'col-count', text: String(field.resolved.length) })
    ));
  }
  table.appendChild(body);
  container.appendChild(table);
}

function renderRuns(container, runs, truncated) {
  container.appendChild(h('div', { class: 'section-title' }, `接下来 ${runs.length} 次触发`));

  if (!runs.length) {
    container.appendChild(h('div', { class: 'empty-note' },
      '未来 5 年内没有匹配的时间点（例如 2 月 31 日这种组合）'
    ));
    return;
  }

  const now = Date.now();
  const list = h('div', { class: 'run-list' });
  runs.forEach((run, index) => {
    list.appendChild(h('div', { class: 'run-row' },
      h('span', { class: 'run-index', text: String(index + 1) }),
      h('span', { class: 'run-time', text: formatDateTime(run) }),
      h('span', { class: 'run-relative', text: formatRelative(run, now) })
    ));
  });
  container.appendChild(list);

  if (truncated) {
    container.appendChild(h('div', { class: 'field-note' }, '（5 年内未凑齐更多次数，已停止搜索）'));
  }
}

/* ── 主流程 ───────────────────────────────────────────────── */

function renderActions(runs) {
  const box = $('#actions');
  clear(box);

  const add = (label, getValue, iconName) => {
    const button = h('button', { class: 'btn btn-sm', type: 'button' }, icon(iconName, 12), h('span', { text: label }));
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

  add('复制表达式', () => state.expression.trim(), 'copy');
  if (runs.length) {
    add('复制触发时间', () => runs.map(formatDateTime).join('\n'), 'copy');
  }
}

function refresh() {
  state.expression = els.expression.value;
  write(`${STORAGE_ID}:expression`, state.expression);

  const box = $('#output');
  clear(box);

  const description = logic.describeCron(state.expression);

  if (!description.ok) {
    els.expression.classList.add('invalid');
    els.status.className = 'panel-foot text-err';
    els.status.textContent = `✗ ${description.error}`;
    $('#shape').textContent = '';
    box.appendChild(h('div', { class: 'error-box' }, icon('close', 14), h('span', { text: description.error })));
    renderActions([]);
    return;
  }

  els.expression.classList.remove('invalid');
  els.status.className = 'panel-foot';
  els.status.textContent = '解析成功';

  const parsed = logic.parseCron(state.expression);
  const fieldCount = parsed.hasSeconds ? 6 : 5;
  $('#shape').textContent = `${fieldCount} 个字段（${parsed.hasSeconds ? '秒 分 时 日 月 周' : '分 时 日 月 周'}）`;

  box.appendChild(h('div', { class: 'description-box' },
    h('div', { class: 'description-text', text: description.text }),
    h('div', { class: 'description-sub', text: parsed.normalized })
  ));

  renderFields(box, description.detail);

  const result = logic.nextRuns(state.expression, { count: RUN_COUNT });
  const runs = result.ok ? result.runs : [];
  renderRuns(box, runs, result.ok ? result.truncated : false);
  renderActions(runs);

  $('#foot').textContent = result.ok && runs.length
    ? `按本地时区（${Intl.DateTimeFormat().resolvedOptions().timeZone}）计算`
    : '';
}

/* ── 初始化 ───────────────────────────────────────────────── */

function init() {
  els.expression = $('#expression');
  els.status = $('#status');

  els.expression.value = state.expression;
  els.expression.addEventListener('input', debounce(refresh, 220));
  els.expression.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      refresh();
    }
  });

  $('#btn-sample').addEventListener('click', () => {
    els.expression.value = '*/15 9-17 * * 1-5';
    refresh();
    toast.ok('已载入示例');
  });

  $('#btn-clear').addEventListener('click', () => {
    els.expression.value = '';
    refresh();
    els.expression.focus();
  });

  renderCommon();

  mountTool({
    actions: [
      { id: 'parse', label: '解析表达式', icon: 'refresh', keys: 'Ctrl+Enter', primary: true, keywords: 'parse 解析', run: refresh },
      { id: 'sample', label: '载入示例', icon: 'markdown', keywords: 'sample 示例', run: () => $('#btn-sample').click() },
      { id: 'clear', label: '清空', icon: 'close', keywords: 'clear 清空', run: () => $('#btn-clear').click() },
      {
        id: 'copy-runs',
        label: '复制接下来的触发时间',
        icon: 'copy',
        keywords: 'copy 复制 触发时间',
        run: async () => {
          const result = logic.nextRuns(state.expression, { count: RUN_COUNT });
          if (!result.ok || !result.runs.length) {
            toast.warn('没有可复制的触发时间');
            return;
          }
          if (await copy(result.runs.map(formatDateTime).join('\n'))) toast.ok('已复制触发时间');
          else toast.fail('复制失败');
        }
      },
      ...logic.COMMON_EXPRESSIONS.slice(0, 6).map((entry, index) => ({
        id: `common-${index}`,
        label: `用「${entry.note}」`,
        icon: 'timestamp',
        keywords: `common ${entry.expression} ${entry.note}`,
        run: () => {
          els.expression.value = entry.expression;
          refresh();
        }
      }))
    ]
  });

  refresh();
}

init();
