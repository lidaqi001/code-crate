import test from 'node:test';
import assert from 'node:assert/strict';

import {
  base64Encode,
  base64Decode,
  toBase64Url,
  fromBase64Url,
  encodeUrlComponent,
  decodeUrlComponent,
  parseQueryString,
  encodeHtmlEntities,
  decodeHtmlEntities,
  textToHex,
  hexToText,
  textToBinary,
  binaryToText,
  base32Encode,
  base32Decode,
  unicodeEscape,
  unicodeUnescape,
  textToAsciiCodes,
  asciiCodesToText,
  md5,
  crc32,
  sha,
  decodeJwt,
  secondsUntilExpiry,
  toCamelCase,
  toPascalCase,
  toSnakeCase,
  toKebabCase,
  toConstantCase
} from '../src/tools/codec/logic.js';

/* ── Base64 ───────────────────────────────────────────────── */

test('Base64 往返包含中文与 emoji', () => {
  for (const text of ['', 'hello', '中文测试', 'a😀b', 'line1\nline2']) {
    assert.equal(base64Decode(base64Encode(text)), text);
  }
});

test('Base64 已知向量', () => {
  assert.equal(base64Encode('hello'), 'aGVsbG8=');
  assert.equal(base64Encode('中文'), '5Lit5paH');
  assert.equal(base64Decode('5Lit5paH'), '中文');
});

test('Base64 容忍空白、缺省填充与 URL-safe 字符', () => {
  assert.equal(base64Decode('aGVs\n bG8'), 'hello');
  assert.equal(base64Decode('aGVsbG8'), 'hello');
  assert.equal(base64Decode(toBase64Url(base64Encode('a?b>c'))), 'a?b>c');
  assert.equal(fromBase64Url('5Lit5paH'), '5Lit5paH');
});

test('Base64 非法输入抛出明确错误', () => {
  assert.throws(() => base64Decode('!!!!'), /Base64/);
  assert.throws(() => base64Decode('a'), /长度/);
});

/* ── URL ──────────────────────────────────────────────────── */

test('URL 编解码往返', () => {
  const raw = '中文 a&b=c?d/e';
  assert.equal(decodeUrlComponent(encodeUrlComponent(raw)), raw);
  assert.equal(encodeUrlComponent('中文'), '%E4%B8%AD%E6%96%87');
});

test('URL 解码对非法百分号转义给出错误', () => {
  assert.throws(() => decodeUrlComponent('%E4%B8'), /百分号/);
});

test('查询串解析支持重复键与加号空格', () => {
  const parsed = parseQueryString('?a=1&b=x+y&a=2&flag');
  assert.deepEqual(parsed, [
    { key: 'a', value: '1' },
    { key: 'b', value: 'x y' },
    { key: 'a', value: '2' },
    { key: 'flag', value: '' }
  ]);
});

/* ── HTML 实体 ────────────────────────────────────────────── */

test('HTML 实体编解码往返', () => {
  const raw = '<a href="x">&\'</a>';
  const encoded = encodeHtmlEntities(raw);
  assert.equal(encoded, '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.equal(decodeHtmlEntities(encoded), raw);
});

test('HTML 实体支持命名与数字形式', () => {
  assert.equal(decodeHtmlEntities('&#65;&#x4e2d;'), 'A中');
  assert.equal(decodeHtmlEntities('&copy;&nbsp;&hellip;'), '\u00a9\u00a0\u2026');
  assert.equal(decodeHtmlEntities('&unknown;'), '&unknown;');
  assert.equal(decodeHtmlEntities('&amp;lt;'), '&lt;');
});

/* ── 进制 ─────────────────────────────────────────────────── */

test('十六进制与二进制往返（含中文）', () => {
  const raw = 'Ab中';
  assert.equal(hexToText(textToHex(raw)), raw);
  assert.equal(binaryToText(textToBinary(raw)), raw);
  assert.equal(textToHex('A'), '41');
  assert.equal(textToBinary('A'), '01000001');
});

test('进制转换对非法输入给出错误', () => {
  assert.throws(() => hexToText('abc'), /偶数/);
  assert.throws(() => hexToText('zz'), /十六进制/);
  assert.throws(() => binaryToText('010'), /8 的倍数/);
  assert.throws(() => binaryToText('012'), /二进制/);
});

/* ── 哈希 ─────────────────────────────────────────────────── */

test('MD5 已知向量', () => {
  assert.equal(md5(''), 'd41d8cd98f00b204e9800998ecf8427e');
  assert.equal(md5('abc'), '900150983cd24fb0d6963f7d28e17f72');
  assert.equal(md5('message digest'), 'f96b697d7cb7938d525a2f31aaf161d0');
  assert.equal(md5('The quick brown fox jumps over the lazy dog'), '9e107d9d372bb6826bd81d3542a419d6');
});

test('MD5 处理跨块长度边界', () => {
  // 55 / 56 / 64 字节是填充算法最容易出错的位置
  assert.equal(md5('a'.repeat(55)).length, 32);
  assert.equal(md5('a'.repeat(56)).length, 32);
  assert.equal(md5('a'.repeat(64)).length, 32);
  assert.notEqual(md5('a'.repeat(55)), md5('a'.repeat(56)));
});

test('CRC32 已知向量', () => {
  assert.equal(crc32(''), '00000000');
  assert.equal(crc32('123456789'), 'cbf43926');
  assert.equal(crc32('The quick brown fox jumps over the lazy dog'), '414fa339');
});

test('SHA 已知向量', async () => {
  assert.equal(await sha('SHA-1', 'abc'), 'a9993e364706816aba3e25717850c26c9cd0d89d');
  assert.equal(await sha('SHA-256', 'abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(
    await sha('SHA-256', ''),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  );
  await assert.rejects(() => sha('MD5', 'abc'), /不支持/);
});

/* ── JWT ──────────────────────────────────────────────────── */

function makeJwt(header, payload, signature = 'sig') {
  const enc = (obj) => toBase64Url(base64Encode(JSON.stringify(obj)));
  return `${enc(header)}.${enc(payload)}.${signature}`;
}

test('JWT 解析 header 与 payload', () => {
  const token = makeJwt({ alg: 'HS256', typ: 'JWT' }, { sub: '123', name: '张三', exp: 4102444800 });
  const result = decodeJwt(token);
  assert.equal(result.ok, true);
  assert.equal(result.header.alg, 'HS256');
  assert.equal(result.payload.name, '张三');
  assert.equal(result.signed, true);
  assert.equal(result.expired, false);
  assert.ok(result.expiresAt instanceof Date);
});

test('JWT 识别已过期令牌', () => {
  const token = makeJwt({ alg: 'none' }, { exp: 1 });
  const result = decodeJwt(token);
  assert.equal(result.ok, true);
  assert.equal(result.expired, true);
  assert.ok(secondsUntilExpiry(result.payload) < 0);
});

test('JWT 非法输入返回错误而不是抛异常', () => {
  assert.equal(decodeJwt('onlyonepart').ok, false);
  assert.equal(decodeJwt('a.b').ok, false);
  assert.equal(secondsUntilExpiry({}), null);
});

/* ── 命名风格 ─────────────────────────────────────────────── */

test('命名风格转换', () => {
  for (const input of ['hello world', 'helloWorld', 'HelloWorld', 'hello-world', 'hello_world', 'HELLO_WORLD']) {
    assert.equal(toCamelCase(input), 'helloWorld', input);
    assert.equal(toPascalCase(input), 'HelloWorld', input);
    assert.equal(toSnakeCase(input), 'hello_world', input);
    assert.equal(toKebabCase(input), 'hello-world', input);
    assert.equal(toConstantCase(input), 'HELLO_WORLD', input);
  }
});

test('命名风格处理连续大写与数字', () => {
  assert.equal(toCamelCase('HTTPResponse code2'), 'httpResponseCode2');
  assert.equal(toSnakeCase('userId'), 'user_id');
});

/* ── Base32 ───────────────────────────────────────────────── */

test('Base32 编码符合 RFC 4648 官方向量', () => {
  const vectors = [
    ['', ''],
    ['f', 'MY======'],
    ['fo', 'MZXQ===='],
    ['foo', 'MZXW6==='],
    ['foob', 'MZXW6YQ='],
    ['fooba', 'MZXW6YTB'],
    ['foobar', 'MZXW6YTBOI======']
  ];
  for (const [plain, encoded] of vectors) {
    assert.equal(base32Encode(plain), encoded, plain);
    assert.equal(base32Decode(encoded), plain, encoded);
  }
});

test('Base32 往返包含中文与 emoji', () => {
  for (const text of ['', 'hello', '中文测试', 'a😀b', 'line1\nline2']) {
    assert.equal(base32Decode(base32Encode(text)), text);
  }
});

test('Base32 解码容忍空白、小写与缺省填充', () => {
  assert.equal(base32Decode('mzxw 6ytb'), 'fooba');
  assert.equal(base32Decode('MZXW6'), 'foo');
  assert.equal(base32Decode('mzxw6ytboi'), 'foobar');
});

test('Base32 非法输入抛出明确错误', () => {
  // RFC 4648 只允许长度 % 8 ∈ {0,2,4,5,7}，1/3/6 必然是截断或串了内容
  for (const bad of ['M', 'MZX', 'MZXW6Y']) {
    assert.throws(() => base32Decode(bad), /长度非法/, bad);
  }
  // 长度合法但含非法字符：这一条保证字符集检查不是死代码
  assert.throws(() => base32Decode('M*'), /不是合法的 Base32/);
});

/* ── Unicode 转义 ─────────────────────────────────────────── */

test('Unicode 转义编码为 \\uXXXX 形式', () => {
  assert.equal(unicodeEscape('中A'), '\\u4e2d\\u0041');
  assert.equal(unicodeEscape(''), '');
});

test('Unicode 转义对星芒面字符输出代理对', () => {
  // 😀 = U+1F600，必须拆成 😀，否则 JS / Java 的解析器读不回来
  assert.equal(unicodeEscape('😀'), '\\ud83d\\ude00');
});

test('Unicode 转义往返包含中文与 emoji', () => {
  for (const text of ['', 'hello', '中文测试', 'a😀b', '\n\t']) {
    assert.equal(unicodeUnescape(unicodeEscape(text)), text);
  }
});

test('Unicode 解码认三种写法', () => {
  assert.equal(unicodeUnescape('\\u4e2d\\u6587'), '中文');
  assert.equal(unicodeUnescape('\\u{4e2d}'), '中');
  assert.equal(unicodeUnescape('\\x41'), 'A');
  assert.equal(unicodeUnescape('\\ud83d\\ude00'), '😀');
});

test('Unicode 解码对认不出的转义原样保留', () => {
  assert.equal(unicodeUnescape('\\q\\n\\t'), '\\q\\n\\t');
  assert.equal(unicodeUnescape('没有转义'), '没有转义');
  // 越界码点不猜，原样留着
  assert.equal(unicodeUnescape('\\u{110000}'), '\\u{110000}');
});

/* ── ASCII 码 ─────────────────────────────────────────────── */

test('ASCII 码编解码往返', () => {
  for (const text of ['', 'Hello', '中文', 'a😀b']) {
    assert.equal(asciiCodesToText(textToAsciiCodes(text)), text);
  }
});

test('ASCII 码用十进制字节表示', () => {
  assert.equal(textToAsciiCodes('Hel'), '72 101 108');
  assert.equal(textToAsciiCodes('中'), '228 184 173');
  assert.equal(asciiCodesToText('72, 101, 108'), 'Hel');
  assert.equal(asciiCodesToText('72\n101'), 'He');
});

test('ASCII 码非法输入抛出明确错误', () => {
  assert.throws(() => asciiCodesToText('72 abc'), /不是合法的十进制字节/);
  assert.throws(() => asciiCodesToText('72 12x'), /不是合法的十进制字节/);
  assert.throws(() => asciiCodesToText('72 999'), /超出 0–255/);
});
