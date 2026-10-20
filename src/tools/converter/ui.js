/* 格式转换界面层 */

import { h, mount, clear, $, debounce } from '../../core/dom.js';
import { mountTool } from '../../core/app.js';
import { icon } from '../../core/icons.js';
import { copyButton, downloadText } from '../../core/widgets.js';
import { read, write } from '../../core/storage.js';
import * as toast from '../../core/toast.js';
import * as logic from './logic.js';

const STORAGE_ID = 'converter';

const SAMPLES = {
  json: JSON.stringify(
    {
      name: 'codecrate',
      version: 2,
      enabled: true,
      tags: ['json', 'yaml', 'toml'],
      server: { host: 'localhost', port: 8080, tls: { enabled: false } },
      items: [{ id: 1, label: 'a' }, { id: 2, label: 'b' }]
    },
    null,
    2
  ),
  yaml: ['name: codecrate', 'version: 2', 'enabled: true', 'tags:', '  - json', '  - yaml', 'server:', '  host: localhost', '  port: 8080'].join('\n'),
  toml: ['name = "codecrate"', 'version = 2', 'enabled = true', 'tags = ["json", "yaml", "toml"]', '', '[server]', 'host = "localhost"', 'port = 8080'].join('\n'),
  xml: ['<config>', '  <name>codecrate</name>', '  <version>2</version>', '  <server host="localhost" port="8080"/>', '</config>'].join('\n'),
  csv: 'id,label,enabled\n1,a,true\n2,b,false',
  tsv: 'id\tlabel\n1\ta\n2\tb'
};

const els = {};
const state = {
  from: read(`${STORAGE_ID}:from`, 'json'),
  to: read(`${STORAGE_ID}:to`, 'yaml'),
  autoDetect: read(`${STORAGE_ID}:autoDetect`, true),
  indent: read(`${STORAGE_ID}:indent`, 2),
  rootName: read(`${STORAGE_ID}:rootName`, 'root'),
  delimiter: read(`${STORAGE_ID}:delimiter`, ','),
  declaration: read(`${STORAGE_ID}:declaration`, false),
  detected: ''
};

function persist() {
  write(`${STORAGE_ID}:from`, state.from);
  write(`${STORAGE_ID}:to`, state.to);
  write(`${STORAGE_ID}:autoDetect`, state.autoDetect);
  write(`${STORAGE_ID}:indent`, state.indent);
  write(`${STORAGE_ID}:rootName`, state.rootName);
  write(`${STORAGE_ID}:delimiter`, state.delimiter);
  write(`${STORAGE_ID}:declaration`, state.declaration);
}

/* ── 格式下拉 ─────────────────────────────────────────────── */

function fillFormatSelect(select, selected, onChange) {
  mount(select, logic.FORMATS.map((format) =>
    h('option', { value: format.id, selected: format.id === selected }, format.label)
  ));
  select.value = selected;
  select.addEventListener('change', () => onChange(select.value));
}

/* ── 选项区 ───────────────────────────────────────────────── */

function buildOptions() {
  const bar = $('#options');
  clear(bar);

  const needsIndent = ['json', 'yaml', 'xml'].includes(state.to);
  const needsRoot = state.to === 'xml';
  const needsDelimiter = state.to === 'csv';

  if (needsIndent) {
    const select = h('select', { id: 'opt-indent', 'aria-label': '缩进' },
      [
        { value: 0, label: '压缩' },
        { value: 2, label: '2 空格' },
        { value: 4, label: '4 空格' }
      ].map((option) => h('option', { value: String(option.value), selected: option.value === Number(state.indent) }, option.label))
    );
    select.value = String(state.indent);
    select.addEventListener('change', () => {
      state.indent = Number(select.value);
      persist();
      convert();
    });
    bar.appendChild(h('div', { class: 'field' }, h('label', { text: '缩进' }), select));
  }

  if (needsRoot) {
    const input = h('input', { type: 'text', class: 'mono', id: 'opt-root', value: state.rootName, 'aria-label': '根元素名' });
    input.addEventListener('input', debounce(() => {
      state.rootName = input.value.trim() || 'root';
      persist();
      convert();
    }, 200));
    bar.appendChild(h('div', { class: 'field' }, h('label', { text: '根元素名' }), input));

    const box = h('input', { type: 'checkbox', id: 'opt-declaration', checked: state.declaration });
    box.addEventListener('change', () => {
      state.declaration = box.checked;
      persist();
      convert();
    });
    bar.appendChild(h('label', { class: 'check', for: 'opt-declaration' }, box, h('span', { text: 'XML 声明' })));
  }

  if (needsDelimiter) {
    const select = h('select', { id: 'opt-delimiter', 'aria-label': '分隔符' },
      [
        { value: ',', label: '逗号 ,' },
        { value: ';', label: '分号 ;' },
        { value: '\t', label: '制表符' },
        { value: '|', label: '竖线 |' }
      ].map((option) => h('option', { value: option.value, selected: option.value === state.delimiter }, option.label))
    );
    select.value = state.delimiter;
    select.addEventListener('change', () => {
      state.delimiter = select.value;
      persist();
      convert();
    });
    bar.appendChild(h('div', { class: 'field' }, h('label', { text: '分隔符' }), select));
  }

  const note = logic.FORMAT_HINTS[state.to];
  if (note) bar.appendChild(h('div', { class: 'opt-note', text: `${logic.formatById(state.to).label}：${note}` }));
}

/* ── 转换 ─────────────────────────────────────────────────── */

function convert() {
  const text = els.input.value;

  if (state.autoDetect && text.trim()) {
    const detected = logic.detectFormat(text);
    state.detected = detected;
    if (detected !== state.from) {
      state.from = detected;
      els.from.value = detected;
      persist();
      buildOptions();
    }
  } else {
    state.detected = '';
  }

  els.detected.textContent = state.detected && state.detected !== state.from ? `识别为 ${logic.formatById(state.detected).label}` : '';

  const inputStats = logic.describe(text);
  els.inputStatus.textContent = text.trim()
    ? `${inputStats.lines} 行 · ${inputStats.characters} 字符`
    : '等待输入';

  clear(els.status);
  els.status.className = 'panel-foot';

  if (!text.trim()) {
    els.output.value = '';
    els.status.textContent = '';
    renderActions();
    return;
  }

  const result = logic.convert(text, state.from, state.to, {
    indent: state.indent,
    rootName: state.rootName,
    delimiter: state.delimiter,
    declaration: state.declaration,
    autoDetect: state.autoDetect
  });

  if (!result.ok) {
    els.output.value = '';
    els.status.className = 'panel-foot';
    els.status.appendChild(h('span', { class: 'convert-error' }, icon('close', 12), h('span', { text: result.error })));
    renderActions();
    return;
  }

  els.output.value = result.output;
  const outputStats = logic.describe(result.output);
  mount(els.status,
    h('span', { class: 'convert-ok' }, '✓ 转换完成'),
    h('span', { class: 'size-hint', text: `${outputStats.lines} 行 · ${outputStats.characters} 字符` })
  );
  renderActions();
}

/* ── 动作 ─────────────────────────────────────────────────── */

function renderActions() {
  const box = $('#actions');
  clear(box);

  const from = logic.formatById(state.from);
  const to = logic.formatById(state.to);

  box.appendChild(copyButton(() => els.output.value, { label: '复制结果', title: '复制转换结果' }));

  const downloadButton = h('button', { class: 'btn btn-sm', type: 'button' },
    icon('download', 12), h('span', { text: '下载' }));
  downloadButton.addEventListener('click', () => {
    if (!els.output.value) {
      toast.warn('还没有可下载的结果');
      return;
    }
    downloadText(`converted.${to?.extension ?? 'txt'}`, els.output.value, 'text/plain;charset=utf-8');
    toast.ok(`已导出（${from?.label} → ${to?.label}）`);
  });
  box.appendChild(downloadButton);

  const swapButton = h('button', { class: 'btn btn-sm', type: 'button', title: '把结果作为新的输入，并交换格式' },
    h('span', { text: '⇅ 交换' }));
  swapButton.addEventListener('click', () => {
    if (!els.output.value) {
      toast.warn('还没有可交换的结果');
      return;
    }
    const nextInput = els.output.value;
    const previousFrom = state.from;
    state.from = state.to;
    state.to = previousFrom;
    state.autoDetect = false;
    els.autoDetect.checked = false;
    els.input.value = nextInput;
    els.from.value = state.from;
    els.to.value = state.to;
    persist();
    buildOptions();
    convert();
    toast.ok('已交换');
  });
  box.appendChild(swapButton);
}

/* ── 初始化 ───────────────────────────────────────────────── */

function init() {
  els.input = $('#input');
  els.output = $('#output');
  els.from = $('#from');
  els.to = $('#to');
  els.detected = $('#detected');
  els.inputStatus = $('#input-status');
  els.status = $('#status');
  els.autoDetect = $('#auto-detect');

  if (!logic.formatById(state.from)) state.from = 'json';
  if (!logic.formatById(state.to)) state.to = 'yaml';

  fillFormatSelect(els.from, state.from, (value) => {
    state.from = value;
    state.autoDetect = false;
    els.autoDetect.checked = false;
    persist();
    convert();
  });

  fillFormatSelect(els.to, state.to, (value) => {
    state.to = value;
    persist();
    buildOptions();
    convert();
  });

  els.autoDetect.checked = state.autoDetect;
  els.autoDetect.addEventListener('change', () => {
    state.autoDetect = els.autoDetect.checked;
    persist();
    convert();
  });

  els.input.value = read(`${STORAGE_ID}:input`, '') || SAMPLES.json;
  els.input.addEventListener('input', debounce(() => {
    write(`${STORAGE_ID}:input`, els.input.value);
    convert();
  }, 200));

  $('#btn-sample').addEventListener('click', () => {
    els.input.value = SAMPLES[state.from] || SAMPLES.json;
    write(`${STORAGE_ID}:input`, els.input.value);
    convert();
    toast.ok(`已载入 ${logic.formatById(state.from).label} 示例`);
  });

  $('#btn-clear').addEventListener('click', () => {
    els.input.value = '';
    write(`${STORAGE_ID}:input`, '');
    convert();
    els.input.focus();
  });

  mountTool({
    actions: [
      { id: 'convert', label: '执行转换', icon: 'refresh', keys: 'Ctrl+Enter', primary: true, keywords: 'convert 转换', run: convert },
      { id: 'sample', label: '载入当前格式的示例', icon: 'markdown', keywords: 'sample 示例', run: () => $('#btn-sample').click() },
      { id: 'clear', label: '清空输入', icon: 'close', keywords: 'clear 清空', run: () => $('#btn-clear').click() },
      ...logic.FORMATS.map((format) => ({
        id: `to-${format.id}`,
        label: `转换为 ${format.label}`,
        icon: 'codec',
        keywords: `to ${format.id} ${format.label}`,
        run: () => {
          state.to = format.id;
          els.to.value = format.id;
          persist();
          buildOptions();
          convert();
        }
      }))
    ]
  });

  buildOptions();
  convert();
}

init();
