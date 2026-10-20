/* Wi-Fi 二维码界面层：把网络配置编码成 WIFI: 串并渲染成二维码 */

import { h, mount, clear, $, debounce } from '../../core/dom.js';
import { mountTool } from '../../core/app.js';
import { icon } from '../../core/icons.js';
import { copyButton } from '../../core/widgets.js';
import { read, write } from '../../core/storage.js';
import * as toast from '../../core/toast.js';
import * as logic from './logic.js';
import * as qr from '../../core/qrcode.js';
import * as qrRender from '../../core/qr-render.js';

const STORAGE_ID = 'wifi';

const els = {};
const state = {
  ssid: read(`${STORAGE_ID}:ssid`, '') || '',
  password: read(`${STORAGE_ID}:password`, '') || '',
  security: read(`${STORAGE_ID}:security`, 'WPA') || 'WPA',
  hidden: read(`${STORAGE_ID}:hidden`, false) === true,
  reveal: false
};

let lastText = '';

function persist() {
  write(`${STORAGE_ID}:ssid`, state.ssid);
  write(`${STORAGE_ID}:password`, state.password);
  write(`${STORAGE_ID}:security`, state.security);
  write(`${STORAGE_ID}:hidden`, state.hidden);
}

/* ── 校验提示 ─────────────────────────────────────────────── */

function renderProblems() {
  const box = $('#problems');
  clear(box);
  if (!state.ssid.trim()) {
    box.appendChild(h('ul', { class: 'problem-list' },
      h('li', { class: 'warn' }, icon('warn', 12), h('span', { text: '填入网络名称后即可生成二维码' }))
    ));
    return;
  }

  const problems = logic.validateWifi(state);
  const advice = logic.securityAdvice(state.security);
  const items = [];

  if (problems.length) {
    for (const problem of problems) {
      items.push(h('li', { class: 'err' }, icon('close', 12), h('span', { text: problem })));
    }
  } else {
    items.push(h('li', { class: 'ok' }, icon('check', 12), h('span', { text: '配置看起来没问题' })));
  }

  if (advice) items.push(h('li', { class: 'warn' }, icon('warn', 12), h('span', { text: advice })));
  if (state.hidden) {
    items.push(h('li', { class: 'warn' }, icon('warn', 12), h('span', {
      text: '隐藏网络：部分手机相机扫码后仍需要在系统设置里手动选择该网络'
    })));
  }

  box.appendChild(h('ul', { class: 'problem-list' }, items));
}

/* ── 二维码与输出 ─────────────────────────────────────────── */

function renderOutput() {
  const box = $('#output');
  clear(box);
  clear(els.status);
  els.status.className = 'panel-foot';
  lastText = '';

  const built = logic.buildWifiString(state);
  if (!built.ok) {
    els.status.className = 'panel-foot text-err';
    els.status.textContent = `✗ ${built.error}`;
    box.appendChild(h('div', { class: 'empty-note', text: built.error }));
    renderActions('');
    return;
  }

  lastText = built.text;

  const result = qr.encode(built.text, { ecc: 'M' });
  if (!result.ok) {
    els.status.className = 'panel-foot text-err';
    els.status.textContent = `✗ ${result.error}`;
    box.appendChild(h('div', { class: 'empty-note', text: `二维码编码失败：${result.error}` }));
    renderActions('');
    return;
  }

  const stage = h('div', { class: 'qr-stage' });
  const canvas = qrRender.createQrCanvas(result, { quietZone: 4, targetSize: 260, minScale: 2 });
  if (canvas) stage.appendChild(canvas);

  const security = logic.SECURITY_TYPES.find((entry) => entry.id === state.security);
  stage.appendChild(h('div', { class: 'ssid-caption' },
    h('div', { class: 'name', text: state.ssid.trim() }),
    h('div', { class: 'meta', text: `${security ? security.label : state.security}${state.hidden ? ' · 隐藏网络' : ''} · 版本 ${result.version}` })
  ));
  box.appendChild(stage);

  box.appendChild(h('div', { class: 'section-label' }, '二维码内容'));
  box.appendChild(h('pre', { class: 'code-box', text: built.text }));
  box.appendChild(h('div', { class: 'note' }, '手机相机对准二维码即可连网，不需要手动输入密码'));

  if (built.warnings.length) {
    box.appendChild(h('ul', { class: 'problem-list', style: { marginTop: '10px' } },
      built.warnings.map((warning) => h('li', { class: 'warn' }, icon('warn', 12), h('span', { text: warning })))
    ));
  }

  els.status.textContent = `已生成 · ${result.version} 版 · ${result.matrixSize}×${result.matrixSize} 模块`;
  els.foot.textContent = '二维码在本地生成，网络信息不会离开这台设备';

  renderActions(built.text);
}

function renderActions(text) {
  const box = $('#actions');
  clear(box);
  if (!text) return;

  box.appendChild(copyButton(() => lastText, { label: '复制内容', title: '复制 WIFI: 串' }));

  const downloadButton = h('button', { class: 'btn btn-sm', type: 'button' }, icon('download', 12), h('span', { text: '下载 PNG' }));
  downloadButton.addEventListener('click', async () => {
    const canvas = $('.qr-stage canvas');
    if (!canvas) {
      toast.warn('还没有二维码');
      return;
    }
    if (await qrRender.downloadCanvasPng(canvas, `wifi-${state.ssid.trim() || 'network'}.png`)) toast.ok('已导出二维码');
    else toast.fail('导出失败');
  });
  box.appendChild(downloadButton);

  const parseButton = h('button', { class: 'btn btn-sm', type: 'button' }, '反查配置');
  parseButton.addEventListener('click', () => {
    const parsed = logic.parseWifiString(lastText);
    if (!parsed.ok) {
      toast.fail(parsed.error);
      return;
    }
    toast.ok(`解析得到：${parsed.ssid} · ${parsed.security}${parsed.hidden ? ' · 隐藏' : ''}`);
  });
  box.appendChild(parseButton);
}

/* ── 渲染 ─────────────────────────────────────────────────── */

function render() {
  els.password.type = state.reveal ? 'text' : 'password';
  els.passwordField.style.display = state.security === 'nopass' ? 'none' : '';
  $('#btn-reveal').textContent = state.reveal ? '隐藏' : '显示';
  renderProblems();
  renderOutput();
}

function init() {
  els.status = $('#status');
  els.foot = $('#foot');
  els.password = $('#password');
  els.passwordField = $('#password-field');

  const ssidInput = $('#ssid');
  ssidInput.value = state.ssid;
  ssidInput.addEventListener('input', debounce(() => {
    state.ssid = ssidInput.value;
    persist();
    renderProblems();
    renderOutput();
  }, 250));

  els.password.value = state.password;
  els.password.addEventListener('input', debounce(() => {
    state.password = els.password.value;
    persist();
    renderProblems();
    renderOutput();
  }, 250));

  mount($('#security'), logic.SECURITY_TYPES.map((entry) =>
    h('option', { value: entry.id, selected: entry.id === state.security }, entry.label)
  ));
  $('#security').value = state.security;
  $('#security').addEventListener('change', () => {
    state.security = $('#security').value;
    persist();
    render();
  });

  const hiddenBox = $('#hidden');
  hiddenBox.checked = state.hidden;
  hiddenBox.addEventListener('change', () => {
    state.hidden = hiddenBox.checked;
    persist();
    render();
  });

  $('#btn-reveal').addEventListener('click', () => {
    state.reveal = !state.reveal;
    render();
  });

  $('#btn-sample').addEventListener('click', () => {
    state.ssid = logic.WIFI_SAMPLE.ssid;
    state.password = logic.WIFI_SAMPLE.password;
    state.security = logic.WIFI_SAMPLE.security;
    state.hidden = logic.WIFI_SAMPLE.hidden;
    persist();
    ssidInput.value = state.ssid;
    els.password.value = state.password;
    $('#security').value = state.security;
    hiddenBox.checked = state.hidden;
    render();
    toast.ok('已载入示例');
  });

  mountTool({
    actions: [
      { id: 'sample', label: '载入示例网络', icon: 'markdown', primary: true, keywords: 'sample 示例', run: () => $('#btn-sample').click() },
      { id: 'reveal', label: '切换密码显示', icon: 'search', keywords: 'reveal 显示 密码', run: () => $('#btn-reveal').click() },
      { id: 'wpa', label: '加密方式设为 WPA', icon: 'wifi', keywords: 'wpa wpa2 wpa3', run: () => setSecurity('WPA') },
      { id: 'nopass', label: '加密方式设为无密码', icon: 'wifi', keywords: 'nopass open 开放', run: () => setSecurity('nopass') },
      {
        id: 'copy',
        label: '复制二维码内容',
        icon: 'copy',
        keywords: 'copy 复制',
        run: async () => {
          if (!lastText) {
            toast.warn('还没有可复制的内容');
            return;
          }
          const { copy } = await import('../../core/clipboard.js');
          if (await copy(lastText)) toast.ok('已复制');
          else toast.fail('复制失败');
        }
      }
    ]
  });

  render();
}

function setSecurity(id) {
  state.security = id;
  persist();
  $('#security').value = id;
  render();
}

init();
