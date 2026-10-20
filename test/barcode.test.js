import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CODE128_PATTERNS,
  START_B,
  STOP,
  charValue,
  checksum,
  toModules,
  encodeCode128B,
  barRuns,
  escapeXml,
  toSvg
} from '../src/tools/barcode/logic.js';

test('符号表结构完整', () => {
  assert.equal(CODE128_PATTERNS.length, 107);
  for (let value = 0; value < 106; value += 1) {
    const pattern = CODE128_PATTERNS[value];
    assert.equal(pattern.length, 6, `symbol ${value}`);
    assert.equal([...pattern].reduce((sum, char) => sum + Number(char), 0), 11, `symbol ${value}`);
  }
  assert.equal(CODE128_PATTERNS[STOP], '2331112');
  assert.equal([...CODE128_PATTERNS[STOP]].reduce((sum, char) => sum + Number(char), 0), 13);
});

test('起始符取值正确', () => {
  assert.equal(START_B, 104);
  assert.equal(CODE128_PATTERNS[START_B], '211214');
  assert.equal(CODE128_PATTERNS[105], '211232');
});

test('ASCII 映射与越界拒绝', () => {
  assert.equal(charValue(' '), 0);
  assert.equal(charValue('A'), 33);
  assert.equal(charValue('~'), 94);
  assert.throws(() => charValue('\n'), /ASCII 32–126/);
  assert.throws(() => charValue('中'), /ASCII 32–126/);
});

test('校验位计算', () => {
  assert.equal(checksum([33]), 34); // 104 + 33 = 137 mod 103
  assert.equal(checksum([33, 34]), 102); // 104 + 33 + 68 = 205 mod 103
  assert.equal(checksum([17, 18, 19, 20, 21, 22]), 16);
});

test('编码结果包含起止符与校验位', () => {
  const result = encodeCode128B('AB');
  assert.deepEqual(result.data, [33, 34]);
  assert.deepEqual(result.values, [START_B, 33, 34, 102, STOP]);
  assert.equal(result.checksum, 102);
  assert.equal(result.moduleCount, (result.values.length - 1) * 11 + 13);
  assert.equal(result.modules.length, result.moduleCount);
});

test('模块以黑条开始并以停止符结束', () => {
  const { modules } = encodeCode128B('A');
  assert.equal(modules[0], 1);
  const stop = modules.slice(-13).join('');
  const expected = toModules([STOP]).join('');
  assert.equal(stop, expected);
});

test('空内容与超长内容抛错', () => {
  assert.throws(() => encodeCode128B(''), /请输入/);
  assert.throws(() => encodeCode128B('A'.repeat(121)), /内容过长/);
});

test('黑条区间合并正确', () => {
  const runs = barRuns([0, 1, 1, 0, 1, 0, 0, 1]);
  assert.deepEqual(runs, [{ start: 1, length: 2 }, { start: 4, length: 1 }, { start: 7, length: 1 }]);
});

test('XML 转义', () => {
  assert.equal(escapeXml('<a&"b\'>'), '&lt;a&amp;&quot;b&apos;&gt;');
});

test('SVG 输出尺寸、静区与文字', () => {
  const svg = toSvg('AB', { moduleWidth: 2, height: 90, quietZone: 10 });
  const { moduleCount } = encodeCode128B('AB');
  const width = (moduleCount + 20) * 2;
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.includes(`width="${width}"`));
  assert.ok(svg.includes('height="90"'));
  assert.ok(svg.includes('<rect'));
  assert.ok(svg.includes('>AB</text>'));
  assert.ok(!svg.includes('NaN') && !svg.includes('Infinity'));

  const noText = toSvg('AB', { showText: false });
  assert.ok(!noText.includes('<text'));
});

test('SVG 对特殊字符做转义', () => {
  const svg = toSvg('<&>');
  assert.ok(svg.includes('&lt;&amp;&gt;'));
  assert.ok(!svg.includes('aria-label="<'));
});
