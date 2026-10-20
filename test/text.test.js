import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CASE_OPS,
  ESCAPE_OPS,
  sortLines,
  dedupeLines,
  reverseLines,
  shuffleLines,
  removeEmptyLines,
  trimLines,
  addAffix,
  numberLines,
  filterLines,
  joinLines,
  splitToLines,
  wrapText,
  collapseSpaces,
  removeAllSpaces,
  removeLineBreaks,
  collapseBlankLines,
  stripHtmlTags,
  removePunctuation,
  escapeRegExp,
  escapeShellArg,
  escapeCsvField,
  escapeHtmlText,
  textStats,
  normalizeNewlines,
  toLineArray
} from '../src/tools/text/logic.js';

/* ── 大小写操作表 ─────────────────────────────────────────── */

test('CASE_OPS 覆盖全部预期操作且可直接调用', () => {
  const ids = CASE_OPS.map((op) => op.id);
  for (const expected of ['upper', 'lower', 'title', 'sentence', 'camel', 'pascal', 'snake', 'kebab', 'constant', 'invert', 'alternating']) {
    assert.ok(ids.includes(expected), `缺少 ${expected}`);
  }
  for (const op of CASE_OPS) {
    assert.equal(typeof op.run('hello world'), 'string', op.id);
  }
});

test('大小写操作结果符合预期', () => {
  const byId = Object.fromEntries(CASE_OPS.map((op) => [op.id, op.run]));
  assert.equal(byId.upper('aB'), 'AB');
  assert.equal(byId.lower('aB'), 'ab');
  assert.equal(byId.camel('hello world'), 'helloWorld');
  assert.equal(byId.pascal('hello world'), 'HelloWorld');
  assert.equal(byId.snake('helloWorld'), 'hello_world');
  assert.equal(byId.kebab('helloWorld'), 'hello-world');
  assert.equal(byId.constant('helloWorld'), 'HELLO_WORLD');
  assert.equal(byId.invert('aB'), 'Ab');
  assert.equal(byId.alternating('abcd'), 'aBcD');
});

/* ── 排序 ─────────────────────────────────────────────────── */

test('sortLines 文本升序与降序', () => {
  assert.equal(sortLines('b\na\nc'), 'a\nb\nc');
  assert.equal(sortLines('b\na\nc', { order: 'desc' }), 'c\nb\na');
});

test('sortLines 自然排序让 item10 排在 item2 之后', () => {
  assert.equal(sortLines('item10\nitem2\nitem1'), 'item1\nitem2\nitem10');
});

test('sortLines 按长度排序', () => {
  assert.equal(sortLines('ccc\na\nbb', { by: 'length' }), 'a\nbb\nccc');
});

test('sortLines 按数值排序且无数字的行排最后', () => {
  const input = '10 个\nabc\n2 个';
  const result = sortLines(input, { by: 'number' });
  assert.deepEqual(result.split('\n'), ['2 个', '10 个', 'abc']);
});

test('sortLines 不修改行内容（保留前后空白）', () => {
  // 断言「内容集合不变」而不是某个具体顺序 —— 顺序取决于排序规则
  const input = '  b \n a';
  const result = sortLines(input);
  assert.deepEqual(result.split('\n').sort(), input.split('\n').sort());
  assert.equal(result.includes('  b '), true);
  assert.equal(result.includes(' a'), true);
});

/* ── 去重与变换 ───────────────────────────────────────────── */

test('dedupeLines 保留首次出现顺序', () => {
  assert.equal(dedupeLines('b\na\nb\nc\na'), 'b\na\nc');
});

test('dedupeLines 支持忽略大小写与按去空白比较', () => {
  assert.equal(dedupeLines('A\na', { caseSensitive: false }), 'A');
  assert.equal(dedupeLines('a\n a ', { trim: true }), 'a');
  assert.equal(dedupeLines('a\n a ', { trim: false }), 'a\n a ');
});

test('reverseLines 反转行序', () => {
  assert.equal(reverseLines('1\n2\n3'), '3\n2\n1');
});

test('shuffleLines 保持元素集合不变', () => {
  const input = 'a\nb\nc\nd\ne';
  const output = shuffleLines(input).split('\n');
  assert.equal(output.length, 5);
  assert.deepEqual([...output].sort(), ['a', 'b', 'c', 'd', 'e']);
});

test('shuffleLines 可注入随机源以便复现', () => {
  const deterministic = shuffleLines('a\nb\nc', () => 0);
  assert.equal(deterministic, 'b\nc\na');
});

test('removeEmptyLines 去掉空行与纯空白行', () => {
  assert.equal(removeEmptyLines('a\n\n \nb'), 'a\nb');
});

test('trimLines 去掉每行首尾空白', () => {
  assert.equal(trimLines('  a  \n\tb\t'), 'a\nb');
});

test('addAffix 为每行加前后缀', () => {
  assert.equal(addAffix('a\nb', { prefix: '- ', suffix: ';' }), '- a;\n- b;');
});

test('numberLines 支持起始值与补零', () => {
  assert.equal(numberLines('a\nb'), '1. a\n2. b');
  assert.equal(numberLines('a\nb', { separator: ') ', start: 0, pad: true }), '0) a\n1) b');
  // 行数不足以让位数变化时不补零
  assert.equal(numberLines('a\nb', { start: 8, pad: true }), '8. a\n9. b');
  // 跨到两位数时统一补齐到两位
  assert.equal(numberLines('a\nb\nc\nd\ne', { start: 8, pad: true }), '08. a\n09. b\n10. c\n11. d\n12. e');
});

/* ── 过滤与连接 ───────────────────────────────────────────── */

test('filterLines 保留匹配行', () => {
  assert.equal(filterLines('apple\nbanana\navocado', '^a'), 'apple\navocado');
});

test('filterLines 支持反向剔除', () => {
  assert.equal(filterLines('apple\nbanana\navocado', '^a', { invert: true }), 'banana');
});

test('filterLines 对非法正则抛出可读错误', () => {
  assert.throws(() => filterLines('a', '['), /正则无效/);
  assert.equal(filterLines('a\nb', ''), 'a\nb');
});

test('joinLines 与 splitToLines 互逆', () => {
  assert.equal(joinLines('a\nb\nc', ' | '), 'a | b | c');
  assert.equal(splitToLines('a,b,c', ','), 'a\nb\nc');
  assert.equal(splitToLines('abc', ''), 'abc');
});

test('wrapText 按宽度换行且不切断单词', () => {
  const wrapped = wrapText('aaa bbb ccc ddd', 7);
  assert.deepEqual(wrapped.split('\n'), ['aaa bbb', 'ccc ddd']);
  assert.equal(wrapText('short', 10), 'short');
});

/* ── 空白与清理 ───────────────────────────────────────────── */

test('collapseSpaces 合并连续空格但保留换行', () => {
  assert.equal(collapseSpaces('a   b\t\tc'), 'a b c');
  assert.equal(collapseSpaces('a  \n  b'), 'a\nb');
});

test('removeAllSpaces 删除所有空白', () => {
  assert.equal(removeAllSpaces(' a b\nc '), 'abc');
});

test('removeLineBreaks 把换行替换为指定分隔符', () => {
  assert.equal(removeLineBreaks('a\nb\nc'), 'a b c');
  assert.equal(removeLineBreaks('a\n\nb', ''), 'ab');
});

test('collapseBlankLines 最多保留一个空行', () => {
  assert.equal(collapseBlankLines('a\n\n\n\nb'), 'a\n\nb');
});

test('stripHtmlTags 移除标签并还原常见实体', () => {
  assert.equal(stripHtmlTags('<p>a</p><b>b</b>'), 'ab');
  assert.equal(stripHtmlTags('<script>alert(1)</script>ok'), 'ok');
  assert.equal(stripHtmlTags('a&nbsp;b &amp; c &lt;d&gt;'), 'a b & c <d>');
});

test('removePunctuation 去掉中英文标点但保留文字', () => {
  assert.equal(removePunctuation('你好，世界！'), '你好世界');
  assert.equal(removePunctuation('a-b.c!'), 'abc');
});

test('normalizeNewlines 与 toLineArray 处理 CRLF', () => {
  assert.equal(normalizeNewlines('a\r\nb\rc'), 'a\nb\nc');
  assert.deepEqual(toLineArray('a\r\nb'), ['a', 'b']);
});

/* ── 转义 ─────────────────────────────────────────────────── */

test('ESCAPE_OPS 全部可调用', () => {
  assert.ok(ESCAPE_OPS.length >= 4);
  for (const op of ESCAPE_OPS) {
    assert.equal(typeof op.run('a"b'), 'string', op.id);
    assert.ok(op.hint, op.id);
  }
});

test('escapeRegExp 让特殊字符可安全用于正则', () => {
  const escaped = escapeRegExp('a.b*c(d)');
  assert.equal(escaped, 'a\\.b\\*c\\(d\\)');
  assert.equal(new RegExp(escaped).test('a.b*c(d)'), true);
  assert.equal(new RegExp(escaped).test('axbYcZd'), false);
});

test('escapeShellArg 用单引号包裹并处理内部引号', () => {
  assert.equal(escapeShellArg('hello'), "'hello'");
  assert.equal(escapeShellArg("it's"), "'it'\\''s'");
});

test('escapeCsvField 仅在必要时加引号', () => {
  assert.equal(escapeCsvField('plain'), 'plain');
  assert.equal(escapeCsvField('a,b'), '"a,b"');
  assert.equal(escapeCsvField('say "hi"'), '"say ""hi"""');
  assert.equal(escapeCsvField('line\nbreak'), '"line\nbreak"');
});

test('escapeHtmlText 转义全部敏感字符', () => {
  assert.equal(escapeHtmlText('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
});

/* ── 统计 ─────────────────────────────────────────────────── */

test('textStats 逐项统计正确', () => {
  const stats = textStats('Hello 世界\n\nsecond line');
  assert.equal(stats.lines, 3);
  assert.equal(stats.paragraphs, 2);
  assert.equal(stats.words, 3);
  assert.equal(stats.cjk, 2);
  assert.equal(stats.emptyLines, 1);
  assert.equal(stats.longestLine, 'second line'.length);
});

test('textStats 按码点计数字符（emoji 算一个）', () => {
  const stats = textStats('a😀b');
  assert.equal(stats.chars, 3);
  assert.equal(stats.bytes, 6);
  assert.equal(stats.charsNoSpaces, 3);
});

test('textStats 对空文本返回全零而不是 1 行', () => {
  const stats = textStats('');
  assert.equal(stats.lines, 0);
  assert.equal(stats.paragraphs, 0);
  assert.equal(stats.chars, 0);
  assert.equal(stats.longestLine, 0);
});

test('textStats 统计空白与中文字符', () => {
  const stats = textStats('a b\n中文');
  assert.equal(stats.charsNoSpaces, 4);
  assert.equal(stats.cjk, 2);
  assert.equal(stats.bytes, 10);
});
