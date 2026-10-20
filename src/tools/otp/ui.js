/* 动态口令界面层：本地计算 TOTP / HOTP，可导出 otpauth 链接与二维码 */

import { h, mount, clear, $, debounce } from '../../core/dom.js';
import { mountTool } from '../../core/app.js';
import { icon } from '../../core/icons.js';
import { copyButton, downloadText } from '../../core/widgets.js';
import { read, write } from '../../core/storage.js';
import * as toast from '../../core/toast.js';
import * as logic from './logic.js';
import * as qr from '../../core/qrcode.js';
import * as qrRender from '../../core/qr-render.js';

const STORAGE_ID = 'otp';

const els = {};
const state = {
  rememberSecret: read(`${STORAGE_ID}:remember`, false) === true,
  secret: read(`${STORAGE_ID}:secret`, '') || '',
  secretFormat: read(`${STORAGE_ID}:secretFormat`, 'base32') || 'base32',
  type: read(`${STORAGE_ID}:type`, 'totp') || 'totp',
  algorithm: read(`${STORAGE_ID}:algorithm`, 'SHA-1') || 'SHA-1',
  digits: Number(read(`${STORAGE_ID}:digits`, 6)) || 6,
  period: Number(read(`${STORAGE_ID}:period`, 30)) || 30,
  counter: Number(read(`${STORAGE_ID}:counter`, 0)) || 0,
  account: read(`${STORAGE_ID}:account`, '') || '',
  issuer: read(`${STORAGE_ID}:issuer`, '') || ''
};

let timer = null;
let lastRenderedCounter = null;
let verifyToken = 0;

// 未显式开启「记住密钥」时，secret 只存在于当前页面内存。
if (!state.rememberSecret) state.secret = '';

function persist() {
  write(`${STORAGE_ID}:remember`, state.rememberSecret);
  write(`${STORAGE_ID}:secret`, state.rememberSecret ? state.secret : '');
  write(`${STORAGE_ID}:secretFormat`, state.secretFormat);
  write(`${STORAGE_ID}:type`, state.type);
  write(`${STORAGE_ID}:algorithm`, state.algorithm);
  write(`${STORAGE_ID}:digits`, state.digits);
  write(`${STORAGE_ID}:period`, state.period);
  write(`${STORAGE_ID}:counter`, state.counter);
  write(`${STORAGE_ID}:account`, state.account);
  write(`${STORAGE_ID}:issuer`, state.issuer);
}

function optionList(values, selected) {
  return values.map((value) => {
    const id = typeof value === 'object' ? value.id : value;
    const label = typeof value === 'object' ? value.label : String(value);
    return h('option', { value: String(id), selected: String(id) === String(selected) }, label);
  });
}

function errorBox(message) {
  return h('div', { class: 'inline-error' }, icon('close', 13), h('span', { text: message }));
}

/* ── 密钥信息 ─────────────────────────────────────────────── */

function renderSecretInfo() {
  const box = $('#secret-info');
  clear(box);

  if (!state.secret.trim()) {
    box.appendChild(h('div', { class: 'note' }, '填入密钥后即可生成口令'));
    return;
  }

  let info;
  try {
    info = logic.describeSecret(state.secret, state.secretFormat);
  } catch (error) {
    box.appendChild(errorBox(error.message));
    return;
  }

  const strengthClass = info.bytes >= 20 ? 'good' : info.bytes >= 10 ? 'warn' : 'bad';
  mount(box,
    h('div', { class: 'work-row' },
      h('span', { class: 'hint' }, `${info.bytes} 字节 / ${info.bits} 位　`),
      h('span', { class: `strength ${strengthClass}`, text: info.strength })
    ),
    h('table', { class: 'result-table' }, h('tbody', {},
      row('Base32', info.base32),
      row('十六进制', info.hex)
    ))
  );
}

function row(name, value) {
  return h('tr', {},
    h('td', { class: 'col-name', text: name }),
    h('td', { class: 'col-value', text: value || '—' }),
    h('td', { class: 'col-actions' }, value ? copyButton(() => value, { title: `复制${name}` }) : null)
  );
}

/* ── 口令显示 ─────────────────────────────────────────────── */

function renderCodeShell() {
  const card = h('div', { class: 'code-card' },
    h('div', { class: 'code-value', id: 'code-value', text: '······' }),
    h('div', { class: 'code-meta', id: 'code-meta' }),
    h('div', { class: 'countdown' }, h('div', { class: 'countdown-fill', id: 'countdown' }))
  );
  const qrBlock = h('div', { class: 'qr-block', id: 'qr-block' });
  const verifyBlock = h('div', { id: 'verify-block' });

  const container = $('#output');
  mount(container, card, qrBlock, verifyBlock);

  const verifyInput = h('input', {
    type: 'text',
    inputmode: 'numeric',
    autocomplete: 'off',
    'aria-label': '校验口令',
    placeholder: '输入口令以校验'
  });
  const verifyResult = h('div');

  verifyInput.addEventListener('input', debounce(() => {
    runVerify(verifyInput.value);
  }, 250));

  mount(verifyBlock,
    h('div', { class: 'section-label' }, '校验口令（允许前后 1 个周期）'),
    h('div', { class: 'verify-row' }, verifyInput),
    verifyResult
  );

  return { verifyInput, verifyResult, qrBlock };
}

async function runVerify(token) {
  const { verifyResult } = shell;
  clear(verifyResult);
  const value = String(token ?? '').trim();
  if (!value || !state.secret.trim()) return;

  const currentToken = ++verifyToken;
  try {
    const check = await logic.verifyTotp({
      secret: state.secret,
      token: value,
      period: state.period,
      digits: state.digits,
      algorithm: state.algorithm,
      format: state.secretFormat,
      window: 1
    });
    // 只接受最后一次输入的结果，避免快速输入时旧结果覆盖新结果
    if (currentToken !== verifyToken) return;

    if (check.error) {
      verifyResult.appendChild(h('div', { class: 'note' }, check.error));
      return;
    }

    const offsetText = check.offset === 0
      ? '当前周期'
      : check.offset > 0
        ? `超前 ${check.offset} 个周期`
        : `落后 ${Math.abs(check.offset)} 个周期`;

    verifyResult.appendChild(h('div', { class: `verify-badge ${check.ok ? 'ok' : 'bad'}` },
      icon(check.ok ? 'check' : 'close', 13),
      h('span', { text: check.ok ? `口令正确（${offsetText}）` : '口令不匹配' })
    ));
  } catch (error) {
    if (currentToken !== verifyToken) return;
    verifyResult.appendChild(h('div', { class: 'note text-err' }, error.message));
  }
}

/* ── 主渲染 ───────────────────────────────────────────────── */

let shell = null;

async function refreshCode() {
  const codeEl = $('#code-value');
  const metaEl = $('#code-meta');
  const fill = $('#countdown');
  if (!codeEl) return;

  if (!state.secret.trim()) {
    codeEl.textContent = '等待密钥';
    codeEl.classList.add('muted');
    metaEl.textContent = '';
    fill.style.width = '0%';
    lastRenderedCounter = null;
    return;
  }

  try {
    if (state.type === 'totp') {
      const now = Date.now();
      const code = await logic.totp({
        secret: state.secret,
        timestamp: now,
        period: state.period,
        digits: state.digits,
        algorithm: state.algorithm,
        format: state.secretFormat
      });
      codeEl.textContent = code;
      codeEl.classList.remove('muted');

      const remaining = logic.totpRemaining(now, state.period);
      const percent = (remaining / state.period) * 100;
      fill.style.width = `${percent}%`;
      fill.classList.toggle('urgent', remaining <= 5);
      metaEl.textContent = `${state.algorithm} · ${state.digits} 位 · ${remaining.toFixed(0)} 秒后刷新`;

      els.status.className = 'panel-foot';
      els.status.textContent = '口令在本地计算，密钥不会离开这台设备';
      lastRenderedCounter = logic.totpCounter(now, state.period);
      return;
    }

    const code = await logic.hotp({
      secret: state.secret,
      counter: state.counter,
      digits: state.digits,
      algorithm: state.algorithm,
      format: state.secretFormat
    });
    codeEl.textContent = code;
    codeEl.classList.remove('muted');
    fill.style.width = '100%';
    fill.classList.remove('urgent');
    metaEl.textContent = `${state.algorithm} · ${state.digits} 位 · 计数器 ${state.counter}`;
    els.status.className = 'panel-foot';
    els.status.textContent = 'HOTP 每用一次计数器就要加一，请与服务端保持同步';
    lastRenderedCounter = null;
  } catch (error) {
    codeEl.textContent = '密钥无法解析';
    codeEl.classList.add('muted');
    metaEl.textContent = error.message;
    fill.style.width = '0%';
    els.status.className = 'panel-foot text-err';
    els.status.textContent = `✗ ${error.message}`;
  }
}

function currentUri() {
  if (!state.secret.trim()) return '';
  try {
    const secret = logic.convertSecret(state.secret, state.secretFormat, 'base32');
    return logic.buildOtpAuthUri({
      type: state.type,
      account: state.account || 'account',
      issuer: state.issuer,
      secret,
      algorithm: state.algorithm,
      digits: state.digits,
      period: state.period,
      counter: state.counter
    });
  } catch {
    return '';
  }
}

function renderQr(uri) {
  const block = shell.qrBlock;
  clear(block);
  if (!uri) return;

  const result = qr.encode(uri, { ecc: 'M' });
  if (!result.ok) {
    block.appendChild(h('div', { class: 'note' }, `二维码未能生成：${result.error}`));
    return;
  }

  const canvas = qrRender.createQrCanvas(result, { quietZone: 4, targetSize: 180, minScale: 2 });
  if (canvas) block.appendChild(canvas);
}

function renderActions(uri) {
  const box = $('#actions');
  clear(box);

  const add = (label, iconName, handler) => {
    const button = h('button', { class: 'btn btn-sm', type: 'button' }, icon(iconName, 12), h('span', { text: label }));
    button.addEventListener('click', handler);
    box.appendChild(button);
  };

  add('复制口令', 'copy', async () => {
    const { copy } = await import('../../core/clipboard.js');
    const code = $('#code-value').textContent;
    if (!code || code === '等待密钥' || code === '密钥无法解析') {
      toast.warn('还没有可复制的口令');
      return;
    }
    if (await copy(code)) toast.ok('已复制口令');
    else toast.fail('复制失败');
  });

  add('复制链接', 'copy', async () => {
    if (!uri) {
      toast.warn('密钥还不完整，无法生成链接');
      return;
    }
    const { copy } = await import('../../core/clipboard.js');
    if (await copy(uri)) toast.ok('已复制 otpauth 链接');
    else toast.fail('复制失败');
  });

  add('下载二维码', 'download', async () => {
    const canvas = shell.qrBlock.querySelector('canvas');
    if (!canvas) {
      toast.warn('还没有二维码');
      return;
    }
    if (await qrRender.downloadCanvasPng(canvas, 'otpauth.png')) toast.ok('已导出二维码');
    else toast.fail('导出失败');
  });
}

async function refresh() {
  await refreshCode();

  const uri = currentUri();
  renderQr(uri);
  renderActions(uri);
  renderSecretInfo();

  const linkBox = $('#link-box');
  if (linkBox) {
    clear(linkBox);
    if (uri) {
      linkBox.appendChild(h('table', { class: 'result-table' }, h('tbody', {}, row('otpauth 链接', uri))));
    }
  }

  els.foot.textContent = uri
    ? '扫码即可导入到任意验证器 App'
    : '';
}

/* ── 初始化 ───────────────────────────────────────────────── */

function bindSelect(id, key, parse, after) {
  const node = $(id);
  node.value = String(state[key]);
  node.addEventListener('change', () => {
    state[key] = parse ? parse(node.value) : node.value;
    persist();
    if (after) after();
    refresh();
  });
  return node;
}

function init() {
  els.status = $('#status');
  els.foot = $('#foot');

  const secretArea = $('#secret');
  secretArea.value = state.secret;

  const remember = $('#remember-secret');
  remember.checked = state.rememberSecret;
  remember.addEventListener('change', () => {
    state.rememberSecret = remember.checked;
    persist();
    toast.ok(remember.checked ? '已开启：密钥会保存在本机' : '已关闭：本地保存的密钥已清除');
  });
  secretArea.addEventListener('input', debounce(() => {
    state.secret = secretArea.value.trim();
    persist();
    refresh();
  }, 250));

  mount($('#secret-format'), optionList(logic.SECRET_FORMATS, state.secretFormat));
  mount($('#algorithm'), optionList(logic.OTP_ALGORITHMS, state.algorithm));
  mount($('#digits'), optionList(logic.DIGIT_OPTIONS, state.digits));
  mount($('#period'), optionList(logic.PERIOD_OPTIONS, state.period));

  bindSelect('#secret-format', 'secretFormat');
  bindSelect('#algorithm', 'algorithm');
  bindSelect('#digits', 'digits', Number);
  bindSelect('#period', 'period', Number);

  const typeSelect = $('#type');
  typeSelect.value = state.type;
  typeSelect.addEventListener('change', () => {
    state.type = typeSelect.value;
    persist();
    syncTypeVisibility();
    refresh();
  });

  const counterInput = $('#counter');
  counterInput.value = String(state.counter);
  counterInput.addEventListener('input', debounce(() => {
    state.counter = Math.max(0, Math.floor(Number(counterInput.value) || 0));
    persist();
    refresh();
  }, 200));

  const accountInput = $('#account');
  accountInput.value = state.account;
  accountInput.addEventListener('input', debounce(() => {
    state.account = accountInput.value;
    persist();
    refresh();
  }, 250));

  const issuerInput = $('#issuer');
  issuerInput.value = state.issuer;
  issuerInput.addEventListener('input', debounce(() => {
    state.issuer = issuerInput.value;
    persist();
    refresh();
  }, 250));

  $('#btn-parse').addEventListener('click', () => {
    const text = secretArea.value.trim();
    if (!/^otpauth:\/\//i.test(text)) {
      toast.warn('密钥框里没有 otpauth:// 链接');
      return;
    }
    try {
      const parsed = logic.parseOtpAuthUri(text);
      state.secret = parsed.secret;
      state.secretFormat = 'base32';
      state.type = parsed.type;
      state.algorithm = parsed.algorithm;
      state.digits = parsed.digits;
      state.period = parsed.period;
      state.counter = parsed.counter;
      state.account = parsed.account;
      state.issuer = parsed.issuer;
      persist();
      secretArea.value = parsed.secret;
      typeSelect.value = parsed.type;
      $('#secret-format').value = 'base32';
      $('#algorithm').value = parsed.algorithm;
      $('#digits').value = String(parsed.digits);
      $('#period').value = String(parsed.period);
      counterInput.value = String(parsed.counter);
      accountInput.value = parsed.account;
      issuerInput.value = parsed.issuer;
      syncTypeVisibility();
      refresh();
      toast.ok(`已解析：${parsed.issuer || parsed.account || '链接'}`);
    } catch (error) {
      els.status.className = 'panel-foot text-err';
      els.status.textContent = `✗ ${error.message}`;
      toast.fail(error.message);
    }
  });

  $('#btn-clear').addEventListener('click', () => {
    state.secret = '';
    persist();
    secretArea.value = '';
    refresh();
    secretArea.focus();
  });

  shell = renderCodeShell();

  const linkBox = h('div', { id: 'link-box' });
  $('#output').appendChild(h('div', { class: 'section-label' }, '导入链接'));
  $('#output').appendChild(linkBox);

  $('#output').appendChild(h('div', { class: 'privacy-note' },
    '密钥只保存在本机浏览器存储里，口令由 WebCrypto 在本地计算 —— 不会发送到任何服务器。这也是不要用在线网站生成 2FA 口令的原因。'
  ));

  syncTypeVisibility();

  mountTool({
    actions: [
      { id: 'refresh', label: '立即刷新口令', icon: 'refresh', primary: true, keywords: 'refresh 刷新 口令', run: refresh },
      { id: 'parse', label: '解析 otpauth 链接', icon: 'qrcode', keywords: 'parse otpauth 解析 链接', run: () => $('#btn-parse').click() },
      { id: 'clear', label: '清空密钥', icon: 'close', keywords: 'clear 清空', run: () => $('#btn-clear').click() },
      {
        id: 'copy-code',
        label: '复制当前口令',
        icon: 'copy',
        keywords: 'copy 复制 口令',
        run: async () => {
          const { copy } = await import('../../core/clipboard.js');
          const code = $('#code-value').textContent;
          if (!code || code.length < 4) {
            toast.warn('还没有可复制的口令');
            return;
          }
          if (await copy(code)) toast.ok('已复制口令');
          else toast.fail('复制失败');
        }
      },
      {
        id: 'next-counter',
        label: 'HOTP 计数器 +1',
        icon: 'timestamp',
        keywords: 'hotp counter next 计数器',
        run: () => {
          state.counter += 1;
          state.type = 'hotp';
          persist();
          $('#type').value = 'hotp';
          $('#counter').value = String(state.counter);
          syncTypeVisibility();
          refresh();
        }
      }
    ]
  });

  refresh();

  // 每秒更新倒计时；只有跨过周期边界时才重新计算口令
  timer = setInterval(() => {
    if (state.type !== 'totp' || !state.secret.trim()) return;
    const counter = logic.totpCounter(Date.now(), state.period);
    if (counter !== lastRenderedCounter) refreshCode();
    else refreshCountdownOnly();
  }, 1000);

  window.addEventListener('beforeunload', () => {
    if (timer) clearInterval(timer);
  });
}

function refreshCountdownOnly() {
  const fill = $('#countdown');
  const metaEl = $('#code-meta');
  if (!fill || !metaEl) return;
  const remaining = logic.totpRemaining(Date.now(), state.period);
  fill.style.width = `${(remaining / state.period) * 100}%`;
  fill.classList.toggle('urgent', remaining <= 5);
  metaEl.textContent = `${state.algorithm} · ${state.digits} 位 · ${remaining.toFixed(0)} 秒后刷新`;
}

function syncTypeVisibility() {
  const isTotp = state.type === 'totp';
  const periodField = $('#period-field');
  const counterField = $('#counter-field');
  if (periodField) periodField.style.display = isTotp ? '' : 'none';
  if (counterField) counterField.style.display = isTotp ? 'none' : '';
}

init();
