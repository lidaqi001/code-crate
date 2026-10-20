/* HTTP / cURL 界面层。
   网络访问采用「按域名申请」模式：默认零权限，只有用户点发送时才申请目标域名。 */

import { h, mount, clear, $, debounce, formatBytes } from '../../core/dom.js';
import { mountTool } from '../../core/app.js';
import { icon } from '../../core/icons.js';
import { copyButton } from '../../core/widgets.js';
import { copy } from '../../core/clipboard.js';
import { read, write } from '../../core/storage.js';
import * as toast from '../../core/toast.js';
import * as logic from './logic.js';

const STORAGE_ID = 'http';
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

const SAMPLE = {
  method: 'GET',
  url: 'https://httpbin.org/json',
  headers: 'Accept: application/json',
  body: ''
};

const els = {};
const state = {
  sub: 'headers',
  mode: 'response',
  response: null,
  history: loadHistory()
};

const permsAvailable = () => typeof chrome !== 'undefined' && chrome.permissions && chrome.runtime;

/* 进行中的请求：用来支持手动中止，并防止重复点击叠出多个请求。 */
let inFlight = null;
let manualAbort = false;

/* ── 请求配置区 ───────────────────────────────────────────── */

function loadHistory() {
  const stored = read(`${STORAGE_ID}:history`, []);
  if (!Array.isArray(stored)) return [];
  return stored
    .filter((entry) => entry && typeof entry === 'object' && typeof entry.url === 'string')
    .slice(0, 8);
}

/** 只记录方法、地址、状态码与耗时；请求头/体可能含令牌，不落盘。 */
function pushHistory(entry) {
  const record = {
    method: entry.method,
    url: entry.url,
    status: entry.status,
    elapsed: entry.elapsed,
    at: Date.now()
  };
  state.history = [
    record,
    ...state.history.filter((item) => !(item.method === record.method && item.url === record.url))
  ].slice(0, 8);
  write(`${STORAGE_ID}:history`, state.history);
}

function persistRequest() {
  write(`${STORAGE_ID}:method`, els.method.value);
  write(`${STORAGE_ID}:url`, els.url.value);
  write(`${STORAGE_ID}:headers`, els.headers.value);
  write(`${STORAGE_ID}:body`, els.body.value);
}

function renderSubPanel() {
  for (const tab of els.subTabs.querySelectorAll('[role="tab"]')) {
    tab.setAttribute('aria-selected', String(tab.dataset.sub === state.sub));
  }

  const panel = $('#sub-panel');
  clear(panel);

  if (state.sub === 'headers') {
    els.headers.placeholder = '每行一个，例如\nContent-Type: application/json\nAuthorization: Bearer <token>';
    els.headers.setAttribute('aria-label', '请求头');
    panel.appendChild(h('div', { class: 'field' }, els.headers));
    return;
  }

  if (state.sub === 'body') {
    els.body.placeholder = '请求体（JSON / 表单原文）';
    els.body.setAttribute('aria-label', '请求体');
    panel.appendChild(h('div', { class: 'field' }, els.body));
    return;
  }

  const curl = h('textarea', {
    class: 'mono',
    spellcheck: 'false',
    'aria-label': 'cURL 命令',
    placeholder: '把浏览器「Copy as cURL」的内容粘进来，然后点「解析」'
  });
  curl.value = read(`${STORAGE_ID}:curl`, '') || '';

  const parse = () => {
    write(`${STORAGE_ID}:curl`, curl.value);
    const result = logic.parseCurl(curl.value);
    if (!result.ok) {
      toast.fail(result.error);
      els.status.className = 'panel-foot text-err';
      els.status.textContent = `✗ ${result.error}`;
      return;
    }
    els.method.value = result.request.method;
    els.url.value = result.request.url;
    els.headers.value = logic.headersToText(result.request.headers);
    els.body.value = result.request.body ?? '';
    persistRequest();
    state.sub = 'headers';
    renderSubPanel();
    els.status.className = 'panel-foot';
    els.status.textContent = `已解析：${result.request.method} ${result.request.url}`;
    if (result.request.ignoredFlags.length) {
      toast.warn(`已忽略 ${result.request.ignoredFlags.length} 个无关参数`);
    } else {
      toast.ok('解析完成');
    }
  };

  panel.appendChild(h('div', { class: 'field' },
    h('div', { class: 'field-head' },
      h('label', { text: 'cURL 命令' }),
      h('span', { class: 'grow' }),
      copyButton(() => curl.value, { title: '复制命令' })
    ),
    curl
  ));
  panel.appendChild(h('div', { class: 'row', style: { marginTop: '10px' } },
    h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: parse }, '解析并填入'),
    h('button', {
      class: 'btn btn-sm',
      type: 'button',
      onclick: () => {
        curl.value = `curl -X POST 'https://api.example.com/users' \\\n  -H 'Content-Type: application/json' \\\n  -d '{"name":"Ada"}'`;
        write(`${STORAGE_ID}:curl`, curl.value);
      }
    }, '填入示例'),
    h('span', { class: 'grow' })
  ));
}

/* ── 权限管理 ─────────────────────────────────────────────── */

async function renderPermissions() {
  const summary = $('#perm-summary');
  const foot = $('#perm-foot');
  clear(foot);

  if (!permsAvailable()) {
    summary.textContent = '当前环境不支持权限 API';
    return;
  }

  let origins = [];
  try {
    const all = await chrome.permissions.getAll();
    origins = all.origins || [];
  } catch {
    summary.textContent = '';
    return;
  }

  summary.textContent = origins.length ? `已授权 ${origins.length} 个域名` : '尚未授权任何域名';

  if (!origins.length) {
    foot.appendChild(h('span', { class: 'hint' }, '首次发送请求时会按域名申请权限，你可以随时在这里撤销'));
    return;
  }

  for (const origin of origins) {
    foot.appendChild(h('div', { class: 'perm-row' },
      h('span', { class: 'grow', text: origin }),
      h('button', {
        class: 'btn btn-sm btn-danger',
        type: 'button',
        onclick: async () => {
          try {
            await chrome.permissions.remove({ origins: [origin] });
            toast.ok(`已撤销 ${origin}`);
            renderPermissions();
          } catch (error) {
            toast.fail(error.message);
          }
        }
      }, '撤销')
    ));
  }
}

/* ── 发送请求 ─────────────────────────────────────────────── */

async function send() {
  if (inFlight) {
    toast.warn('已有请求正在进行，请先中止');
    return;
  }

  const url = els.url.value.trim();
  if (!url) {
    toast.warn('请输入请求地址');
    els.url.focus();
    return;
  }

  const pattern = logic.originPattern(url);
  if (!pattern) {
    toast.fail('只支持 http / https 地址');
    return;
  }

  // 权限申请必须发生在用户点击的直接手势里，因此这一步之前不做其他 await
  if (permsAvailable()) {
    try {
      const granted = await chrome.permissions.request({ origins: [pattern] });
      if (!granted) {
        els.status.className = 'panel-foot text-err';
        els.status.textContent = `✗ 未授予 ${pattern} 的访问权限，请求已取消`;
        return;
      }
      renderPermissions();
    } catch (error) {
      toast.fail(`申请权限失败：${error.message}`);
      return;
    }
  }

  const { headers, errors } = logic.parseHeaderLines(els.headers.value);
  if (errors.length) toast.warn(`忽略了 ${errors.length} 行无法解析的请求头`);

  const method = els.method.value;
  const bodyText = els.body.value;
  const options = { method, headers: {} };
  for (const header of headers) options.headers[header.name] = header.value;

  if (!['GET', 'HEAD'].includes(method) && bodyText.trim()) {
    options.body = bodyText;
    const hasContentType = Object.keys(options.headers).some((name) => name.toLowerCase() === 'content-type');
    if (!hasContentType) {
      try {
        JSON.parse(bodyText);
        options.headers['Content-Type'] = 'application/json';
      } catch {
        /* 不是 JSON 就不自动补 */
      }
    }
  }

  const timeoutSeconds = Math.min(120, Math.max(1, Number(els.timeout.value) || 15));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
  options.signal = controller.signal;

  inFlight = controller;
  manualAbort = false;
  els.send.disabled = true;
  els.abort.hidden = false;
  els.status.className = 'panel-foot';
  els.status.textContent = `请求中…（最长 ${timeoutSeconds} 秒）`;

  const started = performance.now();
  try {
    const response = await fetch(url, options);
    const elapsed = Math.round(performance.now() - started);
    const text = await response.text();
    const responseHeaders = [];
    response.headers.forEach((value, name) => responseHeaders.push({ name, value }));

    state.response = { requestUrl: url, method, status: response.status, statusText: response.statusText, elapsed, text, headers: responseHeaders };
    pushHistory({ method, url, status: response.status, elapsed });
    state.mode = 'response';
    renderOutput();
    els.status.className = 'panel-foot';
    els.status.textContent = `${method} ${url} → ${response.status} ${response.statusText} · ${elapsed}ms`;
  } catch (error) {
    state.response = null;
    renderOutput();
    const reason = error.name === 'AbortError'
      ? (manualAbort ? '已手动中止' : `请求超过 ${timeoutSeconds} 秒已中止`)
      : error.message;
    els.status.className = 'panel-foot text-err';
    els.status.textContent = `✗ ${reason}`;
    toast.fail(reason);
  } finally {
    clearTimeout(timer);
    inFlight = null;
    manualAbort = false;
    els.send.disabled = false;
    els.abort.hidden = true;
  }
}

/* ── 结果视图 ─────────────────────────────────────────────── */

function renderResponse(container) {
  if (!state.response) {
    container.appendChild(h('div', { class: 'empty' }, '填写地址后点「发送」，响应会显示在这里'));
    return;
  }

  const response = state.response;
  const kind = logic.statusClass(response.status);
  const known = logic.lookupStatus(response.status);

  container.appendChild(h('div', { class: 'response-head' },
    h('span', { class: `status-pill ${kind}` }, `${response.status} ${response.statusText}`.trim()),
    h('div', { class: 'response-metrics' },
      h('span', {}, '耗时 ', h('b', { text: `${response.elapsed} ms` })),
      h('span', {}, '大小 ', h('b', { text: formatBytes(new Blob([response.text]).size) })),
      h('span', {}, '长度 ', h('b', { text: `${[...response.text].length} 字符` }))
    ),
    h('span', { class: 'grow', style: { flex: '1 1 auto' } }),
    copyButton(() => response.text, { label: '复制响应', title: '复制响应体' })
  ));

  if (known) {
    container.appendChild(h('div', { class: 'hint' }, `${known.name} · ${known.note}`));
  }

  const pretty = logic.prettyBody(response.text, response.headers.find((header) => header.name.toLowerCase() === 'content-type')?.value || '');

  container.appendChild(h('div', { class: 'block-title' }, `响应头（${response.headers.length}）`));
  if (!response.headers.length) {
    container.appendChild(h('div', { class: 'hint' }, '没有可读取的响应头'));
  } else {
    for (const header of response.headers) {
      container.appendChild(h('div', { class: 'header-row' },
        h('span', { class: 'k', text: header.name }),
        h('span', { class: 'v', text: header.value })
      ));
    }
  }

  container.appendChild(h('div', { class: 'block-title' }, pretty.wasJson ? '响应体 · JSON' : '响应体'));
  container.appendChild(h('pre', { class: 'body-view', text: pretty.formatted || '（空响应体）' }));
}

function renderStatusReference(container) {
  const search = h('input', { type: 'text', class: 'ref-search', placeholder: '搜索状态码或含义，例如 429 / not found', 'aria-label': '搜索状态码' });
  const list = h('div');
  const rows = h('div');

  const paint = (query) => {
    clear(rows);
    const needle = query.trim().toLowerCase();
    const matched = logic.STATUS_CODES.filter((entry) =>
      !needle || String(entry.code).includes(needle) || entry.name.toLowerCase().includes(needle) || entry.note.includes(needle)
    );
    if (!matched.length) {
      rows.appendChild(h('div', { class: 'empty' }, '没有匹配的状态码'));
      return;
    }
    for (const entry of matched) {
      rows.appendChild(h('div', { class: 'ref-row' },
        h('span', { class: 'ref-code', text: String(entry.code) }),
        h('span', { class: 'ref-name', text: entry.name }),
        h('span', { class: 'ref-note', text: entry.note })
      ));
    }
  };

  search.addEventListener('input', debounce(() => paint(search.value), 120));
  list.appendChild(search);
  list.appendChild(rows);
  container.appendChild(list);
  paint('');
}

function renderMimeReference(container) {
  const rows = h('div');
  for (const entry of logic.MIME_TYPES) {
    rows.appendChild(h('div', { class: 'ref-row' },
      h('span', { class: 'ref-name', text: entry.type }),
      h('span', { class: 'ref-code', text: entry.ext || '—' }),
      h('span', { class: 'ref-note', text: entry.note }),
      copyButton(() => entry.type, { title: '复制 MIME 类型' })
    ));
  }
  container.appendChild(rows);
}

function renderTools(container) {
  // Basic Auth
  const authUser = h('input', { type: 'text', class: 'mono', placeholder: 'username', 'aria-label': '用户名' });
  const authPass = h('input', { type: 'text', class: 'mono', placeholder: 'password', 'aria-label': '密码' });
  const authOut = h('input', { type: 'text', class: 'mono', readonly: true, 'aria-label': 'Basic 头' });
  const authRefresh = () => {
    const value = authUser.value || authPass.value ? logic.basicAuthEncode(`${authUser.value}:${authPass.value}`) : '';
    authOut.value = value ? `Basic ${value}` : '';
  };
  authUser.addEventListener('input', authRefresh);
  authPass.addEventListener('input', authRefresh);

  const decodeInput = h('input', { type: 'text', class: 'mono', placeholder: '粘贴 Basic 头或 Base64 以解析', 'aria-label': '待解析的 Basic 头' });
  const decodeOut = h('div', { class: 'hint' });
  decodeInput.addEventListener('input', debounce(() => {
    const value = decodeInput.value.trim();
    clear(decodeOut);
    if (!value) return;
    const result = logic.parseBasicAuthHeader(value.startsWith('Basic') ? value : `Basic ${value}`);
    if (!result.ok) {
      decodeOut.className = 'hint text-err';
      decodeOut.textContent = result.error;
      return;
    }
    decodeOut.className = 'hint';
    decodeOut.textContent = `用户名：${result.user}　密码：${result.password || '（空）'}`;
  }, 200));

  container.appendChild(h('div', { class: 'tool-section' },
    h('span', { class: 'label' }, 'Basic 鉴权编解码'),
    h('div', { class: 'opt-grid' },
      h('div', { class: 'field' }, h('label', { text: '用户名' }), authUser),
      h('div', { class: 'field' }, h('label', { text: '密码' }), authPass)
    ),
    h('div', { class: 'field', style: { marginTop: '8px' } },
      h('div', { class: 'field-head' },
        h('label', { text: 'Authorization 头' }),
        h('span', { class: 'grow' }),
        copyButton(() => authOut.value, { title: '复制' })
      ),
      authOut
    ),
    h('div', { class: 'field', style: { marginTop: '10px' } },
      h('label', { text: '反向解析' }),
      decodeInput,
      decodeOut
    )
  ));

  // URL 解析
  const urlInput = h('input', { type: 'text', class: 'mono', placeholder: 'https://example.com:8443/a/b?x=1#f', 'aria-label': '待解析 URL' });
  const urlOut = h('div', { style: { marginTop: '8px' } });
  urlInput.addEventListener('input', debounce(() => {
    clear(urlOut);
    const value = urlInput.value.trim();
    if (!value) return;
    const result = logic.parseUrlParts(value);
    if (!result.ok) {
      urlOut.appendChild(h('div', { class: 'hint text-err', text: result.error }));
      return;
    }
    const table = h('table', { class: 'kv' });
    const rows = [
      ['协议', result.protocol],
      ['主机', result.host],
      ['端口', result.port],
      ['路径', result.pathname],
      ['来源', result.origin]
    ];
    for (const [key, text] of rows) {
      table.appendChild(h('tr', {}, h('th', { text: key }), h('td', { class: 'mono', text: text || '—' })));
    }
    urlOut.appendChild(table);
    if (result.params.length) {
      urlOut.appendChild(h('div', { class: 'block-title' }, `查询参数（${result.params.length}）`));
      const paramTable = h('table', { class: 'kv' });
      for (const param of result.params) {
        paramTable.appendChild(h('tr', {}, h('th', { class: 'mono', text: param.key }), h('td', { class: 'mono', text: param.value })));
      }
      urlOut.appendChild(paramTable);
    }
  }, 200));

  container.appendChild(h('div', { class: 'tool-section' },
    h('span', { class: 'label' }, 'URL 解析'),
    urlInput,
    urlOut
  ));

  // Cookie 解析
  const cookieInput = h('input', { type: 'text', class: 'mono', placeholder: 'a=1; b=2; sid=abc', 'aria-label': '待解析 Cookie' });
  const cookieOut = h('div', { style: { marginTop: '8px' } });
  cookieInput.addEventListener('input', debounce(() => {
    clear(cookieOut);
    const cookies = logic.parseCookies(cookieInput.value);
    if (!cookies.length) return;
    const table = h('table', { class: 'kv' });
    for (const cookie of cookies) {
      table.appendChild(h('tr', {}, h('th', { class: 'mono', text: cookie.name }), h('td', { class: 'mono', text: cookie.value || '（空）' })));
    }
    cookieOut.appendChild(table);
  }, 200));

  container.appendChild(h('div', { class: 'tool-section' },
    h('span', { class: 'label' }, 'Cookie 解析'),
    cookieInput,
    cookieOut
  ));
}

function renderHistory(container) {
  if (!state.history.length) {
    container.appendChild(h('div', { class: 'empty' }, '还没有请求记录。成功发送一次后，这里会保留最近 8 条（只记录方法、地址、状态码与耗时）。'));
    return;
  }

  const clearButton = h('button', { class: 'btn btn-sm btn-danger', type: 'button', text: '清空历史' });
  clearButton.addEventListener('click', () => {
    state.history = [];
    write(`${STORAGE_ID}:history`, []);
    renderOutput();
    toast.ok('已清空请求历史');
  });

  container.appendChild(h('div', { class: 'row' },
    h('span', { class: 'label', text: `最近 ${state.history.length} 条` }),
    h('span', { class: 'grow' }),
    clearButton
  ));

  const list = h('div', { class: 'history-list' });
  for (const entry of state.history) {
    const row = h('button', {
      class: 'history-row',
      type: 'button',
      title: '填入请求地址',
      'aria-label': `${entry.method} ${entry.url}，状态 ${entry.status}`
    },
      h('span', { class: 'history-method', text: entry.method }),
      h('span', { class: 'history-url mono', text: entry.url }),
      h('span', { class: `history-status ${entry.status >= 400 ? 'err' : 'ok'}`, text: String(entry.status) }),
      h('span', { class: 'history-time', text: `${entry.elapsed}ms · ${new Date(entry.at).toLocaleString('zh-CN', { hour12: false })}` })
    );
    row.addEventListener('click', () => {
      els.method.value = entry.method;
      els.url.value = entry.url;
      persistRequest();
      toast.ok('已填入请求地址');
    });
    list.appendChild(row);
  }
  container.appendChild(list);
  container.appendChild(h('div', { class: 'note' }, '只保存方法、地址、状态码与耗时，不保存请求头与请求体。'));
}

const RENDERERS = {
  response: renderResponse,
  status: renderStatusReference,
  mime: renderMimeReference,
  tools: renderTools,
  history: renderHistory
};

const MODE_HINTS = {
  response: '响应体若是 JSON 会自动格式化',
  status: '收录常用 HTTP 状态码，可搜索',
  mime: '常用 MIME 类型与对应扩展名',
  tools: 'Basic 鉴权、URL 与 Cookie 的快速解析',
  history: '最近 8 次成功请求；点击可重新填入地址'
};

function renderActions() {
  const box = $('#actions');
  clear(box);

  if (state.mode === 'response' && state.response) {
    const button = h('button', { class: 'btn btn-sm', type: 'button' }, icon('codec', 12), h('span', { text: '复制 fetch 代码' }));
    button.addEventListener('click', async () => {
      const { headers } = logic.parseHeaderLines(els.headers.value);
      const snippet = logic.buildFetchSnippet({
        method: els.method.value,
        url: els.url.value,
        headers,
        body: els.body.value.trim() || null
      });
      if (await copy(snippet)) toast.ok('fetch 代码已复制');
      else toast.fail('复制失败');
    });
    box.appendChild(button);
  }
}

function renderOutput() {
  for (const tab of els.modes.querySelectorAll('[role="tab"]')) {
    tab.setAttribute('aria-selected', String(tab.dataset.mode === state.mode));
  }
  const box = $('#output');
  clear(box);
  (RENDERERS[state.mode] || renderResponse)(box);
  els.status.textContent = MODE_HINTS[state.mode] || '';
}

/* ── 初始化 ───────────────────────────────────────────────── */

function init() {
  els.modes = $('#modes');
  els.subTabs = $('#sub-tabs');
  els.status = $('#status');

  els.method = $('#method');
  mount(els.method, METHODS.map((method) => h('option', { value: method, selected: method === (read(`${STORAGE_ID}:method`, 'GET')) }, method)));
  els.method.value = read(`${STORAGE_ID}:method`, 'GET');

  els.url = $('#url');
  els.url.value = read(`${STORAGE_ID}:url`, '') || '';

  els.headers = h('textarea', { class: 'mono', spellcheck: 'false' });
  els.headers.value = read(`${STORAGE_ID}:headers`, '') || '';

  els.body = h('textarea', { class: 'mono', spellcheck: 'false' });
  els.body.value = read(`${STORAGE_ID}:body`, '') || '';

  els.timeout = $('#timeout');
  els.timeout.value = String(read(`${STORAGE_ID}:timeout`, 15));
  els.timeout.addEventListener('input', () => write(`${STORAGE_ID}:timeout`, Number(els.timeout.value) || 15));

  els.send = $('#btn-send');
  els.send.addEventListener('click', send);

  els.abort = $('#btn-abort');
  els.abort.addEventListener('click', () => {
    if (!inFlight) return;
    manualAbort = true;
    inFlight.abort();
  });

  els.url.addEventListener('input', persistRequest);
  els.headers.addEventListener('input', persistRequest);
  els.body.addEventListener('input', persistRequest);
  els.method.addEventListener('change', persistRequest);

  els.url.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      send();
    }
  });

  for (const tab of els.subTabs.querySelectorAll('[role="tab"]')) {
    tab.addEventListener('click', () => {
      state.sub = tab.dataset.sub;
      renderSubPanel();
    });
  }

  for (const tab of els.modes.querySelectorAll('[role="tab"]')) {
    tab.addEventListener('click', () => {
      state.mode = tab.dataset.mode;
      renderOutput();
      renderActions();
    });
  }

  $('#btn-sample').addEventListener('click', () => {
    els.method.value = SAMPLE.method;
    els.url.value = SAMPLE.url;
    els.headers.value = SAMPLE.headers;
    els.body.value = SAMPLE.body;
    persistRequest();
    state.sub = 'headers';
    renderSubPanel();
    toast.ok('已载入示例请求');
  });

  $('#btn-clear').addEventListener('click', () => {
    els.url.value = '';
    els.headers.value = '';
    els.body.value = '';
    state.response = null;
    persistRequest();
    renderOutput();
    els.status.className = 'panel-foot';
    els.status.textContent = '';
  });

  mountTool({
    actions: [
      { id: 'send', label: '发送请求', icon: 'network', keys: 'Ctrl+Enter', primary: true, keywords: 'send 发送 请求', run: () => send() },
      { id: 'sub-headers', label: '编辑请求头', icon: 'sliders', keywords: 'headers 请求头', run: () => { state.sub = 'headers'; renderSubPanel(); } },
      { id: 'sub-body', label: '编辑请求体', icon: 'text', keywords: 'body 请求体', run: () => { state.sub = 'body'; renderSubPanel(); } },
      { id: 'sub-curl', label: '粘贴 cURL 解析', icon: 'codec', keywords: 'curl 解析', run: () => { state.sub = 'curl'; renderSubPanel(); } },
      { id: 'mode-status', label: '查看状态码速查', icon: 'search', keywords: 'status 状态码', run: () => { state.mode = 'status'; renderOutput(); renderActions(); } },
      { id: 'mode-mime', label: '查看 MIME 速查', icon: 'markdown', keywords: 'mime 类型', run: () => { state.mode = 'mime'; renderOutput(); renderActions(); } },
      { id: 'mode-tools', label: '打开解析工具', icon: 'sliders', keywords: 'tools 解析 basic cookie url', run: () => { state.mode = 'tools'; renderOutput(); renderActions(); } },
      { id: 'mode-history', label: '查看请求历史', icon: 'refresh', keywords: 'history 历史 最近', run: () => { state.mode = 'history'; renderOutput(); renderActions(); } },
      { id: 'sample', label: '载入示例请求', icon: 'star', keywords: 'sample 示例', run: () => $('#btn-sample').click() }
    ]
  });

  renderSubPanel();
  renderOutput();
  renderActions();
  renderPermissions();
}

init();
