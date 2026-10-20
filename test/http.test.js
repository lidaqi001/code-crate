import test from 'node:test';
import assert from 'node:assert/strict';

import {
  tokenizeShell,
  parseCurl,
  parseHeaderLine,
  parseHeaderLines,
  headersToText,
  buildFetchSnippet,
  basicAuthEncode,
  basicAuthDecode,
  parseBasicAuthHeader,
  parseCookies,
  parseSetCookie,
  parseUrlParts,
  lookupStatus,
  prettyBody,
  statusClass,
  originPattern,
  STATUS_CODES,
  MIME_TYPES
} from '../src/tools/http/logic.js';

/* ── shell 词法分析 ───────────────────────────────────────── */

test('tokenizeShell 处理引号与转义', () => {
  assert.deepEqual(tokenizeShell('curl https://a.com'), ['curl', 'https://a.com']);
  assert.deepEqual(tokenizeShell(`curl -H 'A: b c' x`), ['curl', '-H', 'A: b c', 'x']);
  assert.deepEqual(tokenizeShell('curl -H "A: b c" x'), ['curl', '-H', 'A: b c', 'x']);
  assert.deepEqual(tokenizeShell('curl -d "a\\"b"'), ['curl', '-d', 'a"b']);
});

test('tokenizeShell 支持反斜杠续行', () => {
  const command = 'curl -X POST \\\n  -H "A: 1" \\\n  https://a.com';
  assert.deepEqual(tokenizeShell(command), ['curl', '-X', 'POST', '-H', 'A: 1', 'https://a.com']);
});

test('tokenizeShell 保留空字符串参数', () => {
  assert.deepEqual(tokenizeShell(`curl -d '' x`), ['curl', '-d', '', 'x']);
});

/* ── cURL 解析（旧版本在这里必然崩溃） ────────────────────── */

test('parseCurl 解析基础 GET', () => {
  const result = parseCurl('curl https://api.example.com/users');
  assert.equal(result.ok, true);
  assert.equal(result.request.method, 'GET');
  assert.equal(result.request.url, 'https://api.example.com/users');
  assert.deepEqual(result.request.headers, []);
});

test('parseCurl 解析带 Header 的 POST 与 JSON 体', () => {
  const result = parseCurl(
    `curl -X POST https://api.example.com/users -H "Content-Type: application/json" -H "Authorization: Bearer t" -d '{"name":"Ada"}'`
  );
  assert.equal(result.ok, true);
  assert.equal(result.request.method, 'POST');
  assert.equal(result.request.url, 'https://api.example.com/users');
  assert.deepEqual(result.request.headers, [
    { name: 'Content-Type', value: 'application/json' },
    { name: 'Authorization', value: 'Bearer t' }
  ]);
  assert.equal(result.request.body, '{"name":"Ada"}');
});

test('parseCurl 在只有 -d 时推断为 POST', () => {
  const result = parseCurl(`curl https://a.com -d 'x=1'`);
  assert.equal(result.ok, true);
  assert.equal(result.request.method, 'POST');
});

test('parseCurl 支持多行续行写法（真实复制场景）', () => {
  const command = [
    'curl -X PUT "https://api.example.com/items/1" \\',
    `  -H 'Content-Type: application/json' \\`,
    `  -H 'X-Trace: abc' \\`,
    `  --data-raw '{"title":"hello"}'`
  ].join('\n');
  const result = parseCurl(command);
  assert.equal(result.ok, true);
  assert.equal(result.request.method, 'PUT');
  assert.equal(result.request.headers.length, 2);
  assert.equal(result.request.body, '{"title":"hello"}');
});

test('parseCurl 处理 -u 生成 Basic 鉴权头', () => {
  const result = parseCurl('curl -u user:pass https://a.com');
  assert.equal(result.ok, true);
  const auth = result.request.headers.find((header) => header.name === 'Authorization');
  assert.equal(auth.value, `Basic ${basicAuthEncode('user:pass')}`);
});

test('parseCurl 处理 cookie 与 user-agent 简写', () => {
  const result = parseCurl(`curl -b 'a=1; b=2' -A 'CodeCrate/2.0' https://a.com`);
  assert.equal(result.ok, true);
  assert.equal(result.request.headers.find((h) => h.name === 'Cookie').value, 'a=1; b=2');
  assert.equal(result.request.headers.find((h) => h.name === 'User-Agent').value, 'CodeCrate/2.0');
});

test('parseCurl 补齐缺失的协议', () => {
  assert.equal(parseCurl('curl example.com/api').request.url, 'https://example.com/api');
});

test('parseCurl 忽略不影响语义的开关', () => {
  const result = parseCurl('curl -sSL --compressed -k https://a.com');
  assert.equal(result.ok, true);
  assert.equal(result.request.url, 'https://a.com');
  assert.ok(result.request.ignoredFlags.includes('-sSL'));
  assert.ok(result.request.ignoredFlags.includes('--compressed'));
});

test('parseCurl 跳过值的开关不会把值当 URL', () => {
  const result = parseCurl('curl -o /tmp/out.json --max-time 5 https://a.com/data');
  assert.equal(result.ok, true);
  assert.equal(result.request.url, 'https://a.com/data');
});

test('parseCurl 支持紧贴写法 -H"A: b"', () => {
  const result = parseCurl('curl -H"A: b" https://a.com');
  assert.equal(result.ok, true);
  assert.deepEqual(result.request.headers, [{ name: 'A', value: 'b' }]);
});

test('parseCurl 对异常输入返回错误而不是抛异常', () => {
  assert.equal(parseCurl('').ok, false);
  assert.equal(parseCurl('   ').ok, false);
  assert.equal(parseCurl('echo hello').ok, false);
  assert.match(parseCurl('echo hello').error, /不是 curl/);
  assert.equal(parseCurl('curl -X').ok, false);
  assert.match(parseCurl('curl -X').error, /缺少参数/);
  assert.equal(parseCurl('curl -H "A: 1"').ok, false);
  assert.match(parseCurl('curl -H "A: 1"').error, /没有找到 URL/);
});

test('parseCurl 支持 --data-urlencode', () => {
  const result = parseCurl('curl --data-urlencode "q=hello world" https://a.com');
  assert.equal(result.ok, true);
  assert.equal(result.request.body, 'q=hello%20world');
});

/* ── Header 解析 ──────────────────────────────────────────── */

test('parseHeaderLine 解析与拒绝', () => {
  assert.deepEqual(parseHeaderLine('Content-Type: application/json'), { name: 'Content-Type', value: 'application/json' });
  assert.deepEqual(parseHeaderLine('X-Empty:'), { name: 'X-Empty', value: '' });
  assert.equal(parseHeaderLine('no-colon'), null);
  assert.equal(parseHeaderLine(': value'), null);
});

test('parseHeaderLines 汇总错误行', () => {
  const { headers, errors } = parseHeaderLines('A: 1\n\nbad-line\nB: 2');
  assert.equal(headers.length, 2);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /bad-line/);
});

test('headersToText 与 parseHeaderLines 往返', () => {
  const text = 'A: 1\nB: 2';
  assert.equal(headersToText(parseHeaderLines(text).headers), text);
});

/* ── fetch 片段 ───────────────────────────────────────────── */

test('buildFetchSnippet 生成可读代码', () => {
  const snippet = buildFetchSnippet({
    method: 'POST',
    url: 'https://a.com',
    headers: [{ name: 'Content-Type', value: 'application/json' }],
    body: '{"a":1}'
  });
  assert.match(snippet, /await fetch\("https:\/\/a\.com"/);
  assert.match(snippet, /method: "POST"/);
  assert.match(snippet, /"Content-Type": "application\/json"/);
  assert.match(snippet, /body: "\{\\"a\\":1\}"/);
});

test('buildFetchSnippet 对 GET 不输出 body', () => {
  const snippet = buildFetchSnippet({ method: 'GET', url: 'https://a.com', headers: [], body: 'x' });
  assert.equal(snippet.includes('body'), false);
});

/* ── 鉴权与 Cookie ────────────────────────────────────────── */

test('Basic 鉴权编解码往返（含中文）', () => {
  const encoded = basicAuthEncode('用户名:密码');
  assert.equal(basicAuthDecode(encoded), '用户名:密码');
  assert.equal(basicAuthEncode('user:pass'), 'dXNlcjpwYXNz');
});

test('parseBasicAuthHeader 解析与报错', () => {
  const result = parseBasicAuthHeader(`Basic ${basicAuthEncode('admin:secret')}`);
  assert.equal(result.ok, true);
  assert.equal(result.user, 'admin');
  assert.equal(result.password, 'secret');

  assert.equal(parseBasicAuthHeader('Bearer x').ok, false);
  assert.equal(parseBasicAuthHeader('Basic !!!').ok, false);
});

test('parseBasicAuthHeader 处理没有冒号的凭据', () => {
  const result = parseBasicAuthHeader(`Basic ${basicAuthEncode('tokenonly')}`);
  assert.equal(result.user, 'tokenonly');
  assert.equal(result.password, '');
});

test('parseCookies 解析请求 Cookie', () => {
  assert.deepEqual(parseCookies('a=1; b=2; flag'), [
    { name: 'a', value: '1' },
    { name: 'b', value: '2' },
    { name: 'flag', value: '' }
  ]);
  assert.deepEqual(parseCookies(''), []);
});

test('parseSetCookie 提取常见属性', () => {
  const cookie = parseSetCookie('sid=abc123; Path=/; Domain=example.com; HttpOnly; Secure; SameSite=Lax; Max-Age=3600');
  assert.equal(cookie.name, 'sid');
  assert.equal(cookie.value, 'abc123');
  assert.equal(cookie.path, '/');
  assert.equal(cookie.domain, 'example.com');
  assert.equal(cookie.httpOnly, true);
  assert.equal(cookie.secure, true);
  assert.equal(cookie.sameSite, 'Lax');
  assert.equal(cookie.maxAge, '3600');
});

/* ── URL 解析 ─────────────────────────────────────────────── */

test('parseUrlParts 拆分各部分与查询参数', () => {
  const result = parseUrlParts('https://user@example.com:8443/a/b?x=1&y=2#frag');
  assert.equal(result.ok, true);
  assert.equal(result.protocol, 'https:');
  assert.equal(result.host, 'example.com:8443');
  assert.equal(result.hostname, 'example.com');
  assert.equal(result.port, '8443');
  assert.equal(result.pathname, '/a/b');
  assert.equal(result.hash, '#frag');
  assert.deepEqual(result.params, [{ key: 'x', value: '1' }, { key: 'y', value: '2' }]);
});

test('parseUrlParts 对非法输入给出提示', () => {
  assert.equal(parseUrlParts('').ok, false);
  assert.equal(parseUrlParts('not a url').ok, false);
  assert.match(parseUrlParts('example.com').error, /http/);
});

test('originPattern 只接受 http 与 https', () => {
  assert.equal(originPattern('https://api.example.com/v1/x'), 'https://api.example.com/*');
  assert.equal(originPattern('http://localhost:3000/a'), 'http://localhost/*');
  assert.equal(originPattern('https://example.com:8443/x'), 'https://example.com/*');
  assert.equal(originPattern('ftp://a.com'), null);
  assert.equal(originPattern('nonsense'), null);
});

/* ── 状态码与 MIME ────────────────────────────────────────── */

test('状态码表完整且查询可用', () => {
  assert.ok(STATUS_CODES.length > 30);
  assert.equal(lookupStatus(200).name, 'OK');
  assert.equal(lookupStatus(404).name, 'Not Found');
  assert.equal(lookupStatus(429).name, 'Too Many Requests');
  assert.equal(lookupStatus(999), null);
  assert.equal(lookupStatus('abc'), null);
  // 按码值升序，便于阅读
  for (let i = 1; i < STATUS_CODES.length; i += 1) {
    assert.ok(STATUS_CODES[i].code > STATUS_CODES[i - 1].code);
  }
});

test('statusClass 按区间归类', () => {
  assert.equal(statusClass(200), 'ok');
  assert.equal(statusClass(301), 'warn');
  assert.equal(statusClass(404), 'err');
  assert.equal(statusClass(500), 'err');
});

test('MIME 表包含常用类型', () => {
  const types = MIME_TYPES.map((entry) => entry.type);
  for (const expected of ['application/json', 'text/plain', 'image/png', 'application/octet-stream']) {
    assert.ok(types.includes(expected), expected);
  }
  assert.ok(MIME_TYPES.every((entry) => entry.type.includes('/') && entry.note));
});

/* ── 响应体处理 ───────────────────────────────────────────── */

test('prettyBody 自动格式化 JSON', () => {
  const result = prettyBody('{"a":1,"b":[2,3]}', 'application/json');
  assert.equal(result.wasJson, true);
  assert.equal(result.formatted, '{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}');
});

test('prettyBody 依据内容而非仅靠 Content-Type 判断', () => {
  assert.equal(prettyBody('{"a":1}', '').wasJson, true);
  assert.equal(prettyBody('not json', 'application/json').wasJson, false);
  assert.equal(prettyBody('plain text', 'text/plain').formatted, 'plain text');
});
