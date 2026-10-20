#!/usr/bin/env node
/**
 * 浏览器端验证，分两步：
 *
 *  A. 清单校验：把扩展复制到临时目录，交给 Chrome 自己打包。
 *     Chrome 会真正解析 manifest，能发现静态脚本查不出的清单问题。
 *
 *  B. 界面冒烟：用本地静态服务器托管扩展目录，再用无头浏览器逐个打开
 *     popup 与注册表里的全部工具页，检查模块是否加载、控件是否渲染、标签是否关联、
 *     主题是否应用、控制台是否报错。
 *
 * 说明与边界：
 *  - Chrome / Edge 152 起已移除命令行加载未打包扩展的能力（--load-extension 失效），
 *    因此本脚本不加载扩展本体，而是把页面当普通网页跑。
 *    这能覆盖全部界面与纯逻辑，但**不覆盖** chrome.tabs / chrome.permissions /
 *    offscreen 等扩展专有 API —— 那部分需要手动「加载解压缩的扩展」验证。
 *  - 未安装浏览器时自动跳过，退出码仍为 0。
 */

import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CDP_PORT = Number(process.env.CODECRATE_CDP_PORT || 9345);
const PROFILE = join('/tmp', `codecrate-smoke-${process.pid}`);
const PACK_DIR = join('/tmp', `codecrate-pack-${process.pid}`);
const TOTAL_TIMEOUT_MS = 180000;

const BROWSERS = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
].filter(Boolean);

const browserPath = BROWSERS.find((candidate) => existsSync(candidate));
if (!browserPath) {
  console.log('未找到 Chrome / Edge / Chromium，跳过浏览器验证');
  process.exit(0);
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const browserName = browserPath.split('/').pop();
const failures = [];

let cleaned = false;
const cleanup = () => {
  if (cleaned) return;
  cleaned = true;
  for (const dir of [PROFILE, PACK_DIR, `${PACK_DIR}.crx`, `${PACK_DIR}.pem`]) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* 忽略 */
    }
  }
};
process.on('exit', cleanup);

/* ══ A. 用 Chrome 校验清单 ══════════════════════════════════ */

function validateManifestWithChrome() {
  mkdirSync(PACK_DIR, { recursive: true });
  for (const item of ['manifest.json', 'icons', 'src']) {
    cpSync(join(ROOT, item), join(PACK_DIR, item), { recursive: true });
  }

  const packArgs = ['--pack-extension=' + PACK_DIR, '--no-message-box', '--no-sandbox', '--disable-gpu'];
  const result = spawnSync(browserPath, packArgs, { encoding: 'utf8', timeout: 60000 });
  const crx = `${PACK_DIR}.crx`;

  if (!existsSync(crx)) {
    const output = `${result.stdout || ''}${result.stderr || ''}`;
    const meaningful = output.split('\n').filter((line) => /manifest|extension|error/i.test(line)).slice(0, 3);
    failures.push(`Chrome 未能打包扩展，manifest 可能不合法${meaningful.length ? `：${meaningful.join(' / ')}` : ''}`);
    return;
  }

  const size = readFileSync(crx).length;
  console.log(`清单校验：Chrome 成功打包（.crx ${Math.round(size / 1024)} KB）`);
}

/* ══ B. 界面冒烟 ════════════════════════════════════════════ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.gz': 'application/gzip'
};

function startStaticServer() {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, `http://127.0.0.1:${CDP_PORT}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/') pathname = '/src/popup/popup.html';
    if (pathname === '/favicon.ico') {
      response.writeHead(204).end();
      return;
    }

    const full = normalize(join(ROOT, pathname));
    if (!full.startsWith(ROOT)) {
      response.writeHead(403).end('forbidden');
      return;
    }
    try {
      const data = await readFile(full);
      response.writeHead(200, { 'Content-Type': MIME[extname(full)] || 'application/octet-stream' });
      response.end(data);
    } catch {
      response.writeHead(404).end('not found');
    }
  });
  return new Promise((done) => {
    server.listen(0, '127.0.0.1', () => done(server));
  });
}

class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.sequence = 0;
    this.pending = new Map();
    this.errors = [];
  }

  static async connect(webSocketUrl) {
    const socket = new WebSocket(webSocketUrl);
    await new Promise((done, reject) => {
      const timer = setTimeout(() => reject(new Error('DevTools 连接超时')), 10000);
      socket.onopen = () => {
        clearTimeout(timer);
        done();
      };
      socket.onerror = () => {
        clearTimeout(timer);
        reject(new Error('DevTools 连接失败'));
      };
    });
    const client = new Cdp(socket);
    socket.onmessage = (event) => client.handle(JSON.parse(event.data));
    return client;
  }

  handle(message) {
    if (message.id && this.pending.has(message.id)) {
      const { resolve: done, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else done(message.result);
      return;
    }
    if (message.method === 'Runtime.exceptionThrown') {
      const details = message.params.exceptionDetails;
      this.errors.push(details.exception?.description || details.text || '未知异常');
    }
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
      this.errors.push(message.params.entry.text);
    }
  }

  send(method, params = {}) {
    const id = ++this.sequence;
    return new Promise((done, reject) => {
      this.pending.set(id, { resolve: done, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    }
    return result.result.value;
  }

  async navigate(url) {
    this.errors.length = 0;
    await this.send('Page.navigate', { url });
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await sleep(120);
      try {
        if ((await this.evaluate('document.readyState')) === 'complete') break;
      } catch {
        /* 跳转中取不到上下文属正常 */
      }
    }
    await sleep(350); // 留给模块脚本与首屏渲染
  }

  close() {
    try {
      this.socket.close();
    } catch {
      /* 忽略 */
    }
  }
}

const CHECK_EXPRESSION = `(() => {
  const header = document.querySelector('#app-header .app-title');
  return {
    mounted: Boolean(header),
    heading: header ? header.textContent : '',
    hasMain: Boolean(document.querySelector('.tool-main')),
    controls: document.querySelectorAll('input, select, textarea, button').length,
    labelled: document.querySelectorAll('label[for]').length,
    theme: document.documentElement.getAttribute('data-theme'),
    lang: document.documentElement.lang || ''
  };
})()`;

/* 加载后依次点开所有标签页，检查每个视图都能渲染、且不产生控制台错误。
   这比只看首屏强得多：任一模式写坏都会被抓到。 */
const SWEEP_EXPRESSION = `(async () => {
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const ready = () => new Promise((done) => setTimeout(done, 130));
  const visited = [];

  for (const tab of tabs) {
    tab.click();
    await ready();
    visited.push(tab.dataset.mode || tab.dataset.sub || (tab.textContent || '').trim());
  }

  const labelsInFields = [...document.querySelectorAll('.field label')];
  return {
    visited,
    tabs: tabs.length,
    controls: document.querySelectorAll('input, select, textarea, button').length,
    fields: document.querySelectorAll('.field').length,
    labelsInFields: labelsInFields.length,
    unassociated: labelsInFields.filter((label) => !label.getAttribute('for')).length
  };
})()`;

/* 交互探针：只验证「渲染出来」还不够，这里真的驱动一次核心操作，
   确认用户点下去确实能拿到结果。返回 'ok' 表示通过，其他字符串会作为失败原因。 */
const PROBES = {
  converter: `(async () => {
    const input = document.getElementById('input');
    input.value = '{"a":1,"b":[2,3]}';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 500));
    const output = document.getElementById('output').value;
    if (!output.includes('a: 1')) return 'JSON → YAML 未产出预期内容：' + output.slice(0, 60);
    return 'ok';
  })()`,

  json: `(async () => {
    const input = document.getElementById('json-input');
    input.value = '{"b":1,"a":[2,3]}';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 350));
    document.getElementById('btn-format').click();
    await new Promise((r) => setTimeout(r, 250));
    const text = document.getElementById('json-input').value;
    if (!text.includes('\\n  "b": 1')) return '格式化未生效：' + text.slice(0, 60);
    return 'ok';
  })()`,

  uuid: `(async () => {
    const tab = [...document.querySelectorAll('#modes [role="tab"]')].find((t) => t.dataset.mode === 'identifier');
    if (tab) tab.click();
    await new Promise((r) => setTimeout(r, 300));
    const count = document.querySelectorAll('.output-value').length;
    return count >= 1 ? 'ok' : '未生成任何结果';
  })()`,

  color: `(async () => {
    const hex = document.getElementById('hex-input');
    if (!hex) return '缺少 HEX 输入框';
    hex.value = '#ff0';
    hex.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 120));
    if (hex.value !== '#ff0') return 'HEX 输入被实时改写：' + hex.value;
    hex.value = '#ff0000';
    hex.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 120));
    if (hex.value !== '#ff0000') return 'HEX 输入被实时改写：' + hex.value;

    const tab = [...document.querySelectorAll('#modes [role="tab"]')].find((t) => t.dataset.mode === 'contrast');
    if (tab) tab.click();
    await new Promise((r) => setTimeout(r, 300));
    const ratio = document.querySelector('.contrast-ratio');
    const value = ratio ? Number(ratio.textContent) : NaN;
    if (!Number.isFinite(value) || value < 1) return '对比度未计算：' + (ratio ? ratio.textContent : '缺少元素');
    return 'ok';
  })()`,

  crypto: `(async () => {
    // 标签页扫描会停在最后一个视图，先切回 HMAC
    const tab = [...document.querySelectorAll('#modes [role="tab"]')].find((t) => t.dataset.mode === 'hmac');
    if (tab) tab.click();
    await new Promise((r) => setTimeout(r, 250));
    const key = document.getElementById('hmac-key');
    const message = document.getElementById('hmac-message');
    if (!key || !message) return '缺少 HMAC 输入框';
    key.value = 'key';
    key.dispatchEvent(new Event('input', { bubbles: true }));
    message.value = 'The quick brown fox jumps over the lazy dog';
    message.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 800));
    const cell = document.querySelector('.result-table .col-value.primary');
    const text = cell ? cell.textContent.trim() : '';
    // HMAC-SHA256("key", "The quick brown fox jumps over the lazy dog") 的公开测试值
    if (!text.startsWith('f7bc83f430538424b13298e6aa6fb143')) return 'HMAC 结果不符：' + text.slice(0, 40);

    // 默认不应把密钥/明文写进 localStorage
    const CRYPTO_KEY = 'codecrate:crypto:state';
    const stored = () => localStorage.getItem(CRYPTO_KEY) || '';
    if (stored().includes('The quick brown fox')) return '未开启开关时输入被写入了本地存储';

    const toggle = document.getElementById('remember-secrets');
    if (!toggle) return '缺少「记住密钥」开关';
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 80));
    if (!stored().includes('The quick brown fox')) return '开启开关后输入未持久化';

    toggle.checked = false;
    toggle.dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 80));
    if (stored().includes('The quick brown fox')) return '关闭开关后本地存储未清除';
    return 'ok';
  })()`,

  otp: `(async () => {
    const secret = document.getElementById('secret');
    secret.value = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    secret.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 600));
    const type = document.getElementById('type');
    type.value = 'hotp';
    type.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 600));
    const counter = document.getElementById('counter');
    counter.value = '0';
    counter.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 800));
    const code = (document.getElementById('code-value') || {}).textContent || '';
    // RFC 4226 附录 D 的第 0 个向量
    if (code.trim() !== '755224') return 'HOTP 结果不符：' + code.trim();
    if (!document.querySelector('.qr-block canvas')) return '二维码未生成';

    // 默认不应持久化密钥；开/关开关时行为要一致
    const OTP_KEY = 'codecrate:otp:secret';
    const stored = () => localStorage.getItem(OTP_KEY) || '';
    if (stored().includes('GEZD')) return '未开启开关时密钥被写入了本地存储';

    const toggle = document.getElementById('remember-secret');
    if (!toggle) return '缺少「记住密钥」开关';
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 80));
    if (!stored().includes('GEZD')) return '开启开关后密钥未持久化';

    toggle.checked = false;
    toggle.dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 80));
    if (stored().includes('GEZD')) return '关闭开关后本地存储未清除';
    return 'ok';
  })()`,

  compress: `(async () => {
    // 扫描会点过方向按钮，先切回「压缩」
    const tab = [...document.querySelectorAll('#directions [role="tab"]')].find((t) => t.dataset.direction === 'compress');
    if (tab) tab.click();
    await new Promise((r) => setTimeout(r, 300));
    const input = document.getElementById('input');
    input.value = 'codecrate compress probe';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 800));
    const box = document.querySelector('.output-box');
    const base64 = box ? box.textContent.trim() : '';
    if (!base64) return '没有产生输出';
    let binary;
    try { binary = atob(base64); } catch { return '输出不是合法 Base64：' + base64.slice(0, 30); }
    // gzip 的魔数是 1f 8b
    if (binary.charCodeAt(0) !== 0x1f || binary.charCodeAt(1) !== 0x8b) return '输出缺少 gzip 魔数';

    // 切到解压后应默认自动识别，而不是沿用压缩模式的 gzip
    const decompress = [...document.querySelectorAll('#directions [role="tab"]')].find((t) => t.dataset.direction === 'decompress');
    decompress.click();
    await new Promise((r) => setTimeout(r, 250));
    input.value = base64;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 900));
    const restored = document.querySelector('.output-box');
    if (!restored || !restored.textContent.includes('codecrate compress probe')) {
      return '解压未自动识别：' + (restored ? restored.textContent.slice(0, 40) : '无输出');
    }
    return 'ok';
  })()`,

  webassets: `(async () => {
    const tab = [...document.querySelectorAll('#modes [role="tab"]')].find((t) => t.dataset.mode === 'meta');
    if (tab) tab.click();
    await new Promise((r) => setTimeout(r, 250));
    const title = document.querySelector('#form input');
    if (!title) return '缺少标题输入框';
    title.focus();
    title.value = 'Probe & <Title>';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 600));
    if (document.activeElement !== title) return '输入后焦点丢失';
    const box = document.querySelector('.output-box');
    const html = box ? box.textContent : '';
    if (!html.includes('&amp;')) return '未转义 & ：' + html.slice(0, 60);
    if (html.includes('<Title>')) return '特殊字符未转义，输出里出现了裸标签';
    return html.includes('og:title') ? 'ok' : '缺少 og:title：' + html.slice(0, 60);
  })()`,

  svg: `(async () => {
    const width = document.querySelector('#form input[type="number"]');
    if (!width) return '缺少宽度输入框';
    width.value = '320';
    width.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 600));
    const image = document.querySelector('.preview-stage img');
    if (!image) return '预览图未生成';
    const src = image.getAttribute('src') || '';
    if (!src.startsWith('data:image/svg+xml,')) return '预览不是 SVG data URI';
    // data URI 能被浏览器解码 + 图片真正加载成功，说明生成的 SVG 是合法可渲染的
    if (!image.complete || image.naturalWidth === 0) return 'SVG 未能被浏览器渲染';
    const code = document.querySelector('.code-box');
    return code && code.textContent.includes('<svg') ? 'ok' : '缺少 SVG 源码输出';
  })()`,

  wifi: `(async () => {
    const ssid = document.getElementById('ssid');
    const password = document.getElementById('password');
    ssid.value = 'ProbeNet';
    ssid.dispatchEvent(new Event('input', { bubbles: true }));
    password.value = 'probe-password';
    password.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 700));
    const code = document.querySelector('.code-box');
    const text = code ? code.textContent.trim() : '';
    if (!text.startsWith('WIFI:')) return '未生成 WIFI 串：' + text.slice(0, 40);
    if (!text.includes('S:ProbeNet')) return 'WIFI 串缺少 SSID';
    return document.querySelector('.qr-stage canvas') ? 'ok' : '二维码未渲染';
  })()`,

  image: `(async () => {
    // 文件选择器无法自动化，改用 canvas 程序化造一张 PNG，
    // 再以 Base64 走「载入粘贴内容」，这样整条链路都能验证到。
    const canvas = document.createElement('canvas');
    canvas.width = 120;
    canvas.height = 80;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(0, 0, 120, 80);
    ctx.fillStyle = '#00ff00';
    ctx.fillRect(0, 0, 60, 40);
    const dataUri = canvas.toDataURL('image/png');

    // 解码、转码都是异步链路，固定 sleep 在慢机器上会偶发超时，统一改成轮询。
    const waitFor = async (predicate, timeout = 5000) => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        if (predicate()) return true;
        await new Promise((r) => setTimeout(r, 100));
      }
      return predicate();
    };

    const paste = document.getElementById('paste');
    paste.value = dataUri;
    document.getElementById('btn-load-paste').click();

    const card = () => document.querySelector('.source-card .meta');
    if (!(await waitFor(() => card() && card().textContent.includes('120 × 80')))) {
      return '尺寸识别不对：' + (card() ? card().textContent.slice(0, 60) : '来源信息未渲染');
    }

    const tab = (mode) => [...document.querySelectorAll('#modes [role="tab"]')].find((t) => t.dataset.mode === mode);

    // 元数据视图
    tab('meta').click();
    if (!(await waitFor(() => document.querySelector('.info-table')))) return '元数据表未渲染';

    // 色盲模拟视图：确认像素真的被变换过
    tab('vision').click();
    if (!(await waitFor(() => document.querySelector('.preview-stage canvas')))) {
      return '色盲模拟未渲染 canvas';
    }
    const visionCanvas = document.querySelector('.preview-stage canvas');
    const pixel = visionCanvas.getContext('2d').getImageData(0, 0, 1, 1).data;
    if (pixel[0] === 255 && pixel[1] === 0 && pixel[2] === 0) {
      return '色盲模拟没有改变像素';
    }

    // 转换视图：确认导出成功并给出体积对比
    tab('convert').click();
    if (!(await waitFor(() => document.querySelectorAll('.stat-cell').length >= 3))) {
      const mode = document.querySelector('#modes [aria-selected="true"]');
      return '转换统计未渲染（当前视图：' + (mode ? mode.dataset.mode : '?') + '）';
    }
    return 'ok';
  })()`,

  css: `(async () => {
    const tab = (mode) => [...document.querySelectorAll('#modes [role="tab"]')].find((t) => t.dataset.mode === mode);
    const code = () => {
      const box = document.querySelector('.code-box');
      return box ? box.textContent : '';
    };

    tab('gradient').click();
    await new Promise((r) => setTimeout(r, 200));
    if (!code().startsWith('background: linear-gradient(')) return '渐变代码未生成：' + code().slice(0, 60);
    if (!document.querySelector('.gradient-swatch')) return '渐变预览未渲染';

    tab('shadow').click();
    await new Promise((r) => setTimeout(r, 200));
    if (!code().startsWith('box-shadow:')) return '阴影代码未生成：' + code().slice(0, 60);
    if (!document.querySelector('.shadow-card')) return '阴影预览未渲染';

    // 改一个偏移值，代码必须同步
    const x = document.getElementById('layer-0-x');
    x.value = '12';
    x.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 120));
    if (!code().includes('12px')) return '修改数值后代码未同步：' + code().slice(0, 60);
    return 'ok';
  })()`,

  http: `(async () => {
    if (document.getElementById('btn-abort').hidden !== true) return '中止按钮初始应隐藏';

    const tab = [...document.querySelectorAll('#modes [role="tab"]')].find((t) => t.dataset.mode === 'history');
    if (!tab) return '缺少历史视图';
    tab.click();
    await new Promise((r) => setTimeout(r, 150));

    const rows = document.querySelectorAll('.history-row');
    if (rows.length !== 1) return '历史记录未渲染：' + rows.length;
    if (!rows[0].textContent.includes('example.com/api')) return '历史内容不对：' + rows[0].textContent.slice(0, 60);

    rows[0].click();
    await new Promise((r) => setTimeout(r, 100));
    if (document.getElementById('url').value !== 'https://example.com/api') return '点击历史未填入地址';
    return 'ok';
  })()`,

  file: `(async () => {
    const waitFor = async (predicate, timeout = 5000) => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        if (predicate()) return true;
        await new Promise((r) => setTimeout(r, 100));
      }
      return predicate();
    };
    const tab = (mode) => [...document.querySelectorAll('#modes [role="tab"]')].find((t) => t.dataset.mode === mode);

    // 程序化造一个 File，走与拖拽完全相同的载入路径
    const input = document.getElementById('file');
    const transfer = new DataTransfer();
    transfer.items.add(new File(['abc'], 'abc.txt', { type: 'text/plain' }));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));

    tab('hashes').click();
    if (!(await waitFor(() => document.querySelectorAll('.hash-row').length >= 6))) {
      return '哈希未渲染：' + document.querySelectorAll('.hash-row').length;
    }
    const text = document.body.textContent;
    if (!text.includes('900150983cd24fb0d6963f7d28e17f72')) return 'MD5 值不对';
    if (!text.includes('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')) {
      return 'SHA-256 值不对';
    }

    tab('base64').click();
    await new Promise((r) => setTimeout(r, 150));
    const base64 = document.querySelector('.encode-output');
    if (!base64 || base64.value !== 'YWJj') return 'Base64 输出不对：' + (base64 ? base64.value : '缺少输出');

    tab('hex').click();
    await new Promise((r) => setTimeout(r, 120));
    const hex = document.querySelector('.encode-output');
    if (!hex || hex.value !== '616263') return '十六进制输出不对：' + (hex ? hex.value : '缺少输出');
    return 'ok';
  })()`,

  password: `(async () => {
    const value = () => document.getElementById('password-value').value;
    if (value().length !== 20) return '默认长度不对：' + value().length;
    if (!/bit/.test(document.querySelector('.strength-bits').textContent)) return '强度未显示';

    const pin = [...document.querySelectorAll('.chip')].find((chip) => chip.textContent === '数字 PIN');
    if (!pin) return '缺少数字 PIN 预设';
    pin.click();
    await new Promise((r) => setTimeout(r, 160));
    if (!/^[0-9]{6}$/.test(value())) return 'PIN 预设不对：' + value();

    const digits = document.getElementById('set-digits');
    digits.checked = false;
    digits.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 120));
    if (!document.getElementById('status').textContent.includes('至少选择一种')) {
      return '未提示字符类型错误：' + document.getElementById('status').textContent;
    }

    const random = document.getElementById('random-value').value;
    if (!/^[0-9a-f]{32}$/.test(random)) return '随机串不对：' + random;
    return 'ok';
  })()`,

  mdtable: `(async () => {
    const outputTab = [...document.querySelectorAll('#modes [role="tab"]')].find((tab) => tab.dataset.mode === 'output');
    outputTab.click();
    await new Promise((r) => setTimeout(r, 120));

    const output = () => document.getElementById('md-output')?.textContent || '';
    if (!output().includes('| 列 1 | 列 2 | 列 3 |')) return '默认表格未生成：' + output().slice(0, 60);
    if (!output().includes('| --- | --- | --- |')) return '缺少分隔行';

    const before = output().split('\\n').length;
    document.getElementById('btn-add-row').click();
    await new Promise((r) => setTimeout(r, 150));
    if (output().split('\\n').length !== before + 1) return '添加行后输出行数不对';

    const importTab = [...document.querySelectorAll('#modes [role="tab"]')].find((tab) => tab.dataset.mode === 'import');
    importTab.click();
    await new Promise((r) => setTimeout(r, 100));
    const area = document.getElementById('import-text');
    area.value = 'a,b\\n1,2';
    document.getElementById('btn-import').click();
    await new Promise((r) => setTimeout(r, 180));

    const text = output();
    if (!text.includes('| a | b |') || !text.includes('| 1 | 2 |')) {
      return 'CSV 导入结果不对：' + text.slice(0, 80);
    }
    return 'ok';
  })()`,

  barcode: `(async () => {
    const img = () => document.querySelector('.barcode-img');
    if (!img() || !img().src.startsWith('data:image/svg+xml')) return '预览未渲染';

    const input = document.getElementById('barcode-text');
    input.value = 'AB';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 320));

    const svg = decodeURIComponent(img().src.split(',')[1]);
    if (!svg.includes('aria-label="AB"')) return 'SVG 未随输入更新';
    const meta = document.querySelector('.preview-meta');
    if (!meta || !meta.textContent.includes('校验位')) return '缺少校验位信息';

    input.value = '中文';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 320));
    if (!document.querySelector('.inline-error')) return '非法字符未提示';
    return 'ok';
  })()`,

  regex: `(async () => {
    const tab = [...document.querySelectorAll('#modes [role="tab"]')].find((t) => t.dataset.mode === 'matches');
    if (tab) tab.click();
    await new Promise((r) => setTimeout(r, 150));
    const input = document.getElementById('text');
    input.value = 'a@b.com and c@d.org';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 450));
    const matches = document.querySelectorAll('.match-card').length;
    return matches >= 1 ? 'ok' : '未匹配到结果';
  })()`
};

async function main() {
  validateManifestWithChrome();

  const server = await startStaticServer();
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const child = spawn(browserPath, [
    '--headless=new',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    `--user-data-dir=${PROFILE}`,
    `--remote-debugging-port=${CDP_PORT}`,
    'about:blank'
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  let browserLog = '';
  child.stdout.on('data', (chunk) => { browserLog += chunk; });
  child.stderr.on('data', (chunk) => { browserLog += chunk; });
  process.on('exit', () => {
    try {
      child.kill('SIGKILL');
    } catch {
      /* 忽略 */
    }
  });

  let client = null;
  try {
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
        if (response.ok) {
          ready = true;
          break;
        }
      } catch {
        /* 继续等 */
      }
      await sleep(250);
    }
    if (!ready) throw new Error('DevTools 端口未就绪');

    const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
    const page = targets.find((target) => target.type === 'page');
    if (!page) throw new Error('没有可用的页面 target');

    client = await Cdp.connect(page.webSocketDebuggerUrl);
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Log.enable');

    console.log(`浏览器：${browserName}（以普通网页方式验证界面，不加载扩展本体）`);

    /* popup */
    await client.navigate(`${baseUrl}/src/popup/popup.html`);
    const popup = await client.evaluate(`(() => ({
      cards: document.querySelectorAll('.tool-card').length,
      chips: document.querySelectorAll('.chip').length,
      hasSearch: Boolean(document.getElementById('search')),
      hasTheme: Boolean(document.getElementById('theme-slot').firstElementChild)
    }))()`);

    if (popup.cards < 1) failures.push(`popup 未渲染工具卡片（${popup.cards}）`);
    if (popup.chips < 1) failures.push('popup 缺少分类筛选');
    if (!popup.hasSearch) failures.push('popup 缺少搜索框');
    if (!popup.hasTheme) failures.push('popup 缺少主题切换按钮');
    if (client.errors.length) failures.push(`popup 控制台报错：${client.errors[0]}`);
    console.log(`  popup      ${popup.cards} 个卡片 · ${popup.chips} 个分类${client.errors.length ? ' · 有报错' : ' · 无报错'}`);

    /* 主题持久化：切一次 → 重新打开 → 必须还是用户选的那个。
       只断言 data-theme 非空是不够的——读写格式不一致时它照样非空。
       这里必须真的走一遍「关掉再打开」，那才是用户看到重置的路径。 */
    await client.navigate(`${baseUrl}/src/popup/popup.html`);
    const themeSwitch = await client.evaluate(`(() => {
      const before = document.documentElement.getAttribute('data-theme');
      document.querySelector('#theme-slot button').click();
      return { before, after: document.documentElement.getAttribute('data-theme') };
    })()`);

    if (client.errors.length) failures.push(`主题切换控制台报错：${client.errors[0]}`);
    if (themeSwitch.before === themeSwitch.after) {
      failures.push(`主题切换按钮没有改变主题（仍是 ${themeSwitch.before}）`);
    }

    /* 顺带把存储内容带进失败信息，格式不一致时一眼能看出来 */
    const THEME_STATE = `(() => ({
      theme: document.documentElement.getAttribute('data-theme'),
      store: JSON.stringify(Object.fromEntries(Object.entries(localStorage)))
    }))()`;

    await client.navigate(`${baseUrl}/src/popup/popup.html`);
    const reopened = await client.evaluate(THEME_STATE);
    if (reopened.theme !== themeSwitch.after) {
      failures.push(
        `主题未持久化：切到 ${themeSwitch.after}，重新打开却是 ${reopened.theme}（存储 ${reopened.store}）`
      );
    }

    // 切回原样，避免影响后面的工具页检查
    await client.evaluate(`document.querySelector('#theme-slot button').click()`);
    await client.navigate(`${baseUrl}/src/popup/popup.html`);
    const restored = await client.evaluate(THEME_STATE);
    if (restored.theme !== themeSwitch.before) {
      failures.push(`主题切回后未持久化：期望 ${themeSwitch.before}，实际 ${restored.theme}`);
    }
    console.log(`  主题      ${themeSwitch.before} → 重载后 ${reopened.theme} → 切回 ${restored.theme}`);

    /* 最近使用：种入两条记录 → 重开 popup → 应出现「最近使用」分组且顺序正确 */
    await client.navigate(`${baseUrl}/src/popup/popup.html`);
    await client.evaluate(`localStorage.setItem('codecrate:recent', JSON.stringify(['json', 'codec']))`);
    await client.navigate(`${baseUrl}/src/popup/popup.html`);
    const recent = await client.evaluate(`(() => ({
      labels: [...document.querySelectorAll('.category-label')].map((node) => node.textContent),
      ids: [...document.querySelectorAll('.tool-card')].map((node) => node.dataset.tool)
    }))()`);
    if (!recent.labels.includes('最近使用')) {
      failures.push(`popup 未显示「最近使用」分组（分组：${recent.labels.join(',') || '无'}）`);
    } else if (recent.ids[0] !== 'json' || recent.ids[1] !== 'codec') {
      failures.push(`最近使用排序不对：${recent.ids.slice(0, 3).join(' → ')}`);
    } else if (client.errors.length) {
      failures.push(`最近使用渲染报错：${client.errors[0]}`);
    } else {
      console.log('  最近使用  json → codec → 其余');
    }

    /* 命令面板：关闭时不能拦截页面按键，打开/重开后键盘导航要可用 */
    await client.navigate(`${baseUrl}/src/tools/json/index.html`);
    const paletteKeys = await client.evaluate(`(async () => {
      const fire = (key, extra = {}) => {
        const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra });
        document.dispatchEvent(event);
        return event.defaultPrevented;
      };
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const closedEnter = fire('Enter');
      const closedTab = fire('Tab');
      fire('k', { ctrlKey: true });
      await sleep(80);
      const openArrow = fire('ArrowDown');
      fire('Escape');
      await sleep(80);
      const closedAgain = fire('ArrowDown');
      fire('k', { ctrlKey: true });
      await sleep(80);
      const reopenArrow = fire('ArrowDown');
      fire('Escape');
      return { closedEnter, closedTab, openArrow, closedAgain, reopenArrow };
    })()`);

    if (paletteKeys.closedEnter || paletteKeys.closedTab) failures.push('命令面板关闭时仍拦截 Enter/Tab');
    if (!paletteKeys.openArrow) failures.push('命令面板打开后方向键失效');
    if (paletteKeys.closedAgain) failures.push('命令面板关闭后监听器未解绑');
    if (!paletteKeys.reopenArrow) failures.push('命令面板重开后方向键失效');
    if (!paletteKeys.closedEnter && !paletteKeys.closedTab && paletteKeys.openArrow && !paletteKeys.closedAgain && paletteKeys.reopenArrow) {
      console.log('  命令面板  关闭不拦截 · 打开可导航 · 重开可导航');
    }

    /* 全部工具首页：卡片数量、分组、搜索过滤 */
    const { TOOLS } = await import('../src/core/registry.js');
    await client.navigate(`${baseUrl}/src/home/index.html`);
    const home = await client.evaluate(`(() => ({
      cards: document.querySelectorAll('.tool-card').length,
      groups: [...document.querySelectorAll('.group-label')].map((node) => node.textContent),
      firstHref: (document.querySelector('.tool-card') || {}).getAttribute
        ? document.querySelector('.tool-card').getAttribute('href')
        : '',
      theme: document.documentElement.getAttribute('data-theme'),
      lang: document.documentElement.lang
    }))()`);

    if (client.errors.length) failures.push(`首页控制台报错：${client.errors[0]}`);
    if (home.lang !== 'zh-CN') failures.push(`首页 lang=${home.lang || '空'}`);
    if (!home.theme) failures.push('首页主题未应用');
    if (home.cards !== TOOLS.length) failures.push(`首页卡片数不对：${home.cards} / ${TOOLS.length}`);
    if (!home.groups.includes('最近使用')) failures.push(`首页缺少「最近使用」分组（${home.groups.join(',') || '无'}）`);
    if (!home.firstHref || !home.firstHref.includes('/src/tools/')) failures.push(`首页卡片链接不对：${home.firstHref}`);

    const filtered = await client.evaluate(`(async () => {
      const search = document.getElementById('search');
      search.value = 'json';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 260));
      const cards = [...document.querySelectorAll('.tool-card')];
      return {
        count: cards.length,
        firstHref: cards[0] ? cards[0].getAttribute('href') : '',
        countText: (document.getElementById('count') || {}).textContent || ''
      };
    })()`);
    if (!filtered.count) failures.push('首页搜索没有结果');
    else if (!filtered.firstHref.includes('/tools/json/')) failures.push(`首页搜索匹配不对：${filtered.firstHref}`);
    else console.log(`  首页      ${home.cards} 个卡片 · 搜索 json → ${filtered.count} 个 · ${filtered.countText}`);

    /* 每个工具页 */
    console.log(`工具页：共 ${TOOLS.length} 个`);

    for (const tool of TOOLS) {
      try {
        // HTTP 历史在页面初始化时读取，必须在导航前种入
        if (tool.id === 'http') {
          await client.navigate(`${baseUrl}/src/popup/popup.html`);
          await client.evaluate(`localStorage.setItem('codecrate:http:history', JSON.stringify([
            { method: 'GET', url: 'https://example.com/api', status: 200, elapsed: 123, at: Date.now() }
          ]))`);
        }
        await client.navigate(`${baseUrl}/${tool.path}`);
        const state = await client.evaluate(CHECK_EXPRESSION);
        const sweep = await client.evaluate(SWEEP_EXPRESSION);

        const problems = [];
        if (state.lang !== 'zh-CN') problems.push(`lang=${state.lang || '空'}`);
        if (!state.theme) problems.push('主题未应用');
        if (!state.hasMain) problems.push('缺少 .tool-main');
        if (!state.mounted) problems.push('头部未挂载');
        if (sweep.controls < 2) problems.push(`控件过少（${sweep.controls}）`);
        if (sweep.unassociated > 0) problems.push(`${sweep.unassociated} 个 label 未关联控件`);
        if (client.errors.length) problems.push(`控制台报错：${client.errors[0]}`);

        // 交互探针：真的驱动一次核心操作
        let probeNote = '';
        if (PROBES[tool.id]) {
          const outcome = await client.evaluate(PROBES[tool.id]);
          if (outcome === 'ok') probeNote = ' · 交互通过';
          else {
            problems.push(`交互探针：${outcome}`);
            if (client.errors.length) problems.push(`探针期间报错：${client.errors[0]}`);
          }
        }

        if (problems.length) {
          failures.push(`${tool.id}: ${problems.join('；')}`);
          console.log(`  ✗ ${tool.id.padEnd(10)} ${problems.join('；')}`);
        } else {
          const tabInfo = sweep.tabs ? `${sweep.tabs} 个视图` : '无标签页';
          console.log(
            `  ✓ ${tool.id.padEnd(10)} ${tabInfo} · ${String(sweep.controls).padStart(3)} 控件 · ${String(sweep.labelsInFields).padStart(2)} 关联标签${probeNote} · ${state.heading}`
          );
        }
      } catch (error) {
        failures.push(`${tool.id}: ${error.message}`);
        console.log(`  ✗ ${tool.id.padEnd(10)} ${error.message}`);
      }
    }

    /* 折叠面板（markdown 编辑区 / json 输入区）：点一次 → 重新加载 → 必须还是折叠的。
       折叠状态是持久化的，这类「关掉重开」的路径最容易漏。
       先把视口钉死在宽屏：这个功能的用户价值就是「另一半拿到整行」，
       而窄屏本来就是堆积布局，断言会随视口漂移（工具页断点是 880 / 900px）。 */
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 1280, height: 800, deviceScaleFactor: 1, mobile: false
    });

    const FOLD_CASES = [
      { tool: 'markdown', layout: 'md-layout', body: 'editor-body' },
      { tool: 'json', layout: 'json-layout', body: 'input-body' }
    ];

    for (const foldCase of FOLD_CASES) {
      await client.navigate(`${baseUrl}/src/tools/${foldCase.tool}/index.html`);
      const probe = `(() => {
        const body = document.getElementById(${JSON.stringify(foldCase.body)});
        const button = document.querySelector('#${foldCase.layout} .fold-btn');
        const svg = button.querySelector('svg');
        const out = document.getElementById('output').getBoundingClientRect();
        return {
          visible: Boolean(body) && getComputedStyle(body).display !== 'none',
          expanded: button.getAttribute('aria-expanded'),
          width: Math.round(out.width),
          iconOk: Boolean(svg) && svg.namespaceURI === 'http://www.w3.org/2000/svg'
        };
      })()`;
      const click = `document.querySelector('#${foldCase.layout} .fold-btn').click()`;

      const foldOpen = await client.evaluate(probe);
      if (!foldOpen.visible) failures.push(`${foldCase.tool}: 默认状态下被折叠区不可见`);
      if (!foldOpen.iconOk) failures.push(`${foldCase.tool}: 折叠按钮的图标没有渲染成 SVG`);

      await client.evaluate(click);
      const foldShut = await client.evaluate(probe);
      if (foldShut.visible) failures.push(`${foldCase.tool}: 点击折叠后仍然可见`);
      if (foldShut.expanded !== 'false') failures.push(`${foldCase.tool}: 折叠后 aria-expanded=${foldShut.expanded}`);
      if (foldShut.width <= foldOpen.width) {
        failures.push(`${foldCase.tool}: 折叠后另一半没有变宽（${foldOpen.width} → ${foldShut.width}）`);
      }

      await client.navigate(`${baseUrl}/src/tools/${foldCase.tool}/index.html`);
      const foldReloaded = await client.evaluate(probe);
      if (foldReloaded.visible) failures.push(`${foldCase.tool}: 折叠状态未持久化，重新打开后又出现了`);
      if (foldReloaded.expanded !== 'false') failures.push(`${foldCase.tool}: 重载后 aria-expanded=${foldReloaded.expanded}`);

      // 还原，避免影响后续状态
      await client.evaluate(click);
      const foldBack = await client.evaluate(probe);
      if (!foldBack.visible) failures.push(`${foldCase.tool}: 展开后没有恢复`);
      if (foldBack.width !== foldOpen.width) {
        failures.push(`${foldCase.tool}: 展开后宽度没有还原（${foldOpen.width} → ${foldBack.width}）`);
      }
      if (client.errors.length) failures.push(`${foldCase.tool} 折叠期间控制台报错：${client.errors[0]}`);
      console.log(
        `  折叠     ${foldCase.tool.padEnd(9)} 可见 → 隐藏且另一半 ${foldOpen.width}→${foldShut.width}px → 重载仍折叠 → 展开还原`
      );
    }
    await client.send('Emulation.clearDeviceMetricsOverride');
  } finally {
    if (client) client.close();
    try {
      child.kill('SIGKILL');
    } catch {
      /* 忽略 */
    }
    server.close();
  }
}

const watchdog = setTimeout(() => {
  console.error('浏览器验证整体超时，已中止');
  cleanup();
  process.exit(1);
}, TOTAL_TIMEOUT_MS);

try {
  await main();
} catch (error) {
  failures.push(`验证无法完成：${error.message}`);
} finally {
  clearTimeout(watchdog);
  cleanup();
}

if (failures.length) {
  console.error(`\n发现 ${failures.length} 个问题：`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}

console.log('\n✓ 浏览器验证通过');
console.log('  提示：chrome.tabs / chrome.permissions / offscreen 等扩展 API 需手动「加载解压缩的扩展」验证');
