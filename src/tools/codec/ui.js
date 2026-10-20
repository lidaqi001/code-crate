/* 编解码 / 哈希 界面层 */

import { h, mount, clear, $, debounce } from '../../core/dom.js';
import { mountTool } from '../../core/app.js';
import { icon } from '../../core/icons.js';
import { copyButton } from '../../core/widgets.js';
import { read, write } from '../../core/storage.js';
import * as toast from '../../core/toast.js';
import * as logic from './logic.js';

const STORAGE_ID = 'codec';

const ENCODE_OPS = [
  { id: 'b64-encode', label: 'Base64 编码', hint: 'A-Za-z0-9+/=', run: (t) => logic.base64Encode(t) },
  { id: 'b64url-encode', label: 'Base64 URL-safe 编码', hint: '-_ 无填充', run: (t) => logic.toBase64Url(logic.base64Encode(t)) },
  { id: 'url-encode', label: 'URL 编码', hint: '%E4%B8%AD 形式', run: (t) => logic.encodeUrlComponent(t) },
  { id: 'url-encode-all', label: 'URL 编码（完整 URL）', hint: '保留 :/?#', run: (t) => logic.encodeUrl(t) },
  { id: 'html-encode', label: 'HTML 实体编码', hint: '&amp; &lt; 形式', run: (t) => logic.encodeHtmlEntities(t) },
  { id: 'hex-encode', label: '文本 → 十六进制', hint: '41 42 43', run: (t) => logic.textToHex(t) },
  { id: 'bin-encode', label: '文本 → 二进制', hint: '01000001', run: (t) => logic.textToBinary(t) },
  { id: 'unicode-encode', label: 'Unicode 转义编码', hint: '\\u4e2d 形式', run: (t) => logic.unicodeEscape(t) },
  { id: 'ascii-encode', label: 'ASCII 码编码', hint: '72 101 108', run: (t) => logic.textToAsciiCodes(t) },
  { id: 'b32-encode', label: 'Base32 编码', hint: 'A-Z2-7=', run: (t) => logic.base32Encode(t) }
];

const DECODE_OPS = [
  { id: 'b64-decode', label: 'Base64 解码', hint: 'A-Za-z0-9+/=', run: (t) => logic.base64Decode(t) },
  { id: 'b64url-decode', label: 'Base64 URL-safe 解码', hint: '-_ 无填充', run: (t) => logic.base64Decode(logic.fromBase64Url(t)) },
  { id: 'url-decode', label: 'URL 解码', hint: '%E4%B8%AD 形式', run: (t) => logic.decodeUrlComponent(t) },
  { id: 'html-decode', label: 'HTML 实体解码', hint: '&amp; &lt; 形式', run: (t) => logic.decodeHtmlEntities(t) },
  { id: 'hex-decode', label: '十六进制 → 文本', hint: '41 42 43', run: (t) => logic.hexToText(t) },
  { id: 'bin-decode', label: '二进制 → 文本', hint: '01000001', run: (t) => logic.binaryToText(t) },
  { id: 'unicode-decode', label: 'Unicode 转义解码', hint: '\\u4e2d 形式', run: (t) => logic.unicodeUnescape(t) },
  { id: 'ascii-decode', label: 'ASCII 码解码', hint: '72 101 108', run: (t) => logic.asciiCodesToText(t) },
  { id: 'b32-decode', label: 'Base32 解码', hint: 'A-Z2-7=', run: (t) => logic.base32Decode(t) }
];

const ALL_OPS = [...ENCODE_OPS, ...DECODE_OPS];
const findOp = (id) => ALL_OPS.find((op) => op.id === id) || ENCODE_OPS[0];


const HASH_ALGOS = ['MD5', 'CRC32', 'SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'];

const NAMING_STYLES = [
  { id: 'camel', label: 'camelCase', run: logic.toCamelCase },
  { id: 'pascal', label: 'PascalCase', run: logic.toPascalCase },
  { id: 'snake', label: 'snake_case', run: logic.toSnakeCase },
  { id: 'kebab', label: 'kebab-case', run: logic.toKebabCase },
  { id: 'constant', label: 'CONSTANT_CASE', run: logic.toConstantCase }
];

const els = {};
const state = {
  mode: 'transform',
  op: 'b64-encode',
  sources: read(`${STORAGE_ID}:sources`, {}) || {}
};

const sourceOf = (mode) => state.sources[mode] || '';
const setSource = (mode, value) => {
  state.sources[mode] = value;
  write(`${STORAGE_ID}:sources`, state.sources);
};

function row(label, getValue, { mono = true } = {}) {
  const valueNode = h('span', { class: mono ? 'hash-value' : 'naming-value' });
  const control = copyButton(() => getValue(), { title: `复制 ${label}` });
  return { node: h('div', { class: 'hash-row' }, h('span', { class: 'hash-name', text: label }), valueNode, control), valueNode };
}

/* ── 编码转换 ─────────────────────────────────────────────── */

/* 按方向分两组的卡片，而不是下拉：一眼看全、点一下就切。
   hint 写的是「这个算子认／产出什么格式」，方向由分组标题交代，不必每条都写一遍。 */
function methodGroup(title, en, ops, onPick) {
  const grid = h('div', { class: 'method-grid' });
  for (const op of ops) {
    const card = h('button', {
      class: 'method-card',
      type: 'button',
      role: 'radio',
      'aria-checked': String(op.id === state.op),
      dataset: { op: op.id },
      title: `${op.label}（${op.hint}）`
    },
      h('span', { class: 'method-label', text: op.label }),
      h('span', { class: 'method-hint', text: op.hint })
    );
    card.addEventListener('click', () => onPick(op.id));
    grid.appendChild(card);
  }
  return h('div', { class: 'method-group' },
    h('div', { class: 'method-group-head' },
      h('span', { text: title }),
      h('span', { class: 'method-group-en', text: en })
    ),
    grid
  );
}

function renderTransform(container) {
  const source = h('textarea', {
    class: 'mono',
    spellcheck: 'false',
    placeholder: '输入要转换的内容…',
    'aria-label': '输入'
  });
  source.value = sourceOf('transform');

  const output = h('textarea', {
    class: 'mono',
    spellcheck: 'false',
    readonly: true,
    placeholder: '结果会实时出现在这里',
    'aria-label': '输出'
  });

  const status = h('span', { class: 'hint' });
  const swap = h('button', { class: 'btn btn-sm', type: 'button', title: '把结果放回输入框' }, '⇅ 结果转输入');

  const run = () => {
    status.className = 'hint';
    status.textContent = '';
    if (!source.value) {
      output.value = '';
      return;
    }
    try {
      output.value = findOp(state.op).run(source.value);
    } catch (error) {
      output.value = '';
      status.className = 'hint text-err';
      status.textContent = `✗ ${error.message}`;
    }
  };

  const picker = h('aside', { class: 'codec-methods', role: 'radiogroup', 'aria-label': '转换类型' });

  const syncOps = () => {
    for (const card of picker.querySelectorAll('.method-card')) {
      const on = card.dataset.op === state.op;
      card.setAttribute('aria-checked', String(on));
      // 单选组走 roving tabindex：Tab 只进来一次，组内用方向键移动
      card.tabIndex = on ? 0 : -1;
    }
  };

  const selectOp = (id) => {
    state.op = id;
    write(`${STORAGE_ID}:op`, state.op);
    syncOps();
    run();
  };

  picker.appendChild(methodGroup('编码', 'ENCODE', ENCODE_OPS, selectOp));
  picker.appendChild(methodGroup('解码', 'DECODE', DECODE_OPS, selectOp));

  picker.addEventListener('keydown', (event) => {
    const step = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1
      : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1
        : 0;
    if (!step) return;
    event.preventDefault();
    const cards = [...picker.querySelectorAll('.method-card')];
    const index = cards.findIndex((card) => card.dataset.op === state.op);
    const next = cards[(index + step + cards.length) % cards.length];
    selectOp(next.dataset.op);
    next.focus();
  });

  source.addEventListener('input', debounce(() => {
    setSource('transform', source.value);
    run();
  }, 120));

  swap.addEventListener('click', () => {
    if (!output.value) {
      toast.warn('还没有可回填的结果');
      return;
    }
    source.value = output.value;
    setSource('transform', source.value);
    run();
  });

  container.appendChild(h('div', { class: 'codec-split' },
    picker,
    h('div', { class: 'codec-io' },
      h('div', { class: 'field' },
        h('div', { class: 'field-head' },
          h('label', { text: '输入' }),
          h('span', { class: 'grow' }),
          copyButton(() => source.value, { title: '复制输入' })
        ),
        source,
        status
      ),
      h('div', { class: 'field' },
        h('div', { class: 'field-head' },
          h('label', { text: '输出' }),
          h('span', { class: 'grow' }),
          swap,
          copyButton(() => output.value, { title: '复制输出' })
        ),
        output
      )
    )
  ));

  syncOps();
  run();
}

/* ── 哈希 ─────────────────────────────────────────────────── */

function renderHash(container) {
  const source = h('textarea', {
    class: 'mono source-input',
    spellcheck: 'false',
    placeholder: '输入用于计算摘要的文本…',
    'aria-label': '哈希输入'
  });
  source.value = sourceOf('hash');

  const list = h('div', { class: 'hash-list' });
  const entries = HASH_ALGOS.map((algo) => {
    const created = row(algo, () => created.valueNode.textContent);
    created.algo = algo;
    return created;
  });
  for (const entry of entries) list.appendChild(entry.node);

  let token = 0;

  const update = async () => {
    const current = ++token;
    const text = source.value;

    if (!text) {
      for (const entry of entries) {
        entry.valueNode.textContent = '—';
        entry.valueNode.classList.add('pending');
      }
      return;
    }

    for (const entry of entries) {
      if (entry.algo === 'MD5' || entry.algo === 'CRC32') {
        try {
          entry.valueNode.textContent = entry.algo === 'MD5' ? logic.md5(text) : logic.crc32(text);
          entry.valueNode.classList.remove('pending');
        } catch (error) {
          entry.valueNode.textContent = `错误：${error.message}`;
          entry.valueNode.classList.add('pending');
        }
      } else {
        entry.valueNode.textContent = '计算中…';
        entry.valueNode.classList.add('pending');
      }
    }

    for (const entry of entries) {
      if (entry.algo === 'MD5' || entry.algo === 'CRC32') continue;
      try {
        const digest = await logic.sha(entry.algo, text);
        if (current !== token) return;
        entry.valueNode.textContent = digest;
        entry.valueNode.classList.remove('pending');
      } catch (error) {
        if (current !== token) return;
        entry.valueNode.textContent = `错误：${error.message}`;
      }
    }
  };

  source.addEventListener('input', debounce(() => {
    setSource('hash', source.value);
    update();
  }, 150));

  container.appendChild(h('div', { class: 'field' },
    h('div', { class: 'field-head' },
      h('label', { text: '输入' }),
      h('span', { class: 'grow' }),
      copyButton(() => source.value, { title: '复制输入' })
    ),
    source
  ));
  container.appendChild(list);
  update();
}

/* ── JWT ──────────────────────────────────────────────────── */

const REGISTERED_CLAIMS = [
  ['iss', '签发者'],
  ['sub', '主体'],
  ['aud', '受众'],
  ['exp', '过期时间'],
  ['nbf', '生效时间'],
  ['iat', '签发时间'],
  ['jti', '唯一标识']
];

const TIME_CLAIMS = new Set(['exp', 'nbf', 'iat']);

function formatClaimValue(key, value) {
  if (!TIME_CLAIMS.has(key) || typeof value !== 'number') {
    return typeof value === 'string' ? value : JSON.stringify(value);
  }
  const date = new Date(value * 1000);
  return `${value}（${date.toLocaleString('zh-CN')}）`;
}

function renderJwt(container) {
  const source = h('textarea', {
    class: 'mono source-input',
    spellcheck: 'false',
    placeholder: '粘贴 JWT，例如 eyJhbGciOi...',
    'aria-label': 'JWT 令牌'
  });
  source.value = sourceOf('jwt');

  const out = h('div');

  const update = () => {
    clear(out);
    const token = source.value.trim();
    if (!token) {
      out.appendChild(h('div', { class: 'empty' }, '粘贴 JWT 后自动解析'));
      return;
    }

    const result = logic.decodeJwt(token);
    if (!result.ok) {
      out.appendChild(h('div', { class: 'issue error' }, h('div', { class: 'issue-msg', text: result.error })));
      return;
    }

    const badges = h('div', { class: 'jwt-status' },
      h('span', { class: `badge ${result.signed ? 'ok' : 'warn'}` }, result.signed ? '含签名段' : '无签名段'),
      h('span', { class: 'badge info', text: `alg: ${result.header.alg ?? '未声明'}` })
    );

    if (result.expired === true) badges.appendChild(h('span', { class: 'badge err' }, '已过期'));
    else if (result.expired === false) badges.appendChild(h('span', { class: 'badge ok' }, '未过期'));
    else badges.appendChild(h('span', { class: 'badge' }, '无 exp 声明'));

    if (result.expiresAt instanceof Date && !Number.isNaN(result.expiresAt.getTime())) {
      badges.appendChild(h('span', { class: 'hint', text: `过期于 ${result.expiresAt.toLocaleString('zh-CN')}` }));
    }
    out.appendChild(badges);

    const block = (title, value) => h('div', { class: 'jwt-block' },
      h('div', { class: 'jwt-block-head' },
        h('span', { text: title }),
        h('span', { class: 'grow' }),
        copyButton(() => JSON.stringify(value, null, 2), { title: `复制 ${title}` })
      ),
      h('pre', { text: JSON.stringify(value, null, 2) })
    );

    out.appendChild(block('Header', result.header));
    out.appendChild(block('Payload', result.payload));

    const claims = REGISTERED_CLAIMS.filter(([key]) => key in result.payload);
    if (claims.length) {
      const table = h('table', { class: 'claims' });
      for (const [key, label] of claims) {
        table.appendChild(h('tr', {},
          h('th', { text: `${key} · ${label}` }),
          h('td', { text: formatClaimValue(key, result.payload[key]) })
        ));
      }
      out.appendChild(table);
    }
  };

  source.addEventListener('input', debounce(() => {
    setSource('jwt', source.value);
    update();
  }, 150));

  container.appendChild(h('div', { class: 'field' },
    h('div', { class: 'field-head' },
      h('label', { text: 'JWT' }),
      h('span', { class: 'grow' }),
      copyButton(() => source.value, { title: '复制令牌' })
    ),
    source
  ));
  container.appendChild(out);
  update();
}

/* ── 命名风格 ─────────────────────────────────────────────── */

function renderNaming(container) {
  const source = h('textarea', {
    class: 'mono source-input',
    spellcheck: 'false',
    placeholder: '输入任意写法的标识符，例如 user_profile_id',
    'aria-label': '标识符输入'
  });
  source.value = sourceOf('naming');

  const list = h('div', { class: 'hash-list' });
  const entries = NAMING_STYLES.map((style) => {
    const valueNode = h('span', { class: 'naming-value' });
    const node = h('div', { class: 'hash-row' },
      h('span', { class: 'hash-name', text: style.label }),
      valueNode,
      copyButton(() => valueNode.textContent, { title: `复制 ${style.label}` })
    );
    return { style, valueNode, node };
  });
  for (const entry of entries) list.appendChild(entry.node);

  const update = () => {
    const text = source.value.trim();
    for (const entry of entries) {
      entry.valueNode.textContent = text ? entry.style.run(text) : '—';
    }
  };

  source.addEventListener('input', debounce(() => {
    setSource('naming', source.value);
    update();
  }, 120));

  container.appendChild(h('div', { class: 'field' },
    h('div', { class: 'field-head' },
      h('label', { text: '输入' }),
      h('span', { class: 'grow' }),
      copyButton(() => source.value, { title: '复制输入' })
    ),
    source
  ));
  container.appendChild(list);
  update();
}

/* ── 查询串 ───────────────────────────────────────────────── */

function renderQuery(container) {
  const source = h('textarea', {
    class: 'mono source-input',
    spellcheck: 'false',
    placeholder: '粘贴查询串，例如 ?page=2&tag=a&tag=b',
    'aria-label': '查询串输入'
  });
  source.value = sourceOf('query');

  const out = h('div');

  const update = () => {
    clear(out);
    const text = source.value.trim();
    if (!text) {
      out.appendChild(h('div', { class: 'empty' }, '粘贴查询串后自动解析'));
      return;
    }

    let pairs;
    try {
      pairs = logic.parseQueryString(text);
    } catch (error) {
      out.appendChild(h('div', { class: 'issue error' }, h('div', { class: 'issue-msg', text: error.message })));
      return;
    }

    if (!pairs.length) {
      out.appendChild(h('div', { class: 'empty' }, '没有解析到参数'));
      return;
    }

    const payload = {};
    for (const { key, value } of pairs) {
      if (key in payload) payload[key] = [].concat(payload[key], value);
      else payload[key] = value;
    }

    const table = h('table', { class: 'claims' });
    for (const { key, value } of pairs) {
      table.appendChild(h('tr', {},
        h('th', { text: key }),
        h('td', { text: value === '' ? '（空）' : value })
      ));
    }

    out.appendChild(h('div', { class: 'row', style: { marginBottom: '8px' } },
      h('span', { class: 'hint', text: `共 ${pairs.length} 个参数` }),
      h('span', { class: 'grow' }),
      copyButton(() => JSON.stringify(payload, null, 2), { label: '复制为 JSON', title: '复制为 JSON' })
    ));
    out.appendChild(table);
  };

  source.addEventListener('input', debounce(() => {
    setSource('query', source.value);
    update();
  }, 150));

  container.appendChild(h('div', { class: 'field' },
    h('div', { class: 'field-head' },
      h('label', { text: '查询串' }),
      h('span', { class: 'grow' }),
      copyButton(() => source.value, { title: '复制输入' })
    ),
    source
  ));
  container.appendChild(out);
  update();
}

/* ── 主流程 ───────────────────────────────────────────────── */

const RENDERERS = {
  transform: renderTransform,
  hash: renderHash,
  jwt: renderJwt,
  naming: renderNaming,
  query: renderQuery
};

function renderStage() {
  clear(els.stage);
  for (const tab of els.modes.querySelectorAll('[role="tab"]')) {
    tab.setAttribute('aria-selected', String(tab.dataset.mode === state.mode));
  }
  const render = RENDERERS[state.mode] || renderTransform;
  render(els.stage);
  els.status.textContent = STATUS_HINTS[state.mode] || '';
}

const STATUS_HINTS = {
  transform: '点左侧选转换类型，输入即实时转换，出错会在此提示',
  hash: 'MD5 / CRC32 用于校验，SHA 系列基于 WebCrypto 计算',
  jwt: '仅解码查看，不校验签名（校验需要密钥）',
  naming: '自动识别 camelCase / snake_case / kebab-case 等写法',
  query: '重复参数会保留，复制为 JSON 时合并为数组'
};

function init() {
  els.modes = $('#modes');
  els.stage = $('#stage');
  els.status = $('#status');

  state.mode = read(`${STORAGE_ID}:mode`, 'transform');
  state.op = read(`${STORAGE_ID}:op`, 'b64-encode');
  if (!RENDERERS[state.mode]) state.mode = 'transform';
  if (!ALL_OPS.some((op) => op.id === state.op)) state.op = 'b64-encode';

  for (const tab of els.modes.querySelectorAll('[role="tab"]')) {
    tab.addEventListener('click', () => {
      state.mode = tab.dataset.mode;
      write(`${STORAGE_ID}:mode`, state.mode);
      renderStage();
    });
  }

  $('#btn-clear').addEventListener('click', () => {
    setSource(state.mode, '');
    renderStage();
    toast.ok('已清空当前输入');
  });

  mountTool({
    actions: [
      ...Object.entries(RENDERERS).map(([mode, _render], index) => ({
        id: `mode-${mode}`,
        label: `切换到「${({ transform: '编码转换', hash: '哈希校验', jwt: 'JWT 解析', naming: '命名风格', query: '查询串' })[mode]}」`,
        icon: ['codec', 'sliders', 'star', 'text', 'network'][index] || 'play',
        keywords: mode,
        primary: mode === 'transform',
        run: () => {
          state.mode = mode;
          write(`${STORAGE_ID}:mode`, mode);
          renderStage();
        }
      })),
      {
        id: 'clear',
        label: '清空当前输入',
        icon: 'close',
        keywords: 'clear 清空',
        run: () => $('#btn-clear').click()
      }
    ]
  });

  renderStage();
}

init();
