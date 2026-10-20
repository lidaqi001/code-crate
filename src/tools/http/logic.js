/* HTTP / cURL 辅助 —— 纯逻辑层。
 * cURL 解析用完整的 shell 词法分析实现（旧版本因为变量提升问题必然崩溃）。 */

/* ── shell 词法分析 ───────────────────────────────────────── */

/** 按 shell 规则切分命令：支持单引号、双引号、反斜杠转义与续行。 */
export function tokenizeShell(input) {
  const text = String(input ?? '').replace(/\\\r?\n/g, ' ');
  const tokens = [];
  let current = '';
  let inToken = false;
  let quote = null;

  const push = () => {
    if (inToken) {
      tokens.push(current);
      current = '';
      inToken = false;
    }
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (quote === "'") {
      if (char === "'") quote = null;
      else current += char;
      continue;
    }

    if (quote === '"') {
      if (char === '"') {
        quote = null;
      } else if (char === '\\' && i + 1 < text.length && '"\\$`'.includes(text[i + 1])) {
        current += text[i + 1];
        i += 1;
      } else {
        current += char;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      inToken = true;
      continue;
    }

    if (char === '\\' && i + 1 < text.length) {
      current += text[i + 1];
      inToken = true;
      i += 1;
      continue;
    }

    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      push();
      continue;
    }

    current += char;
    inToken = true;
  }

  push();
  return tokens;
}

/* ── Header 解析 ──────────────────────────────────────────── */

export function parseHeaderLine(line) {
  const index = String(line).indexOf(':');
  if (index <= 0) return null;
  const name = String(line).slice(0, index).trim();
  const value = String(line).slice(index + 1).trim();
  if (!name) return null;
  return { name, value };
}

/** 解析多行 Header 文本。 */
export function parseHeaderLines(text) {
  const headers = [];
  const errors = [];
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const header = parseHeaderLine(line);
    if (header) headers.push(header);
    else errors.push(`无法解析：${line}`);
  }
  return { headers, errors };
}

export function headersToText(headers) {
  return (headers || []).map((header) => `${header.name}: ${header.value}`).join('\n');
}

/* ── cURL ─────────────────────────────────────────────────── */

const VALUE_FLAGS = new Set([
  '-X', '--request', '-H', '--header', '-d', '--data', '--data-raw', '--data-binary', '--data-ascii',
  '--data-urlencode', '-u', '--user', '-b', '--cookie', '-F', '--form', '-A', '--user-agent',
  '-e', '--referer', '-o', '--output', '--max-time', '-m', '--connect-timeout', '-w', '--write-out',
  '--proxy', '-x', '--cacert', '--cert', '--key', '-T', '--upload-file', '--url', '--retry',
  '--header-file', '--resolve', '--interface'
]);

const SHORT_WITH_VALUE = /^(-X|-H|-d|-u|-b|-F|-A|-e|-o|-m|-x|-T)/;

/**
 * 解析 curl 命令。
 * @returns {{ok:true, request:object}|{ok:false, error:string}}
 */
export function parseCurl(command) {
  const tokens = tokenizeShell(command);
  if (!tokens.length) return { ok: false, error: '命令为空' };

  let index = tokens.findIndex((token) => /(^|[/\\])curl(\.exe)?$/i.test(token));
  if (index < 0) {
    const looksLikeCurl = tokens.some((token) => token.startsWith('-'));
    if (!looksLikeCurl) return { ok: false, error: '看起来不是 curl 命令' };
    index = 0;
  } else {
    index += 1;
  }

  const request = {
    method: '',
    url: '',
    headers: [],
    body: null,
    user: '',
    cookies: '',
    formFields: [],
    ignoredFlags: []
  };
  let explicitMethod = false;

  for (let i = index; i < tokens.length; i += 1) {
    let token = tokens[i];
    let inlineValue = null;

    // 处理 -H"..." 这类紧贴写法
    if (token.startsWith('-') && !token.startsWith('--') && token.length > 2 && SHORT_WITH_VALUE.test(token)) {
      inlineValue = token.slice(2);
      token = token.slice(0, 2);
    }

    const readValue = () => {
      if (inlineValue !== null) return inlineValue;
      const value = tokens[i + 1];
      return value === undefined ? null : value;
    };
    const consume = () => {
      if (inlineValue === null) i += 1;
    };

    if (token === '-X' || token === '--request') {
      const value = readValue();
      if (value === null) return { ok: false, error: `${token} 缺少参数` };
      request.method = value.toUpperCase();
      explicitMethod = true;
      consume();
      continue;
    }

    if (token === '-H' || token === '--header') {
      const value = readValue();
      if (value === null) return { ok: false, error: `${token} 缺少参数` };
      const header = parseHeaderLine(value);
      if (header) request.headers.push(header);
      consume();
      continue;
    }

    if (['-d', '--data', '--data-raw', '--data-binary', '--data-ascii'].includes(token)) {
      const value = readValue();
      if (value === null) return { ok: false, error: `${token} 缺少参数` };
      request.body = value;
      consume();
      continue;
    }

    if (token === '--data-urlencode') {
      const value = readValue();
      if (value === null) return { ok: false, error: '--data-urlencode 缺少参数' };
      const [name, ...rest] = value.split('=');
      const encoded = rest.length ? `${name}=${encodeURIComponent(rest.join('='))}` : encodeURIComponent(value);
      request.body = request.body === null ? encoded : `${request.body}&${encoded}`;
      consume();
      continue;
    }

    if (token === '-u' || token === '--user') {
      const value = readValue();
      if (value === null) return { ok: false, error: `${token} 缺少参数` };
      request.user = value;
      consume();
      continue;
    }

    if (token === '-b' || token === '--cookie') {
      const value = readValue();
      if (value === null) return { ok: false, error: `${token} 缺少参数` };
      request.cookies = value;
      consume();
      continue;
    }

    if (token === '-F' || token === '--form') {
      const value = readValue();
      if (value === null) return { ok: false, error: '-F 缺少参数' };
      request.formFields.push(value);
      consume();
      continue;
    }

    if (token === '-A' || token === '--user-agent') {
      const value = readValue();
      if (value === null) return { ok: false, error: `${token} 缺少参数` };
      request.headers.push({ name: 'User-Agent', value });
      consume();
      continue;
    }

    if (token === '-e' || token === '--referer') {
      const value = readValue();
      if (value === null) return { ok: false, error: `${token} 缺少参数` };
      request.headers.push({ name: 'Referer', value });
      consume();
      continue;
    }

    if (token === '--url') {
      const value = readValue();
      if (value === null) return { ok: false, error: '--url 缺少参数' };
      if (!request.url) request.url = value;
      consume();
      continue;
    }

    if (token.startsWith('-')) {
      if (VALUE_FLAGS.has(token) && inlineValue === null) i += 1;
      request.ignoredFlags.push(token);
      continue;
    }

    if (!request.url) request.url = token;
    else request.ignoredFlags.push(token);
  }

  if (!request.url) return { ok: false, error: '没有找到 URL' };

  const withoutProtocol = request.url.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '');
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(request.url)) {
    request.url = `https://${withoutProtocol}`;
  }

  if (!explicitMethod) {
    request.method = request.body !== null || request.formFields.length ? 'POST' : 'GET';
  }

  if (request.cookies) {
    const exists = request.headers.some((header) => header.name.toLowerCase() === 'cookie');
    if (!exists) request.headers.push({ name: 'Cookie', value: request.cookies });
  }

  if (request.user) {
    const exists = request.headers.some((header) => header.name.toLowerCase() === 'authorization');
    if (!exists) request.headers.push({ name: 'Authorization', value: `Basic ${basicAuthEncode(request.user)}` });
  }

  return { ok: true, request };
}

/** 由请求对象生成 fetch 代码片段，方便贴回项目里。 */
export function buildFetchSnippet({ method = 'GET', url = '', headers = [], body = null }) {
  const options = { method };
  if (headers.length) {
    const lines = headers.map((header) => `    ${JSON.stringify(header.name)}: ${JSON.stringify(header.value)}`).join(',\n');
    options.headers = `{\n${lines}\n  }`;
  }
  if (body !== null && body !== '' && method !== 'GET' && method !== 'HEAD') options.body = JSON.stringify(body);

  const parts = [`  method: ${JSON.stringify(method)}`];
  if (options.headers) parts.push(`  headers: ${options.headers}`);
  if (options.body !== undefined) parts.push(`  body: ${options.body}`);

  return `const response = await fetch(${JSON.stringify(url)}, {\n${parts.join(',\n')}\n});\nconst data = await response.json();`;
}

/* ── 鉴权与 Cookie ────────────────────────────────────────── */

export function basicAuthEncode(userPassword) {
  const text = String(userPassword ?? '');
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function basicAuthDecode(base64) {
  let binary;
  try {
    binary = atob(String(base64 ?? '').trim());
  } catch {
    throw new Error('不是合法的 Base64');
  }
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function parseBasicAuthHeader(value) {
  const raw = String(value ?? '').trim();
  const match = /^Basic\s+(.+)$/i.exec(raw);
  if (!match) return { ok: false, error: '不是 Basic 鉴权头' };
  try {
    const decoded = basicAuthDecode(match[1]);
    const index = decoded.indexOf(':');
    const user = index < 0 ? decoded : decoded.slice(0, index);
    const password = index < 0 ? '' : decoded.slice(index + 1);
    return { ok: true, user, password, base64: match[1] };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

export function parseCookies(text) {
  const out = [];
  for (const part of String(text ?? '').split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const index = trimmed.indexOf('=');
    if (index < 0) out.push({ name: trimmed, value: '' });
    else out.push({ name: trimmed.slice(0, index).trim(), value: trimmed.slice(index + 1).trim() });
  }
  return out;
}

/** 解析 Set-Cookie 响应头，提取常用属性。 */
export function parseSetCookie(value) {
  const [pair, ...attributes] = String(value ?? '').split(';').map((part) => part.trim());
  const index = pair.indexOf('=');
  const cookie = {
    name: index < 0 ? pair : pair.slice(0, index),
    value: index < 0 ? '' : pair.slice(index + 1),
    path: '',
    domain: '',
    expires: '',
    maxAge: '',
    httpOnly: false,
    secure: false,
    sameSite: ''
  };

  for (const attribute of attributes) {
    const eq = attribute.indexOf('=');
    const key = (eq < 0 ? attribute : attribute.slice(0, eq)).trim().toLowerCase();
    const attrValue = eq < 0 ? '' : attribute.slice(eq + 1).trim();
    if (key === 'path') cookie.path = attrValue;
    else if (key === 'domain') cookie.domain = attrValue;
    else if (key === 'expires') cookie.expires = attrValue;
    else if (key === 'max-age') cookie.maxAge = attrValue;
    else if (key === 'httponly') cookie.httpOnly = true;
    else if (key === 'secure') cookie.secure = true;
    else if (key === 'samesite') cookie.sameSite = attrValue;
  }
  return cookie;
}

/* ── URL 解析 ─────────────────────────────────────────────── */

export function parseUrlParts(input) {
  const text = String(input ?? '').trim();
  if (!text) return { ok: false, error: 'URL 为空' };
  let url;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, error: '无法解析为合法 URL（记得带 http:// 或 https://）' };
  }

  return {
    ok: true,
    protocol: url.protocol,
    host: url.host,
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? '443（默认）' : url.protocol === 'http:' ? '80（默认）' : ''),
    pathname: url.pathname,
    search: url.search,
    hash: url.hash,
    origin: url.origin,
    username: url.username,
    params: [...url.searchParams.entries()].map(([key, value]) => ({ key, value }))
  };
}

/* ── 状态码 / MIME 速查 ───────────────────────────────────── */

export const STATUS_CODES = [
  { code: 100, name: 'Continue', note: '客户端可以继续发送请求体' },
  { code: 101, name: 'Switching Protocols', note: '服务端同意切换协议（如 WebSocket）' },
  { code: 200, name: 'OK', note: '请求成功' },
  { code: 201, name: 'Created', note: '资源创建成功，通常用于 POST' },
  { code: 202, name: 'Accepted', note: '已接受但尚未处理完成' },
  { code: 204, name: 'No Content', note: '成功但没有响应体，常用于 DELETE / PUT' },
  { code: 206, name: 'Partial Content', note: '范围请求成功，用于断点续传' },
  { code: 301, name: 'Moved Permanently', note: '永久重定向，搜索引擎会更新索引' },
  { code: 302, name: 'Found', note: '临时重定向，历史原因常被误用' },
  { code: 303, name: 'See Other', note: '用 GET 去访问另一个地址' },
  { code: 304, name: 'Not Modified', note: '缓存仍有效，响应不带正文' },
  { code: 307, name: 'Temporary Redirect', note: '临时重定向且保持原方法' },
  { code: 308, name: 'Permanent Redirect', note: '永久重定向且保持原方法' },
  { code: 400, name: 'Bad Request', note: '请求格式有误，服务端无法理解' },
  { code: 401, name: 'Unauthorized', note: '缺少或无效的认证凭据' },
  { code: 403, name: 'Forbidden', note: '身份已知但无权访问' },
  { code: 404, name: 'Not Found', note: '资源不存在' },
  { code: 405, name: 'Method Not Allowed', note: '该路径不支持此方法' },
  { code: 406, name: 'Not Acceptable', note: '无法满足 Accept 头要求' },
  { code: 408, name: 'Request Timeout', note: '客户端发送请求超时' },
  { code: 409, name: 'Conflict', note: '与资源当前状态冲突' },
  { code: 410, name: 'Gone', note: '资源已被永久删除' },
  { code: 412, name: 'Precondition Failed', note: '前置条件不满足（如 If-Match）' },
  { code: 413, name: 'Payload Too Large', note: '请求体超过服务端限制' },
  { code: 415, name: 'Unsupported Media Type', note: '请求体的媒体类型不被支持' },
  { code: 418, name: "I'm a teapot", note: '愚人节彩蛋，被广泛实现' },
  { code: 422, name: 'Unprocessable Entity', note: '语义错误，常见于表单校验失败' },
  { code: 429, name: 'Too Many Requests', note: '触发限流，请退避重试' },
  { code: 500, name: 'Internal Server Error', note: '服务端内部错误' },
  { code: 501, name: 'Not Implemented', note: '服务端不支持该功能' },
  { code: 502, name: 'Bad Gateway', note: '网关收到上游的无效响应' },
  { code: 503, name: 'Service Unavailable', note: '服务暂不可用（过载或维护）' },
  { code: 504, name: 'Gateway Timeout', note: '网关等待上游超时' },
  { code: 505, name: 'HTTP Version Not Supported', note: '不支持的 HTTP 版本' }
];

export function lookupStatus(code) {
  const value = Number(code);
  if (!Number.isInteger(value)) return null;
  return STATUS_CODES.find((entry) => entry.code === value) || null;
}

export const MIME_TYPES = [
  { type: 'text/plain', ext: '.txt', note: '纯文本' },
  { type: 'text/html', ext: '.html', note: 'HTML 文档' },
  { type: 'text/css', ext: '.css', note: '样式表' },
  { type: 'text/csv', ext: '.csv', note: '逗号分隔值' },
  { type: 'text/markdown', ext: '.md', note: 'Markdown' },
  { type: 'text/event-stream', ext: '', note: 'SSE 事件流' },
  { type: 'application/json', ext: '.json', note: 'JSON 数据' },
  { type: 'application/ld+json', ext: '.jsonld', note: 'JSON-LD' },
  { type: 'application/xml', ext: '.xml', note: 'XML' },
  { type: 'application/javascript', ext: '.js', note: 'JavaScript' },
  { type: 'application/pdf', ext: '.pdf', note: 'PDF 文档' },
  { type: 'application/zip', ext: '.zip', note: 'ZIP 压缩包' },
  { type: 'application/gzip', ext: '.gz', note: 'Gzip 压缩' },
  { type: 'application/octet-stream', ext: '.bin', note: '二进制流（默认下载）' },
  { type: 'application/x-www-form-urlencoded', ext: '', note: '表单提交' },
  { type: 'multipart/form-data', ext: '', note: '含文件的表单' },
  { type: 'application/wasm', ext: '.wasm', note: 'WebAssembly' },
  { type: 'image/png', ext: '.png', note: 'PNG 图片' },
  { type: 'image/jpeg', ext: '.jpg', note: 'JPEG 图片' },
  { type: 'image/gif', ext: '.gif', note: 'GIF 图片' },
  { type: 'image/webp', ext: '.webp', note: 'WebP 图片' },
  { type: 'image/svg+xml', ext: '.svg', note: 'SVG 矢量图' },
  { type: 'image/avif', ext: '.avif', note: 'AVIF 图片' },
  { type: 'audio/mpeg', ext: '.mp3', note: 'MP3 音频' },
  { type: 'audio/ogg', ext: '.ogg', note: 'Ogg 音频' },
  { type: 'video/mp4', ext: '.mp4', note: 'MP4 视频' },
  { type: 'video/webm', ext: '.webm', note: 'WebM 视频' },
  { type: 'font/woff2', ext: '.woff2', note: 'Web 字体' },
  { type: 'application/vnd.api+json', ext: '', note: 'JSON:API' },
  { type: 'application/x-ndjson', ext: '.ndjson', note: '按行 JSON' }
];

/* ── 请求 / 响应辅助 ─────────────────────────────────────── */

/** 判断内容类型是否为 JSON，并可自动格式化。 */
export function prettyBody(text, contentType = '') {
  const source = String(text ?? '');
  if (/json/i.test(contentType) || /^\s*[[{]/.test(source)) {
    try {
      return { formatted: JSON.stringify(JSON.parse(source), null, 2), wasJson: true };
    } catch {
      return { formatted: source, wasJson: false };
    }
  }
  return { formatted: source, wasJson: false };
}

export function statusClass(code) {
  if (code >= 200 && code < 300) return 'ok';
  if (code >= 300 && code < 400) return 'warn';
  if (code >= 400 && code < 500) return 'err';
  if (code >= 500) return 'err';
  return '';
}

/** 由授权来源列表构造用于 chrome.permissions 的匹配模式。 */
export function originPattern(url) {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  // Chrome 的 host 权限模式不支持端口；申请覆盖整个主机，端口仍可正常访问
  return `${parsed.protocol}//${parsed.hostname}/*`;
}
