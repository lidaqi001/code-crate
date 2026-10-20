import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compileRegex,
  findMatches,
  replaceWith,
  splitBy,
  detectRisk,
  explainPattern,
  COMMON_PATTERNS,
  FLAG_INFO
} from '../src/tools/regex/logic.js';

/* ── 编译 ─────────────────────────────────────────────────── */

test('compileRegex 自动补上 g 标志', () => {
  const result = compileRegex('a');
  assert.equal(result.ok, true);
  assert.ok(result.regex.global);
  assert.equal(result.regex.flags.includes('g'), true);
});

test('compileRegex 保留 i / m / s / u 标志并去重', () => {
  const result = compileRegex('a', 'iimm');
  assert.equal(result.ok, true);
  assert.ok(result.regex.ignoreCase);
  assert.ok(result.regex.multiline);
  assert.equal(result.regex.flags.split('i').length - 1, 1);
});

test('compileRegex 对非法表达式返回错误而不是抛异常', () => {
  assert.equal(compileRegex('[').ok, false);
  assert.equal(compileRegex('(').ok, false);
  assert.match(compileRegex('[').error, /\S/);
  assert.equal(compileRegex('').ok, false);
});

/* ── 匹配 ─────────────────────────────────────────────────── */

test('findMatches 返回位置与完整匹配', () => {
  const { regex } = compileRegex('\\d+');
  const matches = findMatches(regex, 'a1 bb22 c333');
  assert.deepEqual(matches.map((m) => m.value), ['1', '22', '333']);
  // 'a1 bb22 c333' 中 '22' 起于下标 5
  assert.deepEqual(matches.map((m) => m.index), [1, 5, 9]);
  assert.equal(matches[2].end - matches[2].index, 3);
});

test('findMatches 返回编号分组与命名分组', () => {
  const { regex } = compileRegex('(?<key>\\w+)=(\\d+)');
  const matches = findMatches(regex, 'a=1 b=22');
  assert.equal(matches.length, 2);
  assert.equal(matches[0].groups.length, 2);
  assert.equal(matches[0].groups[0].value, 'a');
  assert.equal(matches[0].groups[1].value, '1');
  assert.equal(matches[1].groups[1].value, '22');
  assert.deepEqual(matches[0].named, { key: 'a' });
});

test('findMatches 给出分组位置', () => {
  const { regex } = compileRegex('(\\d)(\\d)');
  const [match] = findMatches(regex, 'ab12');
  assert.equal(match.value, '12');
  assert.equal(match.groups[0].start, 2);
  assert.equal(match.groups[0].end, 3);
  assert.equal(match.groups[1].start, 3);
});

test('findMatches 能安全处理零宽匹配而不会死循环', () => {
  const { regex } = compileRegex('a*');
  const matches = findMatches(regex, 'bb');
  // 'a*' 在 'bb' 上每个位置都匹配空串，必须是有限个
  assert.ok(matches.length > 0);
  assert.ok(matches.length <= 4, `实际 ${matches.length}`);
  assert.ok(matches.every((m) => m.value === ''));
});

test('findMatches 遵循 limit 上限', () => {
  const { regex } = compileRegex('\\d');
  const matches = findMatches(regex, '1234567890', { limit: 3 });
  assert.equal(matches.length, 3);
});

test('findMatches 对无匹配返回空数组', () => {
  const { regex } = compileRegex('zzz');
  assert.deepEqual(findMatches(regex, 'abc'), []);
});

/* ── 替换与分割 ───────────────────────────────────────────── */

test('replaceWith 支持 $1 展开并统计次数', () => {
  const { regex } = compileRegex('(\\w+)@(\\w+)');
  const { result, count } = replaceWith(regex, 'a@b c@d', '$2<$1>');
  assert.equal(result, 'b<a> d<c>');
  assert.equal(count, 2);
});

test('replaceWith 支持 $<name> 命名分组', () => {
  const { regex } = compileRegex('(?<y>\\d{4})-(?<m>\\d{2})');
  const { result } = replaceWith(regex, '2026-05', '$<m>/$<y>');
  assert.equal(result, '05/2026');
});

test('replaceWith 在无匹配时返回原文且次数为 0', () => {
  const { regex } = compileRegex('zzz');
  const { result, count } = replaceWith(regex, 'abc', 'x');
  assert.equal(result, 'abc');
  assert.equal(count, 0);
});

test('splitBy 按正则切分', () => {
  const { regex } = compileRegex('[,;]\\s*');
  assert.deepEqual(splitBy(regex, 'a, b;c'), ['a', 'b', 'c']);
});

/* ── 风险识别 ─────────────────────────────────────────────── */

test('detectRisk 识别嵌套量词', () => {
  const result = detectRisk('(a+)+$');
  assert.equal(result.risky, true);
  assert.ok(result.reasons.length > 0);
});

test('detectRisk 识别量词修饰的或分组', () => {
  assert.equal(detectRisk('(a|aa)+$').risky, true);
});

test('detectRisk 对安全表达式不误报', () => {
  assert.equal(detectRisk('^\\d{4}-\\d{2}$').risky, false);
  assert.equal(detectRisk('^[^\\s@]+@[^\\s@]+$').risky, false);
  assert.equal(detectRisk('[a-z]+').risky, false);
});

/* ── 解释器 ───────────────────────────────────────────────── */

test('explainPattern 解释锚点、字符类与量词（量词并入前一个片段）', () => {
  const tokens = explainPattern('^\\d{3,5}$');
  assert.equal(tokens.length, 3);
  assert.equal(tokens[0].token, '^');
  assert.match(tokens[0].description, /行首/);
  assert.equal(tokens[1].token, '\\d{3,5}');
  assert.match(tokens[1].description, /数字/);
  assert.match(tokens[1].description, /重复 3 到 5 次/);
  assert.match(tokens[2].description, /行尾/);
});

test('explainPattern 区分捕获组与各类断言', () => {
  const tokens = explainPattern('(a)(?:b)(?=c)(?!d)(?<=e)(?<!f)(?<name>g)');
  const descriptions = tokens.map((t) => t.description);
  assert.ok(descriptions.some((d) => d.includes('捕获分组')));
  assert.ok(descriptions.some((d) => d.includes('非捕获')));
  assert.ok(descriptions.some((d) => d.includes('先行断言')));
  assert.ok(descriptions.some((d) => d.includes('否定先行')));
  assert.ok(descriptions.some((d) => d.includes('后行断言')));
  assert.ok(descriptions.some((d) => d.includes('否定后行')));
  assert.ok(descriptions.some((d) => d.includes('命名捕获分组')));
});

test('explainPattern 处理字符类、转义与字面量合并', () => {
  const tokens = explainPattern('[a-z0-9_]+\\.txt');
  assert.match(tokens[0].description, /字符类/);
  assert.equal(tokens[0].token, '[a-z0-9_]+');
  assert.ok(tokens.some((t) => t.token === '\\.'));
  assert.ok(tokens.some((t) => t.token === 'txt'));
});

test('explainPattern 支持反向引用与 Unicode 码点', () => {
  const tokens = explainPattern('(a)\\1\\u{1F600}\\k<n>');
  assert.ok(tokens.some((t) => t.description.includes('反向引用第 1 个捕获组')));
  assert.ok(tokens.some((t) => t.description.includes('Unicode 码点')));
  assert.ok(tokens.some((t) => t.description.includes('反向引用命名分组')));
});

test('explainPattern 处理懒惰量词', () => {
  const tokens = explainPattern('a+?');
  const last = tokens[tokens.length - 1];
  assert.match(last.description, /懒惰/);
});

test('explainPattern 不因畸形输入抛异常', () => {
  for (const input of ['\\', '[', '(', 'a{', '[a-', '(?<']) {
    assert.doesNotThrow(() => explainPattern(input), input);
  }
});

/* ── 速查表 ───────────────────────────────────────────────── */

test('COMMON_PATTERNS 全部可编译且带说明', () => {
  assert.ok(COMMON_PATTERNS.length >= 10);
  for (const entry of COMMON_PATTERNS) {
    assert.ok(entry.name && entry.pattern && entry.note, entry.name);
    const compiled = compileRegex(entry.pattern);
    assert.equal(compiled.ok, true, `${entry.name} 编译失败：${compiled.error}`);
  }
});

test('COMMON_PATTERNS 的示例能被自身匹配', () => {
  for (const entry of COMMON_PATTERNS) {
    const { regex } = compileRegex(entry.pattern);
    const matches = findMatches(regex, entry.sample);
    assert.ok(matches.length > 0, `${entry.name} 未匹配自己的示例 ${entry.sample}`);
  }
});

test('FLAG_INFO 覆盖界面暴露的标志', () => {
  assert.deepEqual(FLAG_INFO.map((f) => f.flag), ['i', 'm', 's', 'u']);
});

test('零宽匹配在 u 模式下按码点推进', () => {
  const compiled = compileRegex('\\b', 'u');
  const matches = findMatches(compiled.regex, 'a😀b', { limit: 20 });
  const indices = matches.map((match) => match.index);
  assert.equal(new Set(indices).size, indices.length);
  assert.deepEqual(indices, [0, 1, 3, 4]);

  const replaced = replaceWith(compileRegex('\\b', 'u').regex, 'a😀b', 'X');
  assert.equal(replaced.result, 'XaX😀XbX');
  assert.equal(replaced.count, 4);
});
