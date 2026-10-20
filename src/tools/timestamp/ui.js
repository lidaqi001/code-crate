/* 时间戳工具界面层 */

import { h, mount, clear, $, debounce } from '../../core/dom.js';
import { mountTool } from '../../core/app.js';
import { copyButton } from '../../core/widgets.js';
import { read, write } from '../../core/storage.js';
import * as toast from '../../core/toast.js';
import * as logic from './logic.js';

const STORAGE_ID = 'timestamp';

const els = {};
const state = {
  mode: 'now',
  timeZone: read(`${STORAGE_ID}:tz`, null) || logic.localTimeZone(),
  timer: 0,
  paused: false
};

const COMPARE_ZONES = ['UTC', 'Asia/Shanghai', 'Asia/Tokyo', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Australia/Sydney'];

/* ── 通用小部件 ───────────────────────────────────────────── */

function timeZoneSelect(value, onChange, { id } = {}) {
  const select = h('select', { class: 'mini-select', id, 'aria-label': '选择时区' });
  const zones = logic.listTimeZones();
  const list = zones.includes(value) ? zones : [value, ...zones];
  for (const zone of list) {
    select.appendChild(h('option', { value: zone, selected: zone === value }, zone));
  }
  select.value = value;
  select.addEventListener('change', () => onChange(select.value));
  return select;
}

function resultRow(label, { strong = false } = {}) {
  const value = h('span', { class: `result-value${strong ? ' strong' : ''}` });
  const node = h('div', { class: 'result-row' },
    h('span', { class: 'result-label', text: label }),
    value,
    copyButton(() => value.textContent, { title: `复制 ${label}` })
  );
  return {
    node,
    set(text) {
      value.textContent = text;
    },
    get() {
      return value.textContent;
    }
  };
}

function zoneTable(ms) {
  const zones = [...new Set([state.timeZone, logic.localTimeZone(), ...COMPARE_ZONES])];
  const table = h('table', { class: 'claims zone-table' });
  for (const zone of zones) {
    table.appendChild(h('tr', {},
      h('th', { text: zone }),
      h('td', { text: `${logic.isoInZone(ms, zone)}  ${logic.formatOffset(ms, zone)}` })
    ));
  }
  return table;
}

/* ── 当前时间 ─────────────────────────────────────────────── */

function renderNow(container) {
  const timeNode = h('div', { class: 'clock-time' });
  const dateNode = h('div', { class: 'clock-date' });
  const zoneNode = h('div', { class: 'clock-zone' });

  const seconds = resultRow('秒级时间戳', { strong: true });
  const millis = resultRow('毫秒级时间戳', { strong: true });
  const isoLocal = resultRow('该时区时间');
  const isoUtc = resultRow('UTC 时间');
  const relative = resultRow('相对此刻');

  const pauseButton = h('button', { class: 'btn btn-sm', type: 'button' });
  const syncPause = () => {
    pauseButton.textContent = state.paused ? '继续' : '暂停';
  };
  pauseButton.addEventListener('click', () => {
    state.paused = !state.paused;
    syncPause();
    if (!state.paused) tick();
  });
  syncPause();

  const tick = () => {
    if (state.paused) return;
    const ms = Date.now();
    timeNode.textContent = logic.isoInZone(ms, state.timeZone).slice(11);
    dateNode.textContent = logic.formatInZone(ms, state.timeZone, { dateStyle: 'full', timeStyle: undefined }).replace(/\s+/g, ' ');
    zoneNode.textContent = `${state.timeZone} · ${logic.formatOffset(ms, state.timeZone)}`;
    seconds.set(String(Math.floor(ms / 1000)));
    millis.set(String(ms));
    isoLocal.set(logic.isoInZone(ms, state.timeZone));
    isoUtc.set(logic.isoInZone(ms, 'UTC'));
    relative.set(logic.relativeFromNow(ms, ms) === '刚刚' ? '此刻' : logic.relativeFromNow(ms));
  };

  container.appendChild(h('div', { class: 'clock' },
    timeNode,
    dateNode,
    zoneNode
  ));

  container.appendChild(h('div', { class: 'row', style: { justifyContent: 'center', marginBottom: '4px' } },
    pauseButton,
    copyButton(() => `${Math.floor(Date.now() / 1000)}`, { label: '复制秒级戳', title: '复制当前秒级时间戳' }),
    copyButton(() => `${Date.now()}`, { label: '复制毫秒戳', title: '复制当前毫秒级时间戳' })
  ));

  container.appendChild(h('div', { class: 'result-list' },
    seconds.node, millis.node, isoLocal.node, isoUtc.node, relative.node
  ));

  tick();
  state.timer = setInterval(tick, 1000);
}

/* ── 时间戳 → 时间 ────────────────────────────────────────── */

function renderFromTs(container) {
  const input = h('input', {
    type: 'text',
    class: 'mono big-input',
    spellcheck: 'false',
    placeholder: '输入时间戳，如 1767225600 或 1767225600000',
    'aria-label': '时间戳',
    value: read(`${STORAGE_ID}:fromTs`, '') || ''
  });

  const unitBadge = h('span', { class: 'unit-badge' });
  const status = h('span', { class: 'hint' });

  const inZone = resultRow('该时区时间', { strong: true });
  const utc = resultRow('UTC 时间');
  const local = resultRow('本地时间');
  const seconds = resultRow('秒级时间戳');
  const millis = resultRow('毫秒级时间戳');
  const relative = resultRow('相对此刻');

  const zoneHolder = h('div');

  const update = () => {
    const text = input.value.trim();
    write(`${STORAGE_ID}:fromTs`, text);
    clear(zoneHolder);

    if (!text) {
      unitBadge.textContent = '';
      status.textContent = '';
      for (const entry of [inZone, utc, local, seconds, millis, relative]) entry.set('—');
      return;
    }

    let parsed;
    try {
      parsed = logic.parseTimestamp(text);
    } catch (error) {
      unitBadge.textContent = '';
      status.className = 'hint text-err';
      status.textContent = `✗ ${error.message}`;
      for (const entry of [inZone, utc, local, seconds, millis, relative]) entry.set('—');
      return;
    }

    status.className = 'hint';
    status.textContent = '';
    unitBadge.textContent = `识别为${logic.UNIT_LABELS[parsed.unit]}`;

    const ms = parsed.ms;
    inZone.set(logic.isoInZone(ms, state.timeZone));
    utc.set(logic.isoInZone(ms, 'UTC'));
    local.set(logic.isoInZone(ms, logic.localTimeZone()));
    seconds.set(String(Math.floor(ms / 1000)));
    millis.set(String(Math.round(ms)));
    relative.set(logic.relativeFromNow(ms));

    zoneHolder.appendChild(zoneTable(ms));
  };

  input.addEventListener('input', debounce(update, 150));

  container.appendChild(h('div', { class: 'field' },
    h('label', { text: '时间戳' }),
    input
  ));
  container.appendChild(h('div', { class: 'ts-actions', style: { marginTop: '10px' } },
    h('button', {
      class: 'btn btn-sm',
      type: 'button',
      onclick: () => {
        input.value = String(Date.now());
        update();
      }
    }, '填入当前毫秒'),
    h('button', {
      class: 'btn btn-sm',
      type: 'button',
      onclick: () => {
        input.value = String(Math.floor(Date.now() / 1000));
        update();
      }
    }, '填入当前秒'),
    h('button', {
      class: 'btn btn-sm',
      type: 'button',
      onclick: () => {
        input.value = '';
        update();
      }
    }, '清空'),
    h('span', { class: 'grow' }),
    status
  ));

  container.appendChild(h('div', { class: 'row' },
    h('span', { class: 'result-label', text: '解析结果' }),
    unitBadge
  ));

  container.appendChild(h('div', { class: 'result-list' },
    inZone.node, utc.node, local.node, seconds.node, millis.node, relative.node
  ));

  container.appendChild(h('div', { style: { marginTop: '16px' } },
    h('div', { class: 'label', text: '多时区对照' }),
    zoneHolder
  ));

  update();
}

/* ── 时间 → 时间戳 ────────────────────────────────────────── */

function renderToTs(container) {
  const now = Date.now();
  const input = h('input', {
    type: 'datetime-local',
    step: '1',
    class: 'mono big-input',
    value: read(`${STORAGE_ID}:toTs`, '') || logic.toDateTimeLocalValue(now, state.timeZone),
    'aria-label': '日期时间'
  });

  const sourceZone = { value: read(`${STORAGE_ID}:sourceTz`, null) || state.timeZone };

  const status = h('span', { class: 'hint' });
  const seconds = resultRow('秒级时间戳', { strong: true });
  const millis = resultRow('毫秒级时间戳', { strong: true });
  const utc = resultRow('UTC 时间');
  const isoZone = resultRow('所选时区时间');
  const relative = resultRow('相对此刻');
  const zoneHolder = h('div');

  const update = () => {
    write(`${STORAGE_ID}:toTs`, input.value);
    clear(zoneHolder);
    try {
      const wall = logic.parseDateTimeLocal(input.value);
      const ms = logic.zonedTimeToUtc(wall, sourceZone.value);
      status.className = 'hint';
      status.textContent = `${logic.formatOffset(ms, sourceZone.value)} · ${logic.zoneAbbreviation(ms, sourceZone.value)}`;

      seconds.set(String(Math.floor(ms / 1000)));
      millis.set(String(ms));
      utc.set(logic.isoInZone(ms, 'UTC'));
      isoZone.set(logic.isoInZone(ms, sourceZone.value));
      relative.set(logic.relativeFromNow(ms));
      zoneHolder.appendChild(zoneTable(ms));
    } catch (error) {
      status.className = 'hint text-err';
      status.textContent = `✗ ${error.message}`;
      for (const entry of [seconds, millis, utc, isoZone, relative]) entry.set('—');
    }
  };

  input.addEventListener('input', debounce(update, 150));

  const zoneSelect = timeZoneSelect(sourceZone.value, (zone) => {
    sourceZone.value = zone;
    write(`${STORAGE_ID}:sourceTz`, zone);
    update();
  }, { id: 'source-tz' });

  container.appendChild(h('div', { class: 'ts-inputs' },
    h('div', { class: 'field' }, h('label', { text: '日期时间' }), input),
    h('div', { class: 'field' }, h('label', { text: '该时间所属时区' }), zoneSelect)
  ));

  container.appendChild(h('div', { class: 'ts-actions' },
    h('button', {
      class: 'btn btn-sm',
      type: 'button',
      onclick: () => {
        input.value = logic.toDateTimeLocalValue(Date.now(), sourceZone.value);
        update();
      }
    }, '填入当前时间'),
    h('button', {
      class: 'btn btn-sm',
      type: 'button',
      onclick: () => {
        const wall = logic.parseDateTimeLocal(input.value);
        const ms = logic.zonedTimeToUtc(wall, sourceZone.value);
        const next = logic.addCalendarDays(ms, 1, sourceZone.value);
        input.value = logic.toDateTimeLocalValue(next, sourceZone.value);
        update();
      }
    }, '+1 天'),
    h('button', {
      class: 'btn btn-sm',
      type: 'button',
      onclick: () => {
        const wall = logic.parseDateTimeLocal(input.value);
        const ms = logic.zonedTimeToUtc(wall, sourceZone.value);
        const next = logic.addCalendarDays(ms, -1, sourceZone.value);
        input.value = logic.toDateTimeLocalValue(next, sourceZone.value);
        update();
      }
    }, '-1 天'),
    h('span', { class: 'grow' }),
    status
  ));

  container.appendChild(h('div', { class: 'result-list' },
    seconds.node, millis.node, isoZone.node, utc.node, relative.node
  ));

  container.appendChild(h('div', { style: { marginTop: '16px' } },
    h('div', { class: 'label', text: '多时区对照' }),
    zoneHolder
  ));

  update();
}

/* ── 日期差 ───────────────────────────────────────────────── */

function renderDiff(container) {
  const now = Date.now();
  const startInput = h('input', {
    type: 'datetime-local',
    step: '1',
    class: 'mono',
    value: logic.toDateTimeLocalValue(now, state.timeZone),
    'aria-label': '开始时间'
  });
  const endInput = h('input', {
    type: 'datetime-local',
    step: '1',
    class: 'mono',
    value: logic.toDateTimeLocalValue(logic.addCalendarDays(now, 30, state.timeZone), state.timeZone),
    'aria-label': '结束时间'
  });

  const grid = h('div', { class: 'diff-grid' });
  const total = resultRow('总计');
  const absolute = resultRow('绝对差值');

  const update = () => {
    clear(grid);
    let start;
    let end;
    try {
      start = logic.zonedTimeToUtc(logic.parseDateTimeLocal(startInput.value), state.timeZone);
      end = logic.zonedTimeToUtc(logic.parseDateTimeLocal(endInput.value), state.timeZone);
    } catch {
      total.set('—');
      absolute.set('—');
      return;
    }

    const diff = logic.calendarDiff(start, end);
    const cells = [
      ['年', diff.years],
      ['月', diff.months],
      ['天', diff.days],
      ['时', diff.hours],
      ['分', diff.minutes],
      ['秒', diff.seconds]
    ];
    for (const [unit, value] of cells) {
      grid.appendChild(h('div', { class: 'diff-cell' },
        h('div', { class: 'n', text: String(value) }),
        h('div', { class: 'u', text: unit })
      ));
    }

    total.set(`${diff.totalDays.toFixed(2)} 天 · ${diff.totalHours.toFixed(2)} 小时 · ${Math.round(diff.totalMs / 1000)} 秒`);
    total.node.querySelector('.result-value').classList.remove('strong');
    absolute.set(diff.forward ? '结束晚于开始' : '结束早于开始');
  };

  startInput.addEventListener('input', update);
  endInput.addEventListener('input', update);

  container.appendChild(h('div', { class: 'ts-inputs' },
    h('div', { class: 'field' }, h('label', { text: '开始时间' }), startInput),
    h('div', { class: 'field' }, h('label', { text: '结束时间' }), endInput)
  ));

  container.appendChild(h('div', { class: 'ts-actions' },
    h('button', {
      class: 'btn btn-sm',
      type: 'button',
      onclick: () => {
        endInput.value = logic.toDateTimeLocalValue(Date.now(), state.timeZone);
        update();
      }
    }, '结束时间设为现在'),
    h('button', {
      class: 'btn btn-sm',
      type: 'button',
      onclick: () => {
        startInput.value = logic.toDateTimeLocalValue(Date.now(), state.timeZone);
        update();
      }
    }, '开始时间设为现在'),
    h('button', {
      class: 'btn btn-sm',
      type: 'button',
      onclick: () => {
        [startInput.value, endInput.value] = [endInput.value, startInput.value];
        update();
      }
    }, '交换')
  ));

  container.appendChild(grid);
  container.appendChild(h('div', { class: 'result-list' }, total.node, absolute.node));

  update();
}

/* ── 主流程 ───────────────────────────────────────────────── */

const RENDERERS = { now: renderNow, fromTs: renderFromTs, toTs: renderToTs, diff: renderDiff };

const STATUS_HINTS = {
  now: '每秒刷新；暂停可停止刷新以便复制',
  fromTs: '会自动识别秒 / 毫秒 / 微秒 / 纳秒，也可直接粘贴日期时间字符串',
  toTs: '所选「所属时区」决定输入被如何解释，跨夏令时也按真实偏移计算',
  diff: '按自然年月日 + 时分秒给出差值，同时给出总天数与总小时数'
};

function renderStage() {
  clearTimeout(state.timer);
  clearInterval(state.timer);
  state.timer = 0;
  state.paused = false;

  clear(els.stage);
  for (const tab of els.modes.querySelectorAll('[role="tab"]')) {
    tab.setAttribute('aria-selected', String(tab.dataset.mode === state.mode));
  }
  (RENDERERS[state.mode] || renderNow)(els.stage);
  els.status.textContent = STATUS_HINTS[state.mode] || '';
}

function init() {
  els.modes = $('#modes');
  els.stage = $('#stage');
  els.status = $('#status');
  els.tzSlot = $('#tz-slot');

  state.mode = read(`${STORAGE_ID}:mode`, 'now');
  if (!RENDERERS[state.mode]) state.mode = 'now';

  els.tzSlot.appendChild(h('span', { class: 'label', text: '显示时区' }));
  els.tzSlot.appendChild(h('span', {
    class: 'sr-only',
    text: '所有结果按此时区展示'
  }));
  els.tzSlot.appendChild(timeZoneSelect(state.timeZone, (zone) => {
    state.timeZone = zone;
    write(`${STORAGE_ID}:tz`, zone);
    renderStage();
  }, { id: 'display-tz' }));

  for (const tab of els.modes.querySelectorAll('[role="tab"]')) {
    tab.addEventListener('click', () => {
      state.mode = tab.dataset.mode;
      write(`${STORAGE_ID}:mode`, state.mode);
      renderStage();
    });
  }

  window.addEventListener('beforeunload', () => clearInterval(state.timer));

  mountTool({
    actions: [
      { id: 'mode-now', label: '查看当前时间', icon: 'timestamp', keywords: 'now clock 当前', primary: true, run: () => switchMode('now') },
      { id: 'mode-fromTs', label: '时间戳转时间', icon: 'timestamp', keywords: 'timestamp 时间戳', run: () => switchMode('fromTs') },
      { id: 'mode-toTs', label: '时间转时间戳', icon: 'timestamp', keywords: 'date 日期', run: () => switchMode('toTs') },
      { id: 'mode-diff', label: '计算日期差', icon: 'diff', keywords: 'diff 日期差', run: () => switchMode('diff') },
      {
        id: 'copy-now',
        label: '复制当前毫秒时间戳',
        icon: 'copy',
        keywords: 'copy timestamp 复制时间戳',
        run: async () => {
          const { copy } = await import('../../core/clipboard.js');
          if (await copy(String(Date.now()))) toast.ok('已复制当前毫秒时间戳');
          else toast.fail('复制失败');
        }
      }
    ]
  });

  renderStage();
}

function switchMode(mode) {
  state.mode = mode;
  write(`${STORAGE_ID}:mode`, mode);
  renderStage();
}

init();
