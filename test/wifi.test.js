import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildWifiString,
  parseWifiString,
  escapeWifiValue,
  unescapeWifiValue,
  byteLength,
  validateWifi,
  securityAdvice,
  SECURITY_TYPES,
  WIFI_SAMPLE
} from '../src/tools/wifi/logic.js';
import { encode } from '../src/core/qrcode.js';

/* ── 转义 ─────────────────────────────────────────────────── */

test('转义分隔符', () => {
  assert.equal(escapeWifiValue('a;b'), 'a\\;b');
  assert.equal(escapeWifiValue('a,b'), 'a\\,b');
  assert.equal(escapeWifiValue('a:b'), 'a\\:b');
  assert.equal(escapeWifiValue('a"b'), 'a\\"b');
  assert.equal(escapeWifiValue('a\\b'), 'a\\\\b');
  assert.equal(escapeWifiValue('普通文本'), '普通文本');
});

test('转义与反转义可往返', () => {
  for (const sample of ['a;b', 'a,b', 'a:b', 'a"b', 'a\\b', 'a;b,c:d"e\\f', '中文；分号', '']) {
    assert.equal(unescapeWifiValue(escapeWifiValue(sample)), sample, sample);
  }
});

test('字节长度按 UTF-8 计算', () => {
  assert.equal(byteLength('abc'), 3);
  assert.equal(byteLength('中文'), 6);
  assert.equal(byteLength(''), 0);
});

/* ── 生成 ─────────────────────────────────────────────────── */

test('生成 WPA 网络的 WIFI 串', () => {
  const result = buildWifiString({ ssid: 'MyNet', password: 'secret123', security: 'WPA' });
  assert.equal(result.ok, true);
  assert.equal(result.text, 'WIFI:T:WPA;S:MyNet;P:secret123;;');
});

test('生成开放网络时不带密码字段', () => {
  const result = buildWifiString({ ssid: 'FreeWiFi', security: 'nopass' });
  assert.equal(result.ok, true);
  assert.equal(result.text, 'WIFI:T:nopass;S:FreeWiFi;;');
  assert.equal(result.text.includes('P:'), false);
});

test('生成隐藏网络时带 H:true', () => {
  const result = buildWifiString({ ssid: 'Hidden', password: 'pass1234', hidden: true });
  assert.match(result.text, /;H:true;;$/);
});

test('生成时会转义网络名与密码里的分隔符', () => {
  const result = buildWifiString({ ssid: 'Cafe;WiFi', password: 'p;a,s:s"w\\d' });
  assert.equal(result.ok, true);
  assert.equal(result.text, 'WIFI:T:WPA;S:Cafe\\;WiFi;P:p\\;a\\,s\\:s\\"w\\\\d;;');
});

test('网络名去掉首尾空白', () => {
  const result = buildWifiString({ ssid: '  Net  ', password: 'pass1234' });
  assert.equal(result.ok, true);
  assert.match(result.text, /S:Net;/);
  assert.ok(result.warnings.some((warning) => /空白/.test(warning)));
});

test('生成时的校验', () => {
  assert.match(buildWifiString({ ssid: '', password: 'pass1234' }).error, /不能为空/);
  assert.match(buildWifiString({ ssid: 'a'.repeat(33), password: 'pass1234' }).error, /超过 32 字节/);
  assert.match(buildWifiString({ ssid: 'N', password: '' }).error, /需要密码/);
  assert.match(buildWifiString({ ssid: 'N', password: 'short' }).error, /8-63 个字符/);
});

test('WPA 接受 64 位十六进制密钥', () => {
  const result = buildWifiString({ ssid: 'N', password: 'a'.repeat(64) });
  assert.equal(result.ok, true);
});

test('中文网络名按字节校验且能生成', () => {
  const result = buildWifiString({ ssid: '我的网络', password: 'pass1234' });
  assert.equal(result.ok, true);
  assert.match(result.text, /S:我的网络/);
  // 16 个中文字符 = 48 字节，超限
  assert.match(buildWifiString({ ssid: '中'.repeat(16), password: 'pass1234' }).error, /超过 32 字节/);
});

test('未知加密方式回退为 WPA 并提示', () => {
  const result = buildWifiString({ ssid: 'N', password: 'pass1234', security: 'WPA9' });
  assert.equal(result.ok, true);
  assert.match(result.text, /T:WPA;/);
  assert.ok(result.warnings.some((warning) => /未知的加密方式/.test(warning)));
});

test('开放网络忽略密码并提示', () => {
  const result = buildWifiString({ ssid: 'N', security: 'nopass', password: 'ignored' });
  assert.equal(result.ok, true);
  assert.equal(result.text.includes('P:'), false);
  assert.ok(result.warnings.some((warning) => /密码会被忽略/.test(warning)));
});

test('WEP 密码长度不常见时提示', () => {
  const result = buildWifiString({ ssid: 'N', password: 'abcd', security: 'WEP' });
  assert.equal(result.ok, true);
  assert.ok(result.warnings.some((warning) => /WEP 密码常见长度/.test(warning)));
});

/* ── 解析 ─────────────────────────────────────────────────── */

test('解析标准 WIFI 串', () => {
  const parsed = parseWifiString('WIFI:T:WPA;S:MyNet;P:secret123;;');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.ssid, 'MyNet');
  assert.equal(parsed.password, 'secret123');
  assert.equal(parsed.security, 'WPA');
  assert.equal(parsed.hidden, false);
});

test('解析带转义的 WIFI 串', () => {
  const parsed = parseWifiString('WIFI:T:WPA;S:Cafe\\;WiFi;P:p\\;a\\,s\\:s\\"w\\\\d;;');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.ssid, 'Cafe;WiFi');
  assert.equal(parsed.password, 'p;a,s:s"w\\d');
});

test('解析隐藏网络标志', () => {
  assert.equal(parseWifiString('WIFI:T:WPA;S:N;P:pass1234;H:true;;').hidden, true);
  assert.equal(parseWifiString('WIFI:T:WPA;S:N;P:pass1234;H:false;;').hidden, false);
});

test('解析开放网络', () => {
  const parsed = parseWifiString('WIFI:T:nopass;S:FreeWiFi;;');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.security, 'nopass');
  assert.equal(parsed.password, '');
});

test('解析非法内容给出明确错误', () => {
  assert.match(parseWifiString('').error, /内容为空/);
  assert.match(parseWifiString('https://example.com').error, /不是 WIFI: 开头/);
  assert.match(parseWifiString('WIFI:T:WPA;P:x;;').error, /没有解析出网络名称/);
});

test('解析时归一化加密方式大小写', () => {
  assert.equal(parseWifiString('WIFI:T:wpa;S:N;P:pass1234;;').security, 'WPA');
  assert.equal(parseWifiString('WIFI:T:nopass;S:N;;').security, 'nopass');
  assert.equal(parseWifiString('WIFI:T:;S:N;;').security, 'nopass');
});

/* ── 往返 ─────────────────────────────────────────────────── */

test('生成与解析可往返', () => {
  const cases = [
    { ssid: 'Simple', password: 'pass1234', security: 'WPA', hidden: false },
    { ssid: 'With;Special,Chars:Here', password: 'p;a,s:s"w\\d', security: 'WPA', hidden: false },
    { ssid: '我的网络', password: '密码密码密码密码密码', security: 'WPA', hidden: true },
    { ssid: 'Open', password: '', security: 'nopass', hidden: false },
    { ssid: 'Old', password: 'abcde', security: 'WEP', hidden: false }
  ];

  for (const options of cases) {
    const built = buildWifiString(options);
    assert.equal(built.ok, true, options.ssid);
    const parsed = parseWifiString(built.text);
    assert.equal(parsed.ok, true, options.ssid);
    assert.equal(parsed.ssid, options.ssid, `ssid: ${options.ssid}`);
    assert.equal(parsed.security, options.security, `security: ${options.ssid}`);
    assert.equal(parsed.hidden, options.hidden, `hidden: ${options.ssid}`);
    if (options.security !== 'nopass') {
      assert.equal(parsed.password, options.password, `password: ${options.ssid}`);
    }
  }
});

/* ── 校验与提示 ───────────────────────────────────────────── */

test('validateWifi 返回问题列表', () => {
  assert.deepEqual(validateWifi({ ssid: 'Net', password: 'pass1234' }), []);
  assert.ok(validateWifi({ ssid: '', password: 'pass1234' }).length > 0);
  assert.ok(validateWifi({ ssid: 'Net', password: '' }).length > 0);
  assert.ok(validateWifi({ ssid: 'Net', password: 'short' }).length > 0);
  assert.deepEqual(validateWifi({ ssid: 'Net', security: 'nopass' }), []);
  assert.ok(validateWifi({ ssid: '中'.repeat(16), password: 'pass1234' }).some((p) => /32 字节/.test(p)));
});

test('安全建议', () => {
  assert.match(securityAdvice('WEP'), /已被破解/);
  assert.match(securityAdvice('nopass'), /任何人都能看到/);
  assert.equal(securityAdvice('WPA'), '');
});

test('加密方式定义完整', () => {
  assert.equal(SECURITY_TYPES.length, 3);
  assert.deepEqual(SECURITY_TYPES.map((entry) => entry.id), ['WPA', 'WEP', 'nopass']);
  assert.ok(SECURITY_TYPES.every((entry) => entry.note));
});

/* ── 与二维码编码器的衔接 ─────────────────────────────────── */

test('生成的 WIFI 串能被二维码编码器编码', () => {
  const built = buildWifiString(WIFI_SAMPLE);
  assert.equal(built.ok, true);

  const result = encode(built.text, { ecc: 'M' });
  assert.equal(result.ok, true, result.error);
  assert.ok(result.version >= 1 && result.version <= 8);
  assert.ok(result.matrixSize > 0);
});

test('较长的 WIFI 串仍能编码', () => {
  const built = buildWifiString({
    // 中文按 UTF-8 字节计入 32 字节上限：8 个汉字 = 24 字节
    ssid: '中文网络名称测试',
    password: 'a-very-long-password-with-symbols-123456',
    security: 'WPA',
    hidden: true
  });
  assert.equal(built.ok, true);
  const result = encode(built.text, { ecc: 'M' });
  assert.equal(result.ok, true, result.error);
});

test('超出二维码容量时给出可读错误', () => {
  const built = buildWifiString({ ssid: 'N'.repeat(32), password: 'p'.repeat(63) });
  assert.equal(built.ok, true);
  const result = encode(built.text, { ecc: 'H' });
  if (!result.ok) assert.match(result.error, /内容过长/);
});
