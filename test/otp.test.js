import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import {
  hotp,
  totp,
  verifyTotp,
  totpCounter,
  totpRemaining,
  counterToBytes,
  base32Encode,
  base32Decode,
  parseSecret,
  parseOtpAuthUri,
  buildOtpAuthUri,
  convertSecret,
  describeSecret,
  SECRET_FORMATS,
  OTP_ALGORITHMS,
  DIGIT_OPTIONS
} from '../src/tools/otp/logic.js';
import { textToBytes, bytesToHex } from '../src/core/bytes.js';

/* ══════════════ node:crypto 参照实现（独立 oracle） ══════════════ */

function nodeHotp(key, counter, digits = 6, algorithm = 'sha1') {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const hash = createHmac(algorithm, Buffer.from(key)).update(buffer).digest();
  const offset = hash[hash.length - 1] & 0x0f;
  const binary =
    ((hash[offset] & 0x7f) << 24) |
    ((hash[offset + 1] & 0xff) << 16) |
    ((hash[offset + 2] & 0xff) << 8) |
    (hash[offset + 3] & 0xff);
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/* ── Base32 ───────────────────────────────────────────────── */

test('Base32 编解码往返', () => {
  const samples = ['', 'f', 'fo', 'foo', 'foob', 'fooba', 'foobar', '中文内容', 'a'.repeat(64)];
  for (const sample of samples) {
    const bytes = textToBytes(sample);
    assert.equal(bytesToHex(base32Decode(base32Encode(bytes))), bytesToHex(bytes), sample);
  }
});

test('Base32 符合 RFC 4648 测试向量', () => {
  assert.equal(base32Encode(textToBytes('')), '');
  assert.equal(base32Encode(textToBytes('f')), 'MY');
  assert.equal(base32Encode(textToBytes('fo')), 'MZXQ');
  assert.equal(base32Encode(textToBytes('foo')), 'MZXW6');
  assert.equal(base32Encode(textToBytes('foob')), 'MZXW6YQ');
  assert.equal(base32Encode(textToBytes('fooba')), 'MZXW6YTB');
  assert.equal(base32Encode(textToBytes('foobar')), 'MZXW6YTBOI');
});

test('Base32 容忍空格、小写与填充', () => {
  assert.equal(bytesToHex(base32Decode('mzxw6ytboi')), bytesToHex(textToBytes('foobar')));
  assert.equal(bytesToHex(base32Decode('MZXW 6YTB OI==')), bytesToHex(textToBytes('foobar')));
});

test('Base32 非法字符报错', () => {
  assert.throws(() => base32Decode('MZXW1'), /不是合法的 Base32 字符/);
  assert.throws(() => base32Decode('0189'), /不是合法的 Base32 字符/);
});

/* ── HOTP：RFC 4226 官方向量 ──────────────────────────────── */

test('HOTP 符合 RFC 4226 全部测试向量', async () => {
  // RFC 4226 用 ASCII 的 "12345678901234567890" 作为共享密钥
  const secret = textToBytes('12345678901234567890');
  const expected = [
    '755224', '287082', '359152', '969429', '338314',
    '254676', '287922', '162583', '399871', '520489'
  ];

  for (let counter = 0; counter < expected.length; counter += 1) {
    const code = await hotp({ secret, counter, digits: 6 });
    assert.equal(code, expected[counter], `counter=${counter}`);
  }
});

test('HOTP 与 node:crypto 一致（全部算法与位数）', async () => {
  const secret = textToBytes('codecrate-otp-secret-key');

  for (const [algorithm, nodeName] of [['SHA-1', 'sha1'], ['SHA-256', 'sha256'], ['SHA-512', 'sha512']]) {
    for (const digits of DIGIT_OPTIONS) {
      for (const counter of [0, 1, 42, 999999]) {
        const mine = await hotp({ secret, counter, digits, algorithm });
        assert.equal(mine, nodeHotp(secret, counter, digits, nodeName), `${algorithm}/${digits}/${counter}`);
      }
    }
  }
});

test('HOTP 计数器的字节表示是 8 字节大端', () => {
  assert.equal(bytesToHex(counterToBytes(0)), '0000000000000000');
  assert.equal(bytesToHex(counterToBytes(1)), '0000000000000001');
  assert.equal(bytesToHex(counterToBytes(256)), '0000000000000100');
  assert.equal(bytesToHex(counterToBytes(2 ** 32)), '0000000100000000');
  assert.throws(() => counterToBytes(-1), /不能为负/);
});

test('HOTP 支持超大计数器（超过 2^53）', async () => {
  const secret = textToBytes('secret');
  const counter = 2 ** 53 + 12345;
  const mine = await hotp({ secret, counter, digits: 8 });
  assert.equal(mine, nodeHotp(secret, counter, 8, 'sha1'));
});

/* ── TOTP：RFC 6238 官方向量 ──────────────────────────────── */

test('TOTP 符合 RFC 6238 SHA-1 测试向量', async () => {
  const secret = textToBytes('12345678901234567890');
  const vectors = [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130']
  ];

  for (const [seconds, expected] of vectors) {
    const code = await totp({ secret, timestamp: seconds * 1000, digits: 8 });
    assert.equal(code, expected, `T=${seconds}`);
  }
});

test('TOTP 符合 RFC 6238 SHA-256 与 SHA-512 向量', async () => {
  const secret256 = textToBytes('12345678901234567890123456789012');
  assert.equal(await totp({ secret: secret256, timestamp: 59000, digits: 8, algorithm: 'SHA-256' }), '46119246');

  const secret512 = textToBytes('1234567890123456789012345678901234567890123456789012345678901234');
  assert.equal(await totp({ secret: secret512, timestamp: 59000, digits: 8, algorithm: 'SHA-512' }), '90693936');
});

test('TOTP 与 node:crypto 一致', async () => {
  const secret = textToBytes('another-secret-value');
  for (const timestamp of [0, 59000, 1700000000000, 2000000000000]) {
    for (const period of [15, 30, 60]) {
      const counter = Math.floor(timestamp / 1000 / period);
      const mine = await totp({ secret, timestamp, period, digits: 6 });
      assert.equal(mine, nodeHotp(secret, counter, 6, 'sha1'), `${timestamp}/${period}`);
    }
  }
});

test('计数器与剩余时间计算', () => {
  assert.equal(totpCounter(0, 30), 0);
  assert.equal(totpCounter(29000, 30), 0);
  assert.equal(totpCounter(30000, 30), 1);
  assert.equal(totpCounter(59000, 30), 1);

  assert.equal(totpRemaining(0, 30), 30);
  assert.equal(totpRemaining(29000, 30), 1);
  assert.equal(totpRemaining(30000, 30), 30);

  assert.throws(() => totpCounter(0, 0), /正数/);
});

/* ── 参数校验 ─────────────────────────────────────────────── */

test('密钥与参数校验', async () => {
  await assert.rejects(() => hotp({ secret: '', counter: 0 }), /不能为空/);
  await assert.rejects(() => hotp({ secret: 'AAAA', counter: 0, algorithm: 'MD5' }), /不支持的算法/);
  await assert.rejects(() => hotp({ secret: 'AAAA', counter: 0, digits: 5 }), /位数只能是/);
  assert.throws(() => parseSecret('', 'base32'), /不能为空/);
  // '1' 长度为奇数，十六进制解析应当报错（'12' 是合法的）
  assert.throws(() => parseSecret('1', 'hex'), /偶数/);
  assert.equal(parseSecret('12', 'hex').length, 1);
});

test('密钥支持三种输入格式', async () => {
  const raw = textToBytes('12345678901234567890');
  const byFormat = {
    base32: base32Encode(raw),
    hex: bytesToHex(raw),
    text: '12345678901234567890'
  };

  for (const format of ['base32', 'hex', 'text']) {
    const code = await hotp({ secret: byFormat[format], counter: 0, format });
    assert.equal(code, '755224', format);
  }
});

/* ── 校验口令 ─────────────────────────────────────────────── */

test('verifyTotp 接受当前口令并识别偏移', async () => {
  const secret = textToBytes('verify-secret');
  const timestamp = 1700000000000;
  const period = 30;

  const current = await totp({ secret, timestamp, period });
  assert.deepEqual(await verifyTotp({ secret, token: current, timestamp, period }), { ok: true, offset: 0 });

  // 上一个周期的口令在窗口内应当被接受
  const previous = await totp({ secret, timestamp: timestamp - period * 1000, period });
  assert.deepEqual(await verifyTotp({ secret, token: previous, timestamp, period, window: 1 }), { ok: true, offset: -1 });

  // 窗口设为 0 时就不接受
  const strict = await verifyTotp({ secret, token: previous, timestamp, period, window: 0 });
  assert.equal(strict.ok, false);
});

test('verifyTotp 拒绝错误口令与格式错误', async () => {
  const secret = textToBytes('verify-secret');
  const timestamp = 1700000000000;

  assert.equal((await verifyTotp({ secret, token: '000000', timestamp })).ok, false);

  const wrongLength = await verifyTotp({ secret, token: '12345', timestamp, digits: 6 });
  assert.equal(wrongLength.ok, false);
  assert.match(wrongLength.error, /6 位数字/);

  const notDigits = await verifyTotp({ secret, token: 'abcdef', timestamp });
  assert.equal(notDigits.ok, false);
});

/* ── otpauth:// 链接 ──────────────────────────────────────── */

test('解析标准 otpauth 链接', () => {
  const uri = 'otpauth://totp/GitHub:ada@example.com?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=GitHub&algorithm=SHA1&digits=6&period=30';
  const parsed = parseOtpAuthUri(uri);

  assert.equal(parsed.type, 'totp');
  assert.equal(parsed.issuer, 'GitHub');
  assert.equal(parsed.account, 'ada@example.com');
  assert.equal(parsed.secret, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.equal(parsed.algorithm, 'SHA-1');
  assert.equal(parsed.digits, 6);
  assert.equal(parsed.period, 30);
});

test('解析缺少可选参数的链接', () => {
  const parsed = parseOtpAuthUri('otpauth://totp/account?secret=MZXW6YTBOI');
  assert.equal(parsed.account, 'account');
  assert.equal(parsed.issuer, '');
  assert.equal(parsed.algorithm, 'SHA-1');
  assert.equal(parsed.digits, 6);
  assert.equal(parsed.period, 30);
});

test('解析 HOTP 链接与 SHA256', () => {
  const parsed = parseOtpAuthUri('otpauth://hotp/Svc:user?secret=MZXW6YTBOI&algorithm=SHA256&counter=5&digits=8');
  assert.equal(parsed.type, 'hotp');
  assert.equal(parsed.counter, 5);
  assert.equal(parsed.digits, 8);
  assert.equal(parsed.algorithm, 'SHA-256');
});

test('解析非法链接给出明确错误', () => {
  assert.throws(() => parseOtpAuthUri('https://example.com'), /不是 otpauth/);
  assert.throws(() => parseOtpAuthUri('otpauth://xmp/abc?secret=MZXW6'), /不支持的类型/);
  assert.throws(() => parseOtpAuthUri('otpauth://totp/abc'), /没有 secret/);
  assert.throws(() => parseOtpAuthUri('otpauth://totp/abc?secret=MZXW6&algorithm=MD5'), /不支持的算法/);
  assert.throws(() => parseOtpAuthUri('otpauth://totp/abc?secret=MZXW6&digits=5'), /不支持的位数/);
  assert.throws(() => parseOtpAuthUri('otpauth://totp/abc?secret=1111!!'), /Base32/);
});

test('生成 otpauth 链接并可被自己解析回来', () => {
  const uri = buildOtpAuthUri({
    type: 'totp',
    account: 'ada@example.com',
    issuer: 'GitHub',
    secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
    algorithm: 'SHA-1',
    digits: 6,
    period: 30
  });

  assert.match(uri, /^otpauth:\/\/totp\/GitHub:ada%40example\.com\?/);
  assert.match(uri, /algorithm=SHA1/);

  const parsed = parseOtpAuthUri(uri);
  assert.equal(parsed.issuer, 'GitHub');
  assert.equal(parsed.account, 'ada@example.com');
  assert.equal(parsed.secret, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
});

test('生成的链接能被用于计算口令', async () => {
  const secret = base32Encode(textToBytes('12345678901234567890'));
  const uri = buildOtpAuthUri({ account: 'test', secret });
  const parsed = parseOtpAuthUri(uri);
  const code = await totp({ secret: parsed.secret, timestamp: 59000, digits: 8 });
  assert.equal(code, '94287082');
});

test('不带 issuer 时标签不含冒号', () => {
  const uri = buildOtpAuthUri({ account: 'solo', secret: 'MZXW6YTBOI' });
  assert.match(uri, /^otpauth:\/\/totp\/solo\?/);
  assert.equal(parseOtpAuthUri(uri).issuer, '');
});

test('HOTP 链接带 counter 参数', () => {
  const uri = buildOtpAuthUri({ type: 'hotp', account: 'x', secret: 'MZXW6YTBOI', counter: 7 });
  assert.match(uri, /counter=7/);
  assert.equal(parseOtpAuthUri(uri).counter, 7);
});

/* ── 格式转换与概览 ───────────────────────────────────────── */

test('convertSecret 在三种格式间转换', () => {
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  const hex = convertSecret(secret, 'base32', 'hex');
  const back = convertSecret(hex, 'hex', 'base32');
  assert.equal(back, secret);
  assert.equal(convertSecret(secret, 'base32', 'text'), '12345678901234567890');
});

test('describeSecret 给出强度提示', () => {
  assert.equal(describeSecret(base32Encode(new Uint8Array(20))).strength, '足够（≥160 位）');
  assert.equal(describeSecret(base32Encode(new Uint8Array(12))).strength, '偏短');
  assert.equal(describeSecret(base32Encode(new Uint8Array(5))).strength, '过短');
  assert.equal(describeSecret('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ').bytes, 20);
});

test('常量定义完整', () => {
  assert.deepEqual(OTP_ALGORITHMS, ['SHA-1', 'SHA-256', 'SHA-512']);
  assert.equal(SECRET_FORMATS.length, 3);
  assert.ok(DIGIT_OPTIONS.includes(6));
});
