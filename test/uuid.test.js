import test from 'node:test';
import assert from 'node:assert/strict';

import {
  uuidV4,
  uuidV7,
  uuidV7Timestamp,
  ulid,
  ulidTimestamp,
  validateUuid,
  randomInt,
  randomString,
  randomPassword,
  passwordAlphabet,
  entropyBits,
  entropyLabel,
  checkPassword,
  CHARSETS,
  NIL_UUID,
  defaultRng
} from '../src/tools/uuid/logic.js';

/** 确定性随机源，用于可复现的断言。 */
function seededRng(seed = 12345) {
  let state = seed >>> 0;
  return {
    nextBytes(length) {
      const out = new Uint8Array(length);
      for (let i = 0; i < length; i += 1) {
        state = (state * 1664525 + 1013904223) >>> 0;
        out[i] = (state >>> 16) & 0xff;
      }
      return out;
    }
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/* ── UUID v4 ──────────────────────────────────────────────── */

test('uuidV4 结构、版本与变体正确', () => {
  const id = uuidV4();
  assert.match(id, UUID_RE);
  const info = validateUuid(id);
  assert.equal(info.valid, true);
  assert.equal(info.version, 4);
  assert.equal(info.variant, 'RFC 4122');
});

test('uuidV4 大量生成不重复', () => {
  const set = new Set();
  for (let i = 0; i < 2000; i += 1) set.add(uuidV4());
  assert.equal(set.size, 2000);
});

test('uuidV4 使用注入的随机源时结果可复现', () => {
  assert.equal(uuidV4(seededRng(1)), uuidV4(seededRng(1)));
  assert.notEqual(uuidV4(seededRng(1)), uuidV4(seededRng(2)));
});

/* ── UUID v7 ──────────────────────────────────────────────── */

test('uuidV7 版本号为 7 且可还原时间戳', () => {
  const ts = Date.UTC(2026, 4, 20, 10, 30, 0);
  const id = uuidV7(defaultRng, ts);
  assert.match(id, UUID_RE);
  assert.equal(validateUuid(id).version, 7);
  assert.equal(uuidV7Timestamp(id), ts);
});

test('uuidV7 按字典序即按时间序排列', () => {
  const early = uuidV7(defaultRng, 1_700_000_000_000);
  const late = uuidV7(defaultRng, 1_800_000_000_000);
  assert.ok(early < late);
});

test('uuidV7Timestamp 对非 v7 返回 null', () => {
  assert.equal(uuidV7Timestamp(uuidV4()), null);
  assert.equal(uuidV7Timestamp(NIL_UUID), null);
  assert.equal(uuidV7Timestamp('not-a-uuid'), null);
});

/* ── ULID ─────────────────────────────────────────────────── */

test('ulid 长度 26 且字符集合法', () => {
  const id = ulid();
  assert.equal(id.length, 26);
  assert.match(id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
});

test('ulid 可还原时间戳且单调', () => {
  const ts = Date.UTC(2026, 0, 1);
  assert.equal(ulidTimestamp(ulid(defaultRng, ts)), ts);
  assert.ok(ulid(defaultRng, 1000) < ulid(defaultRng, 2000));
  assert.equal(ulidTimestamp('short'), null);
});

/* ── 随机整数 ─────────────────────────────────────────────── */

test('randomInt 落在闭区间内且能取到端点', () => {
  const rng = seededRng(7);
  const seen = new Set();
  for (let i = 0; i < 500; i += 1) {
    const value = randomInt(1, 6, rng);
    assert.ok(value >= 1 && value <= 6);
    seen.add(value);
  }
  assert.equal(seen.size, 6);
});

test('randomInt 支持倒置区间与单点区间', () => {
  assert.equal(randomInt(5, 5, seededRng(1)), 5);
  const value = randomInt(10, 2, seededRng(3));
  assert.ok(value >= 2 && value <= 10);
});

test('randomInt 拒绝非整数端点', () => {
  assert.throws(() => randomInt(0.5, 3), /整数/);
});

/* ── 随机字符串 ───────────────────────────────────────────── */

test('randomString 长度与字符集正确', () => {
  const value = randomString(64, 'ab', seededRng(9));
  assert.equal(value.length, 64);
  assert.match(value, /^[ab]+$/);
});

test('randomString 参数校验', () => {
  assert.throws(() => randomString(4, ''), /字符集/);
  assert.throws(() => randomString(-1, 'ab'), /非负整数/);
});

/* ── 密码 ─────────────────────────────────────────────────── */

test('randomPassword 长度正确且每类字符至少出现一次', () => {
  for (let i = 0; i < 50; i += 1) {
    const password = randomPassword({ length: 20, lower: true, upper: true, digits: true, symbols: true });
    assert.equal(password.length, 20);
    const check = checkPassword(password, { lower: true, upper: true, digits: true, symbols: true });
    assert.equal(check.ok, true, password);
  }
});

test('randomPassword 尊重字符类型开关', () => {
  const digitsOnly = randomPassword({ length: 12, lower: false, upper: false, digits: true, symbols: false }, seededRng(3));
  assert.match(digitsOnly, /^[0-9]{12}$/);
});

test('randomPassword 可排除易混淆字符', () => {
  for (let i = 0; i < 30; i += 1) {
    const password = randomPassword({ length: 40, avoidAmbiguous: true }, seededRng(i + 1));
    assert.doesNotMatch(password, /[Il1O0o]/);
  }
});

test('randomPassword 参数校验与错误提示', () => {
  assert.throws(() => randomPassword({ lower: false, upper: false, digits: false, symbols: false }), /至少/);
  assert.throws(() => randomPassword({ length: 2, lower: true, upper: true, digits: true }), /至少为 3/);
});

test('passwordAlphabet 反映所选字符集', () => {
  const alphabet = passwordAlphabet({ lower: true, upper: false, digits: false, symbols: false });
  assert.equal(alphabet, CHARSETS.lower);
  // 排除易混淆字符后，小写字母里去掉 l / o，数字里去掉 0 / 1
  assert.equal(
    passwordAlphabet({ avoidAmbiguous: true, lower: true, upper: false, digits: true, symbols: false }),
    'abcdefghijkmnpqrstuvwxyz23456789'
  );
});

test('熵估算与分级', () => {
  assert.equal(Math.round(entropyBits(16, 62)), 95);
  assert.equal(entropyLabel(30).label, '弱');
  assert.equal(entropyLabel(50).label, '一般');
  assert.equal(entropyLabel(70).label, '强');
  assert.equal(entropyLabel(200).level, 'ok');
});

/* ── 校验 ─────────────────────────────────────────────────── */

test('validateUuid 识别非法输入', () => {
  assert.equal(validateUuid('abc').valid, false);
  assert.equal(validateUuid('').valid, false);
  assert.equal(validateUuid(null).valid, false);
  assert.equal(validateUuid('550e8400-e29b-41d4-a716-44665544000').valid, false);
});

test('validateUuid 识别 nil UUID 与各版本', () => {
  const nil = validateUuid(NIL_UUID);
  assert.equal(nil.valid, true);
  assert.equal(nil.isNil, true);
  assert.equal(validateUuid('550e8400-e29b-41d4-a716-446655440000').version, 4);
  assert.equal(validateUuid('017f22e2-79b0-7cc3-98c4-dc0c0c07398f').version, 7);
  assert.equal(validateUuid('017f22e2-79b0-7cc3-98c4-dc0c0c07398f').variant, 'RFC 4122');
});
