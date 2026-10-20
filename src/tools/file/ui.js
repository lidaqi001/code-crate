/* 文件哈希与编码界面层：拖拽/选择文件 → 本地算摘要 → 按需生成文本编码。 */

import { h, mount, clear, $, formatBytes } from '../../core/dom.js';
import { mountTool } from '../../core/app.js';
import { icon } from '../../core/icons.js';
import { copyButton, downloadText } from '../../core/widgets.js';
import { read, write } from '../../core/storage.js';
import * as toast from '../../core/toast.js';
import * as logic from './logic.js';

const STORAGE_ID = 'file';
const MODES = ['hashes', 'base64', 'datauri', 'hex'];
const savedMode = read(`${STORAGE_ID}:mode`, 'hashes');

const els = {};
const state = {
  mode: MODES.includes(savedMode) ? savedMode : 'hashes',
  file: null,
  bytes: null,
  hashes: [],
  encoded: {},
  forced: false,
  busy: false,
  token: 0
};

function setStatus(message, kind = '') {
  els.status.className = `panel-foot ${kind}`.trim();
  els.status.textContent = message;
}

/* ── 载入文件 ─────────────────────────────────────────────── */

async function loadFile(file) {
  if (!file) return;

  const info = logic.describeFile(file);
  if (logic.exceedsHashLimit(file.size)) {
    setStatus(`文件超过 ${formatBytes(logic.MAX_HASH_BYTES)}，暂不支持`, 'text-err');
    toast.fail('文件过大，请拆分后再试');
    return;
  }

  const token = ++state.token;
  state.file = info;
  state.bytes = null;
  state.hashes = [];
  state.encoded = {};
  state.forced = false;
  state.busy = true;

  renderFileInfo();
  renderOutput();
  renderActions();
  setStatus(`正在读取 ${info.name}…`);

  try {
    const buffer = await file.arrayBuffer();
    if (token !== state.token) return;

    state.bytes = new Uint8Array(buffer);
    setStatus(`正在计算摘要…（${formatBytes(info.size)}）`);

    const hashes = await logic.hashFile(state.bytes);
    if (token !== state.token) return;

    state.hashes = hashes;
    state.busy = false;
    setStatus(`${info.name} · ${formatBytes(info.size)} · 摘要完成`);
    renderOutput();
    renderActions();
  } catch (error) {
    if (token !== state.token) return;
    state.busy = false;
    setStatus(`读取失败：${error.message}`, 'text-err');
  }
}

/* ── 文件信息 ─────────────────────────────────────────────── */

function renderFileInfo() {
  const box = $('#file-info');
  clear(box);

  if (!state.file) {
    box.appendChild(h('div', { class: 'note' }, '还没有选择文件。拖入文件，或点击上方区域选择。'));
    return;
  }

  const info = state.file;
  const parts = [formatBytes(info.size), info.mime];
  if (info.modified) parts.push(new Date(info.modified).toLocaleString('zh-CN', { hour12: false }));

  box.appendChild(h('div', { class: 'file-card' },
    h('div', { class: 'name', text: info.name }),
    h('div', { class: 'meta', text: parts.join(' · ') })
  ));
}

/* ── 输出 ─────────────────────────────────────────────────── */

function hashLines() {
  return state.hashes.map((entry) => `${entry.algorithm}: ${entry.value}`).join('\n');
}

function encodingValue() {
  if (!state.bytes) return null;
  if (state.encoded[state.mode] != null) return state.encoded[state.mode];
  if (logic.exceedsTextLimit(state.bytes.length) && !state.forced) return null;

  const value = state.mode === 'base64'
    ? logic.encodeBase64(state.bytes)
    : state.mode === 'hex'
      ? logic.encodeHex(state.bytes)
      : logic.encodeDataUri(state.bytes, state.file.mime);

  state.encoded[state.mode] = value;
  return value;
}

function renderHashes(box) {
  if (state.busy || !state.hashes.length) {
    box.appendChild(h('div', { class: 'empty-note', text: state.busy ? '正在计算摘要…' : '载入文件后这里会显示全部摘要' }));
    els.foot.textContent = '';
    return;
  }

  const list = h('div', { class: 'hash-list' });
  for (const entry of state.hashes) {
    list.appendChild(h('div', { class: 'hash-row' },
      h('span', { class: 'hash-name', text: entry.algorithm }),
      h('span', { class: 'hash-value', text: entry.value }),
      copyButton(() => entry.value, { title: `复制 ${entry.algorithm}` })
    ));
  }
  box.appendChild(list);
  els.foot.textContent = '摘要基于文件字节计算，与 sha256sum / md5sum 的结果一致。';
}

function renderEncoding(box) {
  if (!state.bytes) {
    box.appendChild(h('div', { class: 'empty-note', text: '载入文件后这里会显示编码结果' }));
    els.foot.textContent = '';
    return;
  }

  if (!state.forced && logic.exceedsTextLimit(state.bytes.length)) {
    const warning = h('div', { class: 'inline-error' },
      icon('warn', 14),
      h('span', { text: `文件 ${formatBytes(state.bytes.length)} 超过文本输出上限 ${formatBytes(logic.MAX_TEXT_BYTES)}，生成大段文本可能让页面卡顿。` })
    );
    const button = h('button', { class: 'btn btn-sm', type: 'button', text: '仍然生成' });
    button.addEventListener('click', () => {
      state.forced = true;
      renderOutput();
      renderActions();
    });
    box.appendChild(warning);
    box.appendChild(h('div', { class: 'row' }, button));
    els.foot.textContent = '哈希不受此限制。';
    return;
  }

  const value = encodingValue();
  const area = h('textarea', {
    class: 'mono encode-output',
    readonly: true,
    spellcheck: 'false',
    'aria-label': `${state.mode} 输出`
  });
  area.value = value;
  box.appendChild(area);

  if (state.mode === 'base64') {
    els.foot.textContent = `Base64 文本长度约 ${formatBytes(logic.base64Length(state.bytes.length))}。`;
  } else if (state.mode === 'datauri') {
    els.foot.textContent = 'Data URI 可直接用于 img src、CSS url() 或下载链接。';
  } else {
    els.foot.textContent = '十六进制为小写、无分隔符。';
  }
}

function renderOutput() {
  for (const tab of els.modes.querySelectorAll('[role="tab"]')) {
    tab.setAttribute('aria-selected', String(tab.dataset.mode === state.mode));
  }

  clear(els.output);
  if (!state.file) {
    els.output.appendChild(h('div', { class: 'empty-note', text: '拖入文件后开始计算' }));
    els.foot.textContent = '';
    return;
  }
  if (state.mode === 'hashes') renderHashes(els.output);
  else renderEncoding(els.output);
}

function renderActions() {
  clear(els.actions);
  if (!state.file) return;

  const download = (filename, content) => {
    const button = h('button', { class: 'btn btn-sm', type: 'button' }, icon('download', 12), h('span', { text: '下载' }));
    button.addEventListener('click', () => {
      downloadText(filename, content);
      toast.ok(`已导出 ${filename}`);
    });
    return button;
  };

  if (state.mode === 'hashes') {
    if (!state.hashes.length) return;
    els.actions.appendChild(copyButton(() => hashLines(), { label: '复制全部' }));
    els.actions.appendChild(download(`${state.file.name}.hashes.txt`, hashLines()));
    return;
  }

  const value = state.encoded[state.mode];
  if (value == null) return;
  const suffix = state.mode === 'base64' ? 'base64' : state.mode === 'hex' ? 'hex' : 'datauri';
  els.actions.appendChild(copyButton(() => value, { label: '复制' }));
  els.actions.appendChild(download(`${state.file.name}.${suffix}.txt`, value));
}

/* ── 初始化 ───────────────────────────────────────────────── */

function clearFile() {
  state.token += 1;
  state.file = null;
  state.bytes = null;
  state.hashes = [];
  state.encoded = {};
  state.forced = false;
  state.busy = false;
  $('#file').value = '';
  setStatus('');
  renderFileInfo();
  renderOutput();
  renderActions();
}

function init() {
  els.modes = $('#modes');
  els.output = $('#output');
  els.actions = $('#actions');
  els.status = $('#status');
  els.foot = $('#foot');

  $('#drop-icon').appendChild(icon('download', 18));

  for (const tab of els.modes.querySelectorAll('[role="tab"]')) {
    tab.addEventListener('click', () => {
      state.mode = tab.dataset.mode;
      write(`${STORAGE_ID}:mode`, state.mode);
      renderOutput();
      renderActions();
    });
  }

  $('#file').addEventListener('change', (event) => {
    const file = event.target.files && event.target.files[0];
    if (file) loadFile(file);
  });
  $('#btn-clear').addEventListener('click', clearFile);

  const zone = $('#drop');
  zone.addEventListener('dragover', (event) => {
    event.preventDefault();
    zone.classList.add('is-over');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('is-over'));
  zone.addEventListener('drop', (event) => {
    event.preventDefault();
    zone.classList.remove('is-over');
    const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
    if (file) loadFile(file);
  });

  // 防止文件被拖到页面其他位置时浏览器直接打开它
  document.addEventListener('dragover', (event) => event.preventDefault());
  document.addEventListener('drop', (event) => event.preventDefault());

  mountTool({
    actions: [
      { id: 'pick', label: '选择文件', icon: 'download', primary: true, keywords: 'file open 选择 打开', run: () => $('#file').click() },
      { id: 'mode-hashes', label: '查看哈希', icon: 'codec', keywords: 'hash md5 sha crc 哈希 摘要', run: () => { state.mode = 'hashes'; write(`${STORAGE_ID}:mode`, state.mode); renderOutput(); renderActions(); } },
      { id: 'mode-base64', label: '查看 Base64', icon: 'converter', keywords: 'base64 编码', run: () => { state.mode = 'base64'; write(`${STORAGE_ID}:mode`, state.mode); renderOutput(); renderActions(); } },
      { id: 'mode-datauri', label: '查看 Data URI', icon: 'image', keywords: 'datauri 编码', run: () => { state.mode = 'datauri'; write(`${STORAGE_ID}:mode`, state.mode); renderOutput(); renderActions(); } },
      {
        id: 'copy',
        label: '复制当前结果',
        icon: 'copy',
        keywords: 'copy 复制',
        run: () => {
          const value = state.mode === 'hashes' ? hashLines() : state.encoded[state.mode];
          if (!value) {
            toast.warn('还没有可复制的内容');
            return;
          }
          const button = copyButton(() => value);
          button.click();
        }
      },
      { id: 'clear', label: '清空文件', icon: 'close', keywords: 'clear 清空', run: clearFile }
    ]
  });

  renderFileInfo();
  renderOutput();
  renderActions();
}

init();
