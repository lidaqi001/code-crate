import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseInBase,
  formatInBase,
  convertBase,
  convertToAllBases,
  describeInteger,
  swapEndianness,
  applyBitOperation,
  convertUnit,
  convertToAllUnits,
  formatNumber,
  parseNumber,
  getCategory,
  normalizeBase,
  COMMON_BASES,
  BIT_OPERATIONS,
  UNIT_CATEGORIES,
  MIN_BASE,
  MAX_BASE
} from '../src/tools/units/logic.js';

/* ── 进制解析 ─────────────────────────────────────────────── */

test('解析常见进制', () => {
  assert.equal(parseInBase('1010', 2), 10n);
  assert.equal(parseInBase('755', 8), 493n);
  assert.equal(parseInBase('255', 10), 255n);
  assert.equal(parseInBase('ff', 16), 255n);
  assert.equal(parseInBase('FF', 16), 255n);
  assert.equal(parseInBase('z', 36), 35n);
  assert.equal(parseInBase('10', 36), 36n);
});

test('解析支持前缀、符号、空格与下划线', () => {
  assert.equal(parseInBase('0xff', 16), 255n);
  assert.equal(parseInBase('0b1010', 2), 10n);
  assert.equal(parseInBase('0o755', 8), 493n);
  assert.equal(parseInBase('-ff', 16), -255n);
  assert.equal(parseInBase('+ff', 16), 255n);
  assert.equal(parseInBase(' 1 000 ', 10), 1000n);
  assert.equal(parseInBase('1_000', 10), 1000n);
});

test('解析超出 32 位也不丢精度', () => {
  assert.equal(parseInBase('ffffffffffffffff', 16), 18446744073709551615n);
  assert.equal(parseInBase('18446744073709551615', 10), (1n << 64n) - 1n);
  // Number 在这个量级会失真，BigInt 不会
  assert.equal(formatInBase((1n << 64n) + 1n, 10), '18446744073709551617');
});

test('解析非法输入给出可读错误', () => {
  assert.throws(() => parseInBase('', 10), /输入为空/);
  assert.throws(() => parseInBase('12', 2), /不是 2 进制/);
  assert.throws(() => parseInBase('9', 8), /不是 8 进制/);
  assert.throws(() => parseInBase('g', 16), /不是 16 进制/);
  assert.throws(() => parseInBase('1.5', 10), /只支持整数/);
  assert.throws(() => parseInBase('-', 10), /没有数字/);
  assert.throws(() => parseInBase('0x', 16), /没有数字/);
});

test('进制范围校验', () => {
  assert.equal(normalizeBase(2), 2);
  assert.equal(normalizeBase(36), 36);
  assert.throws(() => normalizeBase(1), /2-36/);
  assert.throws(() => normalizeBase(37), /2-36/);
  assert.throws(() => normalizeBase(2.5), /2-36/);
  assert.equal(MIN_BASE, 2);
  assert.equal(MAX_BASE, 36);
});

/* ── 进制格式化 ───────────────────────────────────────────── */

test('格式化常见进制', () => {
  assert.equal(formatInBase(10n, 2), '1010');
  assert.equal(formatInBase(493n, 8), '755');
  assert.equal(formatInBase(255n, 16), 'ff');
  assert.equal(formatInBase(255n, 16, { upper: true }), 'FF');
  assert.equal(formatInBase(0n, 16), '0');
  assert.equal(formatInBase(-255n, 16), '-ff');
});

test('格式化支持分组与前缀', () => {
  assert.equal(formatInBase(0xdeadbeefn, 16, { group: 2 }), 'de ad be ef');
  assert.equal(formatInBase(255n, 16, { prefix: true }), '0xff');
  assert.equal(formatInBase(10n, 2, { prefix: true }), '0b1010');
  assert.equal(formatInBase(493n, 8, { prefix: true }), '0o755');
  assert.equal(formatInBase(255n, 10, { prefix: true }), '255');
});

test('解析与格式化可往返', () => {
  for (const base of [2, 8, 10, 16, 32, 36]) {
    for (const value of [0n, 1n, 42n, 255n, 65535n, 123456789n]) {
      const text = formatInBase(value, base);
      assert.equal(parseInBase(text, base), value, `${base} 进制 ${value}`);
    }
  }
});

test('convertBase 一步转换', () => {
  assert.equal(convertBase('ff', 16, 2), '11111111');
  assert.equal(convertBase('11111111', 2, 16), 'ff');
  assert.equal(convertBase('255', 10, 8), '377');
});

test('convertToAllBases 输出全部常用进制', () => {
  const rows = convertToAllBases(255n);
  assert.equal(rows.length, COMMON_BASES.length);
  const byBase = Object.fromEntries(rows.map((row) => [row.base, row.text]));
  assert.equal(byBase[2], '0b11111111');
  assert.equal(byBase[8], '0o377');
  assert.equal(byBase[10], '255');
  assert.equal(byBase[16], '0xFF');
});

/* ── 整数规模信息 ─────────────────────────────────────────── */

test('describeInteger 给出位数与置位个数', () => {
  assert.deepEqual(describeInteger(0n), { bits: 1, bytes: 1, ones: 0, isNegative: false });
  assert.deepEqual(describeInteger(255n), { bits: 8, bytes: 1, ones: 8, isNegative: false });
  assert.deepEqual(describeInteger(256n), { bits: 9, bytes: 2, ones: 1, isNegative: false });
  assert.equal(describeInteger(-1n).isNegative, true);
  assert.equal(describeInteger((1n << 32n) - 1n).bits, 32);
});

test('swapEndianness 按字节翻转', () => {
  assert.equal(swapEndianness(0x12345678n), 0x78563412n);
  assert.equal(swapEndianness(0x1234n), 0x3412n);
  assert.equal(swapEndianness(0x1234n, 4), 0x34120000n);
  assert.equal(swapEndianness(0n), 0n);
  assert.throws(() => swapEndianness(-1n), /负数/);
});

/* ── 位运算 ───────────────────────────────────────────────── */

test('位运算结果正确', () => {
  assert.equal(applyBitOperation('and', 0b1100n, 0b1010n), 0b1000n);
  assert.equal(applyBitOperation('or', 0b1100n, 0b1010n), 0b1110n);
  assert.equal(applyBitOperation('xor', 0b1100n, 0b1010n), 0b0110n);
  assert.equal(applyBitOperation('shl', 1n, 4n), 16n);
  assert.equal(applyBitOperation('shr', 16n, 4n), 1n);
});

test('取反需要位宽，默认按 32 位', () => {
  assert.equal(applyBitOperation('not', 0n), 0xffffffffn);
  assert.equal(applyBitOperation('not', 0n, 0n, { width: 8 }), 0xffn);
  assert.equal(applyBitOperation('not', 0b1010n, 0n, { width: 4 }), 0b0101n);
  assert.throws(() => applyBitOperation('not', 0n, 0n, { width: 0 }), /位宽/);
});

test('位运算的错误处理', () => {
  assert.throws(() => applyBitOperation('shl', 1n, -1n), /不能为负/);
  assert.throws(() => applyBitOperation('shl', 1n, 9999n), /过大/);
  assert.throws(() => applyBitOperation('nope', 1n, 1n), /未知的位运算/);
});

test('BIT_OPERATIONS 定义完整且都可执行', () => {
  assert.ok(BIT_OPERATIONS.length >= 6);
  for (const operation of BIT_OPERATIONS) {
    assert.ok(operation.label && operation.symbol);
    assert.doesNotThrow(() => applyBitOperation(operation.id, 6n, 3n));
  }
});

/* ── 单位换算 ─────────────────────────────────────────────── */

test('数据存储换算', () => {
  assert.equal(convertUnit(1, 'data', 'kb', 'byte'), 1000);
  assert.equal(convertUnit(1, 'data', 'kib', 'byte'), 1024);
  assert.equal(convertUnit(1, 'data', 'gib', 'mib'), 1024);
  assert.equal(convertUnit(8, 'data', 'bit', 'byte'), 1);
  assert.equal(convertUnit(1, 'data', 'tb', 'gb'), 1000);
});

test('时间换算', () => {
  assert.equal(convertUnit(1, 'time', 'hour', 'min'), 60);
  assert.equal(convertUnit(1, 'time', 'day', 'hour'), 24);
  assert.equal(convertUnit(1000, 'time', 'ms', 's'), 1);
  assert.equal(convertUnit(1, 'time', 'us', 'ns'), 1000);
});

test('长度与质量换算', () => {
  assert.equal(convertUnit(1, 'length', 'km', 'm'), 1000);
  assert.ok(Math.abs(convertUnit(1, 'length', 'inch', 'cm') - 2.54) < 1e-9);
  assert.ok(Math.abs(convertUnit(1, 'length', 'mile', 'm') - 1609.344) < 1e-9);
  assert.equal(convertUnit(1, 'mass', 'kg', 'g'), 1000);
  assert.ok(Math.abs(convertUnit(1, 'mass', 'lb', 'g') - 453.59237) < 1e-9);
});

test('温度换算带偏移，不能只按倍率算', () => {
  assert.equal(convertUnit(0, 'temperature', 'c', 'f'), 32);
  assert.equal(convertUnit(100, 'temperature', 'c', 'f'), 212);
  assert.equal(convertUnit(32, 'temperature', 'f', 'c'), 0);
  assert.equal(convertUnit(0, 'temperature', 'c', 'k'), 273.15);
  assert.equal(convertUnit(273.15, 'temperature', 'k', 'c'), 0);
  assert.ok(Math.abs(convertUnit(-40, 'temperature', 'c', 'f') + 40) < 1e-9);
});

test('角度与速度换算', () => {
  assert.ok(Math.abs(convertUnit(180, 'angle', 'deg', 'rad') - Math.PI) < 1e-9);
  assert.equal(convertUnit(1, 'angle', 'turn', 'deg'), 360);
  assert.ok(Math.abs(convertUnit(1, 'speed', 'mps', 'kmh') - 3.6) < 1e-9);
  assert.ok(Math.abs(convertUnit(1, 'speed', 'knot', 'mps') - 0.514444) < 1e-9);
});

test('换算到自身不变', () => {
  for (const category of UNIT_CATEGORIES) {
    for (const unit of category.units) {
      assert.equal(convertUnit(7, category.id, unit.id, unit.id), 7, `${category.id}/${unit.id}`);
    }
  }
});

test('convertToAllUnits 一次给出全部单位', () => {
  const rows = convertToAllUnits(1, 'time', 'hour');
  const byId = Object.fromEntries(rows.map((row) => [row.id, row.value]));
  assert.equal(byId.min, 60);
  assert.equal(byId.s, 3600);
  assert.equal(byId.hour, 1);
  assert.equal(rows.length, getCategory('time').units.length);
});

test('单位换算的错误处理', () => {
  assert.throws(() => convertUnit(1, 'nope', 'a', 'b'), /未知的单位类别/);
  assert.throws(() => convertUnit(1, 'data', 'nope', 'byte'), /不是 数据存储 的单位/);
  assert.throws(() => convertUnit('abc', 'data', 'byte', 'bit'), /数值无效/);
});

test('单位类别定义完整', () => {
  assert.ok(UNIT_CATEGORIES.length >= 6);
  for (const category of UNIT_CATEGORIES) {
    assert.ok(category.label, category.id);
    assert.ok(category.units.length >= 2, category.id);
    if (category.id !== 'temperature') {
      assert.ok(category.units.every((unit) => typeof unit.factor === 'number' && unit.factor > 0), category.id);
    }
  }
});

/* ── 数值格式化 ───────────────────────────────────────────── */

test('formatNumber 去掉浮点尾数噪声', () => {
  assert.equal(formatNumber(0), '0');
  assert.equal(formatNumber(1), '1');
  assert.equal(formatNumber(0.1 + 0.2), '0.3');
  assert.equal(formatNumber(1000), '1000');
  assert.equal(formatNumber(1 / 3), '0.33333333');
});

test('formatNumber 对极大极小值用科学计数法', () => {
  assert.match(formatNumber(1e20), /e\+?20/);
  assert.match(formatNumber(1e-9), /e-9/);
});

test('parseNumber 接受空格与下划线', () => {
  assert.equal(parseNumber(' 1 000 '), 1000);
  assert.equal(parseNumber('1_000'), 1000);
  assert.equal(parseNumber('-3.5'), -3.5);
  assert.throws(() => parseNumber(''), /为空/);
  assert.throws(() => parseNumber('abc'), /不是合法数值/);
});
