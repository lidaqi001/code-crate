/* 加密与摘要界面层 */

import { h, mount, clear, $, debounce } from '../../core/dom.js';
import { mountTool } from '../../core/app.js';
import { icon } from '../../core/icons.js';
import { copyButton } from '../../core/widgets.js';
import { read, write } from '../../core/storage.js';
import * as toast from '../../core/toast.js';
import * as logic from './logic.js';

const STORAGE_ID = 'crypto';

const els = {};
const state = {
  mode: 'hmac',
  hmac: { algorithm: 'SHA-256', key: '', keyFormat: 'text', message: '', verify: '' },
  aes: {
    direction: 'encrypt',
    key: '',
    keyFormat: 'hex',
    iv: '',
    ivFormat: 'hex',
    aad: '',
    input: '',
    inputFormat: 'text'
  },
  kdf: { password: '', salt: '', iterations: 210000, hash: 'SHA-256', length: 32, randomLength: 32, randomFormat: 'hex' },
  ...(read(`${STORAGE_ID}:state`, null) || {})
};

/* 开关单独存一个键，避免被旧快照里的值覆盖。
   默认不把密钥/明文写进 localStorage；之前存过的旧数据在未开启开关时一并清掉。 */
state.rememberSecrets = read(`${STORAGE_ID}:remember`, false) === true;
if (!state.rememberSecrets) {
  state.hmac.key = '';
  state.hmac.message = '';
  state.hmac.verify = '';
  state.aes.key = '';
  state.aes.iv = '';
  state.aes.aad = '';
  state.aes.input = '';
  state.kdf.password = '';
  state.kdf.salt = '';
}

/** 落盘前按开关裁剪敏感字段；关闭时只保留算法、格式等非敏感设置。 */
function persist() {
  const snapshot = {
    mode: state.mode,
    rememberSecrets: state.rememberSecrets,
    hmac: { ...state.hmac },
    aes: { ...state.aes },
    kdf: { ...state.kdf }
  };
  if (!state.rememberSecrets) {
    Object.assign(snapshot.hmac, { key: '', message: '', verify: '' });
    Object.assign(snapshot.aes, { key: '', iv: '', aad: '', input: '' });
    Object.assign(snapshot.kdf, { password: '', salt: '' });
  }
  write(`${STORAGE_ID}:state`, snapshot);
}

function privacyToggle() {
  const input = h('input', { type: 'checkbox', id: 'remember-secrets', checked: state.rememberSecrets });
  const label = h('label', { class: 'privacy-toggle', for: 'remember-secrets' },
    input,
    h('span', { text: '在本机记住密钥与输入（关闭后刷新即清空，任何内容都不会上传）' })
  );
  input.addEventListener('change', () => {
    state.rememberSecrets = input.checked;
    write(`${STORAGE_ID}:remember`, state.rememberSecrets);
    persist();
    toast.ok(input.checked ? '已开启：密钥与输入会保存在本机' : '已关闭：本地保存的密钥与输入已清除');
  });
  return label;
}

/* ── 通用小部件 ───────────────────────────────────────────── */

function field(labelText, control, { wide = false } = {}) {
  return h('div', { class: `field${wide ? ' wide' : ''}` }, h('label', { text: labelText }), control);
}

function textInput(value, { ariaLabel, placeholder = '', mono = true } = {}) {
  return h('input', {
    type: 'text',
    class: mono ? 'mono' : '',
    value,
    placeholder,
    spellcheck: 'false',
    autocomplete: 'off',
    'aria-label': ariaLabel || placeholder
  });
}

function select(options, value, ariaLabel, onChange) {
  const node = h('select', { 'aria-label': ariaLabel },
    options.map((option) => h('option', { value: String(option.value), selected: String(option.value) === String(value) }, option.label))
  );
  node.value = String(value);
  node.addEventListener('change', () => onChange(node.value));
  return node;
}

function resultRow(name, value, { primary = false } = {}) {
  return h('tr', {},
    h('td', { class: 'col-name', text: name }),
    h('td', { class: `col-value${primary ? ' primary' : ''}`, text: value || '—' }),
    h('td', { class: 'col-actions' }, value ? copyButton(() => value, { title: `复制${name}` }) : null)
  );
}

function errorBox(message) {
  return h('div', { class: 'inline-error' }, icon('close', 13), h('span', { text: message }));
}

/** 异步渲染的竞态保护：只有最后一次调用的结果会被写入。 */
function guard() {
  let token = 0;
  return async (run) => {
    const current = ++token;
    const result = await run();
    return current === token ? result : null;
  };
}

const formatOptions = () => logic.KEY_FORMATS.map((entry) => ({ value: entry.id, label: entry.label }));

/* ── HMAC ─────────────────────────────────────────────────── */

function renderHmac(container) {
  const { hmac } = state;
  const output = h('div');

  const algorithmSelect = select(
    logic.HMAC_ALGORITHMS.map((name) => ({ value: name, label: name })),
    hmac.algorithm,
    'HMAC 算法',
    (value) => {
      hmac.algorithm = value;
      persist();
      update();
    }
  );

  const keyInput = textInput(hmac.key, { ariaLabel: 'HMAC 密钥', placeholder: '密钥' });
  keyInput.id = 'hmac-key';
  const keyFormatSelect = select(formatOptions(), hmac.keyFormat, '密钥格式', (value) => {
    hmac.keyFormat = value;
    persist();
    update();
  });

  const messageArea = h('textarea', { class: 'mono', id: 'hmac-message', spellcheck: 'false', 'aria-label': '待签名内容', placeholder: '要签名的内容' });
  messageArea.value = hmac.message;

  const verifyInput = textInput(hmac.verify, { ariaLabel: '期望签名', placeholder: '粘贴期望的签名以校验' });
  const verifyResult = h('div', { style: { marginTop: '8px' } });

  keyInput.addEventListener('input', debounce(() => {
    hmac.key = keyInput.value;
    persist();
    update();
  }, 200));
  messageArea.addEventListener('input', debounce(() => {
    hmac.message = messageArea.value;
    persist();
    update();
  }, 200));
  verifyInput.addEventListener('input', debounce(() => {
    hmac.verify = verifyInput.value;
    persist();
    verify();
  }, 250));

  const run = guard();
  async function update() {
    clear(output);
    clear(els.status);
    els.status.className = 'panel-foot';

    if (!hmac.key) {
      output.appendChild(h('div', { class: 'note' }, '填写密钥后自动计算签名'));
      return;
    }

    const result = await run(async () => {
      const keyBytes = logic.parseKeyInput(hmac.key, hmac.keyFormat);
      const hex = await logic.hmacHex(hmac.algorithm, keyBytes, logic.textToBytes(hmac.message));
      const base64 = await logic.hmacBase64(hmac.algorithm, keyBytes, logic.textToBytes(hmac.message));
      return { hex, base64, keyLength: keyBytes.length };
    });
    if (!result) return;

    output.appendChild(h('div', { class: 'stat-row' },
      h('div', { class: 'stat-cell' }, h('div', { class: 'k', text: '算法' }), h('div', { class: 'v', text: hmac.algorithm })),
      h('div', { class: 'stat-cell' }, h('div', { class: 'k', text: '密钥长度' }), h('div', { class: 'v', text: `${result.keyLength} 字节` })),
      h('div', { class: 'stat-cell' }, h('div', { class: 'k', text: '签名长度' }), h('div', { class: 'v', text: `${result.hex.length / 2} 字节` }))
    ));

    const table = h('table', { class: 'result-table' }, h('tbody'));
    const body = table.querySelector('tbody');
    body.appendChild(resultRow('十六进制', result.hex, { primary: true }));
    body.appendChild(resultRow('Base64', result.base64));
    output.appendChild(table);

    verify();
  }

  async function verify() {
    clear(verifyResult);
    const expected = verifyInput.value.trim();
    if (!expected) return;
    if (!hmac.key) return;

    try {
      const keyBytes = logic.parseKeyInput(hmac.key, hmac.keyFormat);
      const check = await logic.verifyHmac(hmac.algorithm, keyBytes, logic.textToBytes(hmac.message), expected);
      if (check.error) {
        verifyResult.appendChild(h('div', { class: 'note' }, check.error));
        return;
      }
      verifyResult.appendChild(h('div', { class: `verify-badge ${check.ok ? 'ok' : 'bad'}` },
        icon(check.ok ? 'check' : 'close', 13),
        h('span', { text: check.ok ? '签名匹配' : '签名不匹配' })
      ));
    } catch (error) {
      verifyResult.appendChild(h('div', { class: 'note text-err' }, error.message));
    }
  }

  container.appendChild(h('div', { class: 'work-row' },
    field('算法', algorithmSelect),
    field('密钥', keyInput, { wide: true }),
    field('密钥格式', keyFormatSelect)
  ));
  container.appendChild(h('div', { class: 'work-row' },
    field('待签名内容', messageArea, { wide: true })
  ));

  container.appendChild(h('div', { class: 'section-label' }, '签名结果'));
  container.appendChild(output);

  container.appendChild(h('div', { class: 'section-label' }, '校验签名'));
  container.appendChild(verifyInput);
  container.appendChild(verifyResult);
  container.appendChild(h('div', { class: 'note' }, '校验使用常量时间比较，不会因提前返回而泄露信息'));

  update();
}

/* ── AES-GCM ──────────────────────────────────────────────── */

function renderAes(container) {
  const { aes } = state;
  const output = h('div');

  const directionSelect = select(
    [{ value: 'encrypt', label: '加密' }, { value: 'decrypt', label: '解密' }],
    aes.direction,
    '方向',
    (value) => {
      aes.direction = value;
      persist();
      renderStage();
    }
  );

  const keyInput = textInput(aes.key, { ariaLabel: 'AES 密钥', placeholder: '密钥（16 / 24 / 32 字节）' });
  const keyFormatSelect = select(formatOptions(), aes.keyFormat, '密钥格式', (value) => {
    aes.keyFormat = value;
    persist();
    update();
  });
  const generateKeyButton = h('button', { class: 'btn btn-sm', type: 'button' }, '生成 256 位密钥');
  generateKeyButton.addEventListener('click', () => {
    aes.key = logic.bytesToHex(logic.generateAesKey(32));
    aes.keyFormat = 'hex';
    persist();
    renderStage();
  });

  const ivInput = textInput(aes.iv, { ariaLabel: 'IV', placeholder: 'IV（推荐 12 字节）' });
  const ivFormatSelect = select(formatOptions(), aes.ivFormat, 'IV 格式', (value) => {
    aes.ivFormat = value;
    persist();
    update();
  });
  const generateIvButton = h('button', { class: 'btn btn-sm', type: 'button' }, '生成 12 字节 IV');
  generateIvButton.addEventListener('click', () => {
    aes.iv = logic.bytesToHex(logic.generateIv());
    aes.ivFormat = 'hex';
    persist();
    renderStage();
  });

  const aadInput = textInput(aes.aad, { ariaLabel: '附加数据', placeholder: '附加数据（可选）' });

  const inputArea = h('textarea', {
    class: 'mono',
    spellcheck: 'false',
    'aria-label': aes.direction === 'encrypt' ? '明文' : '密文',
    placeholder: aes.direction === 'encrypt' ? '要加密的明文' : '十六进制或 Base64 密文（含认证标签）'
  });
  inputArea.value = aes.input;

  const inputFormatSelect = select(
    aes.direction === 'encrypt' ? [{ value: 'text', label: '文本' }] : logic.OUTPUT_FORMATS.map((entry) => ({ value: entry.id, label: entry.label })),
    aes.direction === 'encrypt' ? 'text' : aes.inputFormat,
    '输入格式',
    (value) => {
      aes.inputFormat = value;
      persist();
      update();
    }
  );

  keyInput.addEventListener('input', debounce(() => {
    aes.key = keyInput.value;
    persist();
    update();
  }, 200));
  ivInput.addEventListener('input', debounce(() => {
    aes.iv = ivInput.value;
    persist();
    update();
  }, 200));
  aadInput.addEventListener('input', debounce(() => {
    aes.aad = aadInput.value;
    persist();
    update();
  }, 200));
  inputArea.addEventListener('input', debounce(() => {
    aes.input = inputArea.value;
    persist();
    update();
  }, 220));

  const run = guard();

  async function update() {
    clear(output);
    clear(els.status);
    els.status.className = 'panel-foot';

    if (!aes.key || !aes.iv || !aes.input) {
      output.appendChild(h('div', { class: 'note' }, '填齐密钥、IV 与内容后自动计算'));
      return;
    }

    const result = await run(async () => {
      const keyBytes = logic.parseKeyInput(aes.key, aes.keyFormat);
      const ivBytes = logic.parseKeyInput(aes.iv, aes.ivFormat);
      const aadBytes = aes.aad ? logic.textToBytes(aes.aad) : null;
      logic.validateAesKey(keyBytes);
      logic.validateIv(ivBytes);

      if (aes.direction === 'encrypt') {
        const combined = await logic.aesGcmEncrypt({
          plaintext: logic.textToBytes(aes.input),
          keyBytes,
          ivBytes,
          additionalData: aadBytes
        });
        return { kind: 'encrypted', combined };
      }

      const combined = aes.inputFormat === 'base64' ? logic.base64ToBytes(aes.input) : logic.hexToBytes(aes.input);
      const plaintext = await logic.aesGcmDecrypt({ ciphertext: combined, keyBytes, ivBytes, additionalData: aadBytes });
      return { kind: 'decrypted', plaintext, combined };
    });

    if (!result) return;

    if (result.kind === 'encrypted') {
      const info = logic.describeCiphertext(result.combined);
      els.status.textContent = `已加密：密文 ${info.ciphertextLength} 字节 + 认证标签 ${info.tagLength} 字节`;

      output.appendChild(h('div', { class: 'stat-row' },
        h('div', { class: 'stat-cell' }, h('div', { class: 'k', text: '总长度' }), h('div', { class: 'v', text: `${info.total} 字节` })),
        h('div', { class: 'stat-cell' }, h('div', { class: 'k', text: '密文' }), h('div', { class: 'v', text: `${info.ciphertextLength} 字节` })),
        h('div', { class: 'stat-cell' }, h('div', { class: 'k', text: '认证标签' }), h('div', { class: 'v', text: `${info.tagLength} 字节` }))
      ));

      const table = h('table', { class: 'result-table' }, h('tbody'));
      const body = table.querySelector('tbody');
      body.appendChild(resultRow('完整密文（hex）', logic.bytesToHex(result.combined), { primary: true }));
      body.appendChild(resultRow('完整密文（Base64）', logic.bytesToBase64(result.combined)));
      body.appendChild(resultRow('密文部分（hex）', info.ciphertextHex));
      body.appendChild(resultRow('认证标签（hex）', info.tagHex));
      body.appendChild(resultRow('认证标签（Base64）', info.tagBase64));
      output.appendChild(table);
      output.appendChild(h('div', { class: 'note' },
        'WebCrypto 把 16 字节认证标签拼在密文末尾；若对端要求分开存放（如 Java / Go），请复制「密文部分」与「认证标签」两行。'
      ));
      return;
    }

    const text = logic.bytesToText(result.plaintext);
    els.status.textContent = '解密成功，认证标签校验通过';
    output.appendChild(h('div', { class: 'stat-row' },
      h('div', { class: 'stat-cell' }, h('div', { class: 'k', text: '明文长度' }), h('div', { class: 'v', text: `${result.plaintext.length} 字节` }))
    ));

    const table = h('table', { class: 'result-table' }, h('tbody'));
    const body = table.querySelector('tbody');
    body.appendChild(resultRow('明文', text, { primary: true }));
    body.appendChild(resultRow('明文（hex）', logic.bytesToHex(result.plaintext)));
    output.appendChild(table);
  }

  container.appendChild(h('div', { class: 'work-row' },
    field('方向', directionSelect),
    field('AES 密钥', keyInput, { wide: true }),
    field('密钥格式', keyFormatSelect),
    generateKeyButton
  ));

  container.appendChild(h('div', { class: 'work-row' },
    field('IV', ivInput, { wide: true }),
    field('IV 格式', ivFormatSelect),
    generateIvButton
  ));

  container.appendChild(h('div', { class: 'work-row' },
    field('附加数据（AAD）', aadInput, { wide: true })
  ));

  container.appendChild(h('div', { class: 'work-row' },
    field(aes.direction === 'encrypt' ? '明文' : '密文', inputArea, { wide: true }),
    field('输入格式', inputFormatSelect)
  ));

  output.appendChild(h('div', { class: 'note' }, '填写后自动计算'));
  container.appendChild(h('div', { class: 'section-label' }, '结果'));
  container.appendChild(output);

  update();
}

/* ── PBKDF2 与随机 ────────────────────────────────────────── */

function renderKdf(container) {
  const { kdf } = state;

  const passwordInput = textInput(kdf.password, { ariaLabel: '口令', placeholder: '口令' });
  const saltInput = textInput(kdf.salt, { ariaLabel: '盐', placeholder: '盐（建议 16 字节随机值）' });
  const generateSaltButton = h('button', { class: 'btn btn-sm', type: 'button' }, '生成随机盐');
  const iterationsSelect = select(
    logic.PBKDF2_ITERATIONS.map((entry) => ({ value: entry.value, label: entry.label })),
    kdf.iterations,
    '迭代次数',
    (value) => {
      kdf.iterations = Number(value);
      persist();
      update();
    }
  );
  const hashSelect = select(
    logic.SHA_ALGORITHMS.map((name) => ({ value: name, label: name })),
    kdf.hash,
    '哈希算法',
    (value) => {
      kdf.hash = value;
      persist();
      update();
    }
  );
  const lengthSelect = select(
    [16, 24, 32, 48, 64].map((value) => ({ value, label: `${value} 字节` })),
    kdf.length,
    '派生长度',
    (value) => {
      kdf.length = Number(value);
      persist();
      update();
    }
  );

  generateSaltButton.addEventListener('click', () => {
    kdf.salt = logic.bytesToHex(logic.generateIv(16));
    persist();
    renderStage();
  });

  passwordInput.addEventListener('input', debounce(() => {
    kdf.password = passwordInput.value;
    persist();
    update();
  }, 220));
  saltInput.addEventListener('input', debounce(() => {
    kdf.salt = saltInput.value;
    persist();
    update();
  }, 220));

  const kdfOutput = h('div');

  const randomLengthInput = h('input', { type: 'number', min: '1', max: '256', value: String(kdf.randomLength), 'aria-label': '随机字节数' });
  const randomFormatSelect = select(logic.OUTPUT_FORMATS, kdf.randomFormat, '随机输出格式', (value) => {
    kdf.randomFormat = value;
    persist();
    renderStage();
  });
  const randomOutput = h('div');
  const generateRandom = () => {
    const bytes = logic.generateIv(Math.min(256, Math.max(1, Number(randomLengthInput.value) || 32)));
    mount(randomOutput, h('table', { class: 'result-table' }, h('tbody', {},
      resultRow('十六进制', logic.bytesToHex(bytes), { primary: kdf.randomFormat === 'hex' }),
      resultRow('Base64', logic.bytesToBase64(bytes), { primary: kdf.randomFormat === 'base64' })
    )));
  };
  const randomButton = h('button', { class: 'btn btn-sm btn-primary', type: 'button' }, '生成随机字节');

  randomLengthInput.addEventListener('input', () => {
    kdf.randomLength = Number(randomLengthInput.value) || 32;
    persist();
  });
  randomButton.addEventListener('click', generateRandom);

  const run = guard();

  async function update() {
    clear(kdfOutput);
    clear(els.status);
    els.status.className = 'panel-foot';

    if (!kdf.password || !kdf.salt) {
      kdfOutput.appendChild(h('div', { class: 'note' }, '填写口令与盐后自动派生密钥'));
      return;
    }

    try {
      const derived = await run(() => logic.pbkdf2({
        password: kdf.password,
        salt: logic.textToBytes(kdf.salt),
        iterations: kdf.iterations,
        hash: kdf.hash,
        length: kdf.length
      }));
      if (!derived) return;

      els.status.textContent = `已派生 ${derived.length} 字节密钥（迭代 ${kdf.iterations.toLocaleString('en-US')} 次）`;
      mount(kdfOutput, h('table', { class: 'result-table' }, h('tbody', {},
        resultRow('派生密钥（hex）', logic.bytesToHex(derived), { primary: true }),
        resultRow('派生密钥（Base64）', logic.bytesToBase64(derived))
      )));
    } catch (error) {
      els.status.className = 'panel-foot text-err';
      els.status.textContent = `✗ ${error.message}`;
      kdfOutput.appendChild(errorBox(error.message));
    }
  }

  container.appendChild(h('div', { class: 'section-label' }, 'PBKDF2 口令派生'));
  container.appendChild(h('div', { class: 'work-row' },
    field('口令', passwordInput, { wide: true }),
    field('盐', saltInput, { wide: true }),
    generateSaltButton
  ));
  container.appendChild(h('div', { class: 'work-row' },
    field('迭代次数', iterationsSelect),
    field('哈希', hashSelect),
    field('派生长度', lengthSelect)
  ));
  container.appendChild(kdfOutput);
  container.appendChild(h('div', { class: 'note' }, '迭代次数越高越难暴力破解，但计算也越慢；口令本身不会被发送到任何地方'));

  container.appendChild(h('div', { class: 'section-label' }, '随机字节'));
  container.appendChild(h('div', { class: 'work-row' },
    field('字节数', randomLengthInput),
    field('默认展示', randomFormatSelect),
    randomButton
  ));
  container.appendChild(randomOutput);

  update();
  generateRandom();
}

/* ── 渲染与初始化 ─────────────────────────────────────────── */

const RENDERERS = { hmac: renderHmac, aes: renderAes, kdf: renderKdf };

const HINTS = {
  hmac: '签名用 WebCrypto 计算，与 OpenSSL / node:crypto 结果一致',
  aes: 'AES-GCM 是认证加密：密文被改动会直接解密失败',
  kdf: 'PBKDF2 与随机数都基于 WebCrypto'
};

function renderStage() {
  for (const tab of els.modes.querySelectorAll('[role="tab"]')) {
    tab.setAttribute('aria-selected', String(tab.dataset.mode === state.mode));
  }
  clear(els.stage);
  els.stage.appendChild(privacyToggle());
  (RENDERERS[state.mode] || renderHmac)(els.stage);
  els.hint.textContent = HINTS[state.mode] || '';
}

function init() {
  els.modes = $('#modes');
  els.stage = $('#stage');
  els.status = $('#status');
  els.hint = $('#hint');

  if (!RENDERERS[state.mode]) state.mode = 'hmac';

  for (const tab of els.modes.querySelectorAll('[role="tab"]')) {
    tab.addEventListener('click', () => {
      state.mode = tab.dataset.mode;
      persist();
      renderStage();
    });
  }

  mountTool({
    actions: [
      { id: 'mode-hmac', label: 'HMAC 签名', icon: 'codec', primary: true, keywords: 'hmac sign 签名', run: () => switchMode('hmac') },
      { id: 'mode-aes', label: 'AES-GCM 加解密', icon: 'chmod', keywords: 'aes gcm encrypt decrypt 加密 解密', run: () => switchMode('aes') },
      { id: 'mode-kdf', label: 'PBKDF2 与随机数', icon: 'uuid', keywords: 'pbkdf2 kdf random 派生 随机', run: () => switchMode('kdf') },
      {
        id: 'copy-hmac',
        label: '复制当前 HMAC 签名',
        icon: 'copy',
        keywords: 'copy 复制 hmac',
        run: async () => {
          if (!state.hmac.key) {
            toast.warn('还没有填写密钥');
            return;
          }
          const { copy } = await import('../../core/clipboard.js');
          const hex = await logic.hmacHex(state.hmac.algorithm, logic.parseKeyInput(state.hmac.key, state.hmac.keyFormat), logic.textToBytes(state.hmac.message));
          if (await copy(hex)) toast.ok('已复制签名');
          else toast.fail('复制失败');
        }
      }
    ]
  });

  renderStage();
}

function switchMode(mode) {
  state.mode = mode;
  persist();
  renderStage();
}

init();
