/* 压缩与解压界面层 */

import { h, mount, clear, $, debounce } from '../../core/dom.js';
import { mountTool } from '../../core/app.js';
import { icon } from '../../core/icons.js';
import { copyButton, downloadText } from '../../core/widgets.js';
import { read, write } from '../../core/storage.js';
import * as toast from '../../core/toast.js';
import * as logic from './logic.js';

const STORAGE_ID = 'compress';
const SAMPLE = '码匣是一个零权限的开发者工具箱。\n压缩与解压都基于浏览器原生 CompressionStream，不依赖任何第三方库。\n'.repeat(4);

const els = {};
const state = {
  direction: read(`${STORAGE_ID}:direction`, 'compress') || 'compress',
  format: read(`${STORAGE_ID}:format`, 'gzip') || 'gzip',
  inputFormat: read(`${STORAGE_ID}:inputFormat`, 'text') || 'text',
  outputFormat: read(`${STORAGE_ID}:outputFormat`, 'base64') || 'base64',
  input: read(`${STORAGE_ID}:input`, '') || ''
};

let lastResult = null;
let runToken = 0;

function persist() {
  write(`${STORAGE_ID}:direction`, state.direction);
  write(`${STORAGE_ID}:format`, state.format);
  write(`${STORAGE_ID}:inputFormat`, state.inputFormat);
  write(`${STORAGE_ID}:outputFormat`, state.outputFormat);
  write(`${STORAGE_ID}:input`, state.input);
}

function fillSelect(node, options, value) {
  mount(node, options.map((option) =>
    h('option', { value: String(option.id), selected: String(option.id) === String(value) }, option.label)
  ));
  node.value = String(value);
}

function errorBox(message) {
  return h('div', { class: 'inline-error' }, icon('close', 13), h('span', { text: message }));
}

function formatBytes(value) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
}

/* ── 渲染 ─────────────────────────────────────────────────── */

function renderActions() {
  const box = $('#actions');
  clear(box);
  if (!lastResult || !lastResult.ok) return;

  box.appendChild(copyButton(() => lastResult.output, { label: '复制结果', title: '复制输出' }));

  const toText = h('button', { class: 'btn btn-sm', type: 'button' }, '把结果作为输入');
  toText.addEventListener('click', () => {
    state.input = lastResult.output;
    state.direction = state.direction === 'compress' ? 'decompress' : 'compress';
    state.inputFormat = state.outputFormat;
    persist();
    els.input.value = state.input;
    syncControls();
    refresh();
    toast.ok('已填入并切换方向');
  });
  box.appendChild(toText);

  if (lastResult.text) {
    const downloadButton = h('button', { class: 'btn btn-sm', type: 'button' },
      icon('download', 12), h('span', { text: '下载解压结果' }));
    downloadButton.addEventListener('click', () => {
      downloadText('decompressed.txt', lastResult.text, 'text/plain;charset=utf-8');
      toast.ok('已导出');
    });
    box.appendChild(downloadButton);
  }
}

async function refresh() {
  const box = $('#output');
  clear(box);
  clear(els.status);
  els.status.className = 'panel-foot';
  lastResult = null;

  const text = els.input.value;
  if (!text.trim()) {
    box.appendChild(h('div', { class: 'note' }, state.direction === 'compress' ? '输入内容后自动压缩' : '粘贴 Base64 或十六进制压缩数据即可自动识别并解压'));
    renderActions();
    return;
  }

  const token = ++runToken;
  let result;
  try {
    result = await logic.run({
      direction: state.direction,
      format: state.format,
      inputText: text,
      inputFormat: state.inputFormat,
      outputFormat: state.outputFormat
    });
  } catch (error) {
    result = { ok: false, error: error.message };
  }
  if (token !== runToken) return;

  lastResult = result;

  if (!result.ok) {
    els.status.className = 'panel-foot text-err';
    els.status.textContent = `✗ ${result.error}`;
    box.appendChild(errorBox(result.error));
    renderActions();
    return;
  }

  if (state.direction === 'compress') {
    const info = result.info;
    els.status.textContent = '压缩完成';

    box.appendChild(h('div', { class: 'stat-row' },
      h('div', { class: 'stat-cell' }, h('div', { class: 'k', text: '原始' }), h('div', { class: 'v', text: formatBytes(info.originalSize) })),
      h('div', { class: 'stat-cell' }, h('div', { class: 'k', text: '压缩后' }), h('div', { class: 'v', text: formatBytes(info.compressedSize) })),
      h('div', { class: 'stat-cell' },
        h('div', { class: 'k', text: info.expanded ? '膨胀' : '节省' }),
        h('div', { class: `v ${info.expanded ? 'warn' : 'good'}`, text: `${Math.abs(info.percent).toFixed(1)}%` })
      ),
      h('div', { class: 'stat-cell' }, h('div', { class: 'k', text: '比率' }), h('div', { class: 'v', text: `${(info.ratio * 100).toFixed(1)}%` }))
    ));

    if (info.expanded) {
      box.appendChild(h('div', { class: 'note' }, '内容太短时压缩头部开销会大于收益，压缩后反而变大是正常现象'));
    }
  } else {
    const format = logic.getFormat(result.format);
    els.status.textContent = `解压完成，识别为 ${format.label}`;

    box.appendChild(h('div', { class: 'stat-row' },
      h('div', { class: 'stat-cell' }, h('div', { class: 'k', text: '输入' }), h('div', { class: 'v', text: formatBytes(result.inputSize) })),
      h('div', { class: 'stat-cell' }, h('div', { class: 'k', text: '解压后' }), h('div', { class: 'v', text: formatBytes(result.size) }))
    ));

    if (result.text !== null) {
      box.appendChild(h('div', { class: 'section-label' }, `文本内容${result.guessed ? '（格式为推断）' : ''}`));
      box.appendChild(h('div', { class: 'output-box', text: result.text }));
    } else {
      box.appendChild(h('div', { class: 'note' }, '解压结果是二进制内容，无法直接当文本显示，请复制下方编码结果'));
    }

    box.appendChild(h('div', { class: 'section-label' }, '解压结果（编码）'));
  }

  box.appendChild(h('div', { class: 'section-label' }, '输出'));
  box.appendChild(h('div', { class: 'output-box', text: result.output }));
  box.appendChild(h('div', { class: 'note' },
    state.direction === 'compress'
      ? `输出为 ${state.outputFormat === 'hex' ? '十六进制' : 'Base64'}，可直接作为 HTTP 头或配置值使用`
      : `已按 ${state.outputFormat === 'hex' ? '十六进制' : 'Base64'} 输出，可直接当文本使用`
  ));

  renderActions();
}

/* ── 控件同步 ─────────────────────────────────────────────── */

function syncControls() {
  for (const tab of els.directions.querySelectorAll('[role="tab"]')) {
    tab.setAttribute('aria-selected', String(tab.dataset.direction === state.direction));
  }

  const isCompress = state.direction === 'compress';
  const formatOptions = isCompress
    ? logic.FORMATS.map((entry) => ({ id: entry.id, label: entry.label }))
    : [{ id: 'auto', label: '自动识别' }, ...logic.FORMATS.map((entry) => ({ id: entry.id, label: `强制按 ${entry.label}` }))];
  if (!formatOptions.some((option) => option.id === state.format)) state.format = isCompress ? 'gzip' : 'auto';

  fillSelect($('#format'), formatOptions, state.format);
  fillSelect($('#input-format'), logic.INPUT_FORMATS, state.inputFormat);
  fillSelect($('#output-format'), logic.OUTPUT_FORMATS, state.outputFormat);
  // 解压模式也要能手动指定格式（以及切回自动识别）
  $('#format-field').style.display = '';
}

/* ── 初始化 ───────────────────────────────────────────────── */

function init() {
  els.directions = $('#directions');
  els.input = $('#input');
  els.status = $('#status');
  els.foot = $('#foot');

  els.input.value = state.input;

  els.input.addEventListener('input', debounce(() => {
    state.input = els.input.value;
    persist();
    refresh();
  }, 250));

  for (const tab of els.directions.querySelectorAll('[role="tab"]')) {
    tab.addEventListener('click', () => {
      state.direction = tab.dataset.direction;
      state.inputFormat = state.direction === 'compress' ? 'text' : state.outputFormat;
      // 切到解压时默认自动识别；否则会沿用压缩模式的 gzip，导致非 gzip 数据直接失败
      state.format = state.direction === 'compress' ? 'gzip' : 'auto';
      persist();
      syncControls();
      refresh();
    });
  }

  syncControls();

  $('#format').addEventListener('change', () => {
    state.format = $('#format').value;
    persist();
    refresh();
  });
  $('#input-format').addEventListener('change', () => {
    state.inputFormat = $('#input-format').value;
    persist();
    refresh();
  });
  $('#output-format').addEventListener('change', () => {
    state.outputFormat = $('#output-format').value;
    persist();
    refresh();
  });

  $('#btn-clear').addEventListener('click', () => {
    els.input.value = '';
    state.input = '';
    persist();
    refresh();
    els.input.focus();
  });

  mountTool({
    actions: [
      { id: 'refresh', label: '立即处理', icon: 'refresh', keys: 'Ctrl+Enter', primary: true, keywords: 'run 执行 压缩 解压', run: refresh },
      { id: 'sample', label: '载入示例文本', icon: 'markdown', keywords: 'sample 示例', run: () => {
        state.direction = 'compress';
        state.inputFormat = 'text';
        els.input.value = SAMPLE;
        state.input = SAMPLE;
        persist();
        syncControls();
        refresh();
      } },
      { id: 'clear', label: '清空输入', icon: 'close', keywords: 'clear 清空', run: () => $('#btn-clear').click() },
      {
        id: 'to-decompress',
        label: '切到解压',
        icon: 'converter',
        keywords: 'decompress 解压',
        run: () => {
          state.direction = 'decompress';
          state.format = 'auto';
          state.inputFormat = state.outputFormat;
          persist();
          syncControls();
          refresh();
        }
      }
    ]
  });

  refresh();
}

init();
