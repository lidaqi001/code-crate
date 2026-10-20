import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AMBIGUOUS_CHARS,
  CHARSETS,
  MIN_LENGTH,
  MAX_LENGTH,
  activeGroups,
  poolOf,
  randomInt,
  clampLength,
  generatePassword,
  entropyBits,
  strengthOf,
  randomString
} from '../src/tools/password/logic.js';

test('长度与字符组约束', () => {
  const value = generatePassword({ length: 24 });
  assert.equal(value.length, 24);
  const pool = poolOf({});
  for (const char of value) assert.ok(pool.includes(char), char);
});

test('默认保证每组至少出现一次', () => {
  for (let i = 0; i < 200; i += 1) {
    const value = generatePassword({ length: 8 });
    for (const id of ['lower', 'upper', 'digits', 'symbols']) {
      assert.ok([...value].some((char) => CHARSETS[id].includes(char)), `${id}: ${value}`);
    }
  }
});

test('关闭必选后只保证来自候选池', () => {
  const value = generatePassword({ length: 8, requireEach: false });
  const pool = poolOf({});
  for (const char of value) assert.ok(pool.includes(char));
});

test('易混字符可被剔除', () => {
  for (let i = 0; i < 50; i += 1) {
    const value = generatePassword({ length: 40, avoidAmbiguous: true });
    for (const char of value) assert.ok(!AMBIGUOUS_CHARS.includes(char), char);
  }
  const groups = activeGroups({ avoidAmbiguous: true });
  assert.ok(groups.every((group) => ![...group.chars].some((char) => AMBIGUOUS_CHARS.includes(char))));
});

test('未选择任何字符组时抛错', () => {
  assert.throws(
    () => generatePassword({ lower: false, upper: false, digits: false, symbols: false }),
    /至少选择一种/
  );
});

test('长度低于下限时夹紧到最小值', () => {
  const value = generatePassword({ length: 3 });
  assert.equal(value.length, MIN_LENGTH);
});

test('长度夹紧', () => {
  assert.equal(clampLength(-10), MIN_LENGTH);
  assert.equal(clampLength(999), MAX_LENGTH);
  assert.equal(clampLength('abc'), 16);
  assert.equal(generatePassword({ length: 999 }).length, MAX_LENGTH);
});

test('随机整数范围', () => {
  const seen = new Set();
  for (let i = 0; i < 300; i += 1) {
    const value = randomInt(3);
    assert.ok(value >= 0 && value < 3);
    seen.add(value);
  }
  assert.equal(seen.size, 3);
});

test('熵值与强度分级', () => {
  const bits = entropyBits({ length: 20 });
  assert.ok(bits > 100);
  assert.equal(strengthOf(120).label, '很强');
  assert.equal(strengthOf(20).label, '弱');
  assert.equal(strengthOf(60).tone, 'warn');
});

test('随机串格式与长度', () => {
  assert.match(randomString(16, 'hex'), /^[0-9a-f]{32}$/);
  const url = randomString(16, 'base64url');
  assert.match(url, /^[A-Za-z0-9_-]+$/);
  assert.equal(lengthOfBase64Url(url), 16);
  assert.equal(randomString(999, 'hex').length, 512);
});

function lengthOfBase64Url(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  return Math.floor((padded.length * 3) / 4);
}
