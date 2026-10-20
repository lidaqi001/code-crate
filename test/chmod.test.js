import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseOctal,
  toOctal,
  parseSymbolic,
  toSymbolic,
  applySymbolicChange,
  describeMode,
  summarize,
  compareModes,
  isValidMode,
  COMMON_MODES,
  SPECIAL_BITS,
  FILE_TYPES
} from '../src/tools/chmod/logic.js';

/* ── 八进制解析与格式化 ───────────────────────────────────── */

test('解析八进制权限', () => {
  assert.equal(parseOctal('755'), 0o755);
  assert.equal(parseOctal('0644'), 0o644);
  assert.equal(parseOctal('4755'), 0o4755);
  assert.equal(parseOctal('777'), 0o777);
  assert.equal(parseOctal('000'), 0);
  assert.equal(parseOctal('0o755'), 0o755);
  assert.equal(parseOctal(' 755 '), 0o755);
});

test('八进制解析的错误处理', () => {
  assert.throws(() => parseOctal(''), /为空/);
  assert.throws(() => parseOctal('75'), /3 位或 4 位/);
  // 7555 是合法的 4 位（三个特殊位全开），超过 4 位才非法
  assert.equal(parseOctal('7555'), 0o7555);
  assert.throws(() => parseOctal('77777'), /3 位或 4 位/);
  assert.throws(() => parseOctal('8'), /3 位或 4 位/);
  assert.throws(() => parseOctal('abc'), /3 位或 4 位/);
});

test('格式化为八进制', () => {
  assert.equal(toOctal(0o755), '755');
  assert.equal(toOctal(0o644), '644');
  assert.equal(toOctal(0), '000');
  assert.equal(toOctal(0o4755), '4755');
  assert.equal(parseOctal(toOctal(0o644)), 0o644);
});

test('权限范围校验', () => {
  assert.equal(isValidMode(0), true);
  assert.equal(isValidMode(0o7777), true);
  assert.equal(isValidMode(0o10000), false);
  assert.equal(isValidMode(-1), false);
  assert.equal(isValidMode(1.5), false);
});

/* ── 符号表示 ─────────────────────────────────────────────── */

test('转成符号表示', () => {
  assert.equal(toSymbolic(0o755), 'rwxr-xr-x');
  assert.equal(toSymbolic(0o644), 'rw-r--r--');
  assert.equal(toSymbolic(0o600), 'rw-------');
  assert.equal(toSymbolic(0), '---------');
  assert.equal(toSymbolic(0o777), 'rwxrwxrwx');
});

test('特殊位显示为 s/S 与 t/T', () => {
  assert.equal(toSymbolic(0o4755), 'rwsr-xr-x');
  assert.equal(toSymbolic(0o2755), 'rwxr-sr-x');
  assert.equal(toSymbolic(0o1777), 'rwxrwxrwt');
  // 没有执行位时用大写
  assert.equal(toSymbolic(0o4644), 'rwSr--r--');
  assert.equal(toSymbolic(0o2644), 'rw-r-Sr--');
  assert.equal(toSymbolic(0o1644), 'rw-r--r-T');
});

test('带文件类型前缀', () => {
  assert.equal(toSymbolic(0o755, { withType: true }), '-rwxr-xr-x');
  assert.equal(toSymbolic(0o755, { withType: true, type: 'd' }), 'drwxr-xr-x');
  assert.equal(toSymbolic(0o755, { withType: true, type: '?' }), '-rwxr-xr-x');
});

test('解析符号表示', () => {
  assert.deepEqual(parseSymbolic('rwxr-xr-x'), { mode: 0o755, type: '-' });
  assert.deepEqual(parseSymbolic('rw-r--r--'), { mode: 0o644, type: '-' });
  assert.deepEqual(parseSymbolic('---------'), { mode: 0, type: '-' });
  assert.deepEqual(parseSymbolic('drwxr-xr-x'), { mode: 0o755, type: 'd' });
  assert.deepEqual(parseSymbolic('-rwx------'), { mode: 0o700, type: '-' });
});

test('解析符号表示里的特殊位', () => {
  assert.equal(parseSymbolic('rwsr-xr-x').mode, 0o4755);
  assert.equal(parseSymbolic('rwSr--r--').mode, 0o4644);
  assert.equal(parseSymbolic('rwxr-sr-x').mode, 0o2755);
  assert.equal(parseSymbolic('rwxrwxrwt').mode, 0o1777);
  assert.equal(parseSymbolic('rw-r--r-T').mode, 0o1644);
});

test('符号解析的错误处理', () => {
  assert.throws(() => parseSymbolic(''), /为空/);
  assert.throws(() => parseSymbolic('rwx'), /9 个字符/);
  assert.throws(() => parseSymbolic('xxxxxxxxx'), /读位/);
  assert.throws(() => parseSymbolic('rwxrwxrwz'), /执行位/);
  assert.throws(() => parseSymbolic('Zrwxr-xr-x'), /未知的文件类型/);
});

test('八进制与符号可往返', () => {
  for (const mode of [0, 0o644, 0o755, 0o600, 0o777, 0o4755, 0o2775, 0o1777, 0o4644, 0o2644, 0o1644]) {
    assert.equal(parseSymbolic(toSymbolic(mode)).mode, mode, toOctal(mode));
    assert.equal(parseOctal(toOctal(mode)), mode, toOctal(mode));
  }
});

/* ── 增量改动 ─────────────────────────────────────────────── */

test('加权限', () => {
  assert.equal(applySymbolicChange(0o644, 'u+x'), 0o744);
  assert.equal(applySymbolicChange(0o644, 'a+x'), 0o755);
  assert.equal(applySymbolicChange(0o644, '+x'), 0o755);
  assert.equal(applySymbolicChange(0o600, 'g+r'), 0o640);
  assert.equal(applySymbolicChange(0o600, 'go+r'), 0o644);
});

test('减权限', () => {
  assert.equal(applySymbolicChange(0o777, 'o-w'), 0o775);
  assert.equal(applySymbolicChange(0o777, 'go-w'), 0o755);
  assert.equal(applySymbolicChange(0o755, 'a-x'), 0o644);
  assert.equal(applySymbolicChange(0o755, '-x'), 0o644);
});

test('等号赋值会先清空该组', () => {
  assert.equal(applySymbolicChange(0o777, 'u=rw'), 0o677);
  assert.equal(applySymbolicChange(0o777, 'o='), 0o770);
  assert.equal(applySymbolicChange(0o777, 'a=r'), 0o444);
  assert.equal(applySymbolicChange(0o644, 'a=rwx'), 0o777);
});

test('等号赋值会清掉特殊位', () => {
  assert.equal(applySymbolicChange(0o4755, 'u=rwx'), 0o755);
  assert.equal(applySymbolicChange(0o1777, 'o=rwx'), 0o777);
});

test('逗号分隔的多条改动', () => {
  assert.equal(applySymbolicChange(0o644, 'u+x,go-w'), 0o744);
  assert.equal(applySymbolicChange(0o600, 'u=rwx,g=rx,o='), 0o750);
  assert.equal(applySymbolicChange(0, 'u=rw,g=r,o=r'), 0o644);
});

test('X 只在目录或已有执行位时加执行', () => {
  // 没有任何执行位 → 不加
  assert.equal(applySymbolicChange(0o644, 'a+X'), 0o644);
  // 已有一个执行位 → 全都加
  assert.equal(applySymbolicChange(0o744, 'a+X'), 0o755);
});

test('特殊位的加减', () => {
  assert.equal(applySymbolicChange(0o755, 'u+s'), 0o4755);
  assert.equal(applySymbolicChange(0o755, 'g+s'), 0o2755);
  assert.equal(applySymbolicChange(0o777, '+t'), 0o1777);
  assert.equal(applySymbolicChange(0o4755, 'u-s'), 0o755);
  // t 只对其他人有效，写到 u 上不生效
  assert.equal(applySymbolicChange(0o755, 'u+t'), 0o755);
});

test('增量改动的错误处理', () => {
  assert.throws(() => applySymbolicChange(0o644, ''), /为空/);
  assert.throws(() => applySymbolicChange(0o644, 'u+'), /没有指定权限字母/);
  assert.throws(() => applySymbolicChange(0o644, 'z+x'), /无法解析/);
  assert.throws(() => applySymbolicChange(0o644, 'u~x'), /无法解析/);
});

/* ── 说明与汇总 ───────────────────────────────────────────── */

test('describeMode 逐组说明', () => {
  const groups = describeMode(0o750);
  assert.equal(groups.length, 3);
  assert.deepEqual(groups[0].labels, ['读', '写', '执行']);
  assert.deepEqual(groups[1].labels, ['读', '执行']);
  assert.deepEqual(groups[2].labels, ['无权限']);
  assert.equal(groups[2].text, '---');
  assert.equal(groups[0].octal, '7');
});

test('summarize 汇总多种表示', () => {
  const summary = summarize(0o4755);
  assert.equal(summary.octal, '4755');
  assert.equal(summary.symbolic, 'rwsr-xr-x');
  assert.equal(summary.lsStyle, '-rwsr-xr-x');
  assert.deepEqual(summary.specials, ['setuid']);
});

test('compareModes 判断放宽或收紧', () => {
  assert.equal(compareModes(0o644, 0o644), 'same');
  assert.equal(compareModes(0o644, 0o755), 'wider');
  assert.equal(compareModes(0o755, 0o644), 'narrower');
  assert.equal(compareModes(0o644, 0o600), 'narrower');
});

test('常用权限表可解析且与符号一致', () => {
  assert.ok(COMMON_MODES.length >= 10);
  for (const entry of COMMON_MODES) {
    const summary = summarize(entry.mode);
    assert.equal(summary.symbolic, entry.label, `0o${entry.mode.toString(8)}`);
    assert.ok(entry.note);
  }
});

test('特殊位与文件类型定义完整', () => {
  assert.equal(SPECIAL_BITS.length, 3);
  assert.deepEqual(SPECIAL_BITS.map((entry) => entry.mask), [0o4000, 0o2000, 0o1000]);
  assert.ok(FILE_TYPES.some((entry) => entry.id === 'd'));
  assert.ok(FILE_TYPES.some((entry) => entry.id === '-'));
});

test('常见 chmod 用法对照', () => {
  // 私钥 600、公钥 644、~/.ssh 700、共享目录 1777
  assert.equal(applySymbolicChange(0o777, 'go-rwx'), 0o700);
  assert.equal(applySymbolicChange(0o755, 'o-rwx'), 0o750);
  assert.equal(parseSymbolic('rw-------').mode, 0o600);
  assert.equal(parseSymbolic('drwxrwxrwt').mode, 0o1777);
});
