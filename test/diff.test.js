import test from 'node:test';
import assert from 'node:assert/strict';

import {
  diffLines,
  diffWords,
  inlineSegments,
  diffStats,
  unifiedDiff,
  diffJson,
  splitLines,
  tokenizeWords,
  buildComparator
} from '../src/tools/diff/logic.js';

const SYMBOL = { equal: '=', insert: '+', delete: '-' };
const types = (ops) => ops.map((op) => SYMBOL[op.type]).join('');

/* ── 行级差异 ─────────────────────────────────────────────── */

test('完全相同的内容没有差异', () => {
  const result = diffLines('a\nb\nc', 'a\nb\nc');
  assert.equal(result.stats.added, 0);
  assert.equal(result.stats.removed, 0);
  assert.equal(result.stats.unchanged, 3);
  assert.equal(result.stats.similarity, 1);
  assert.equal(types(result.ops), '===');
});

test('插入一行只产生一处新增（不是逐行对位比较）', () => {
  // 这正是「逐行比较」实现会答错的地方：它会报告后面每一行都变了
  const result = diffLines('A\nB\nC', 'X\nA\nB\nC');
  assert.equal(result.stats.added, 1);
  assert.equal(result.stats.removed, 0);
  assert.equal(result.stats.unchanged, 3);
  assert.equal(types(result.ops), '+===');
  assert.equal(result.ops[0].text, 'X');
  assert.equal(result.ops[0].rightIndex, 0);
});

test('删除一行只产生一处删除', () => {
  const result = diffLines('A\nB\nC', 'A\nC');
  assert.equal(result.stats.added, 0);
  assert.equal(result.stats.removed, 1);
  assert.equal(result.stats.unchanged, 2);
  assert.equal(types(result.ops), '=-=');
  assert.equal(result.ops[1].text, 'B');
});

test('中间行被修改识别为一次删除加一次新增', () => {
  const result = diffLines('a\nb\nc', 'a\nB\nc');
  assert.equal(result.stats.added, 1);
  assert.equal(result.stats.removed, 1);
  assert.equal(result.stats.unchanged, 2);
  assert.equal(types(result.ops), '=-+=');
});

test('空文本与非空文本互相比较', () => {
  const toEmpty = diffLines('a\nb', '');
  assert.equal(toEmpty.stats.removed, 2);

  const fromEmpty = diffLines('', 'a\nb');
  assert.equal(fromEmpty.stats.added, 2);

  const bothEmpty = diffLines('', '');
  assert.equal(bothEmpty.stats.changed, 0);
});

test('左侧与右侧行号连续且与原文一致', () => {
  const result = diffLines('a\nb\nc\nd', 'a\nX\nc\nd');
  for (const op of result.ops) {
    if (op.leftIndex !== null) assert.equal(result.ops.filter((o) => o.leftIndex !== null).indexOf(op), op.leftIndex);
  }
  const inserts = result.ops.filter((op) => op.type === 'insert');
  assert.equal(inserts[0].text, 'X');
  assert.equal(inserts[0].leftIndex, null);
});

test('相同的前后缀被正确裁剪', () => {
  const left = ['h1', 'h2', 'a', 'b', 'f1', 'f2'].join('\n');
  const right = ['h1', 'h2', 'a', 'x', 'f1', 'f2'].join('\n');
  const result = diffLines(left, right);
  assert.equal(result.prefixEqual, 3);
  assert.equal(result.stats.added, 1);
  assert.equal(result.stats.removed, 1);
  assert.equal(result.stats.unchanged, 5);
});

test('忽略大小写选项生效', () => {
  const strict = diffLines('Hello', 'hello');
  assert.equal(strict.stats.changed, 2);

  const loose = diffLines('Hello', 'hello', { ignoreCase: true });
  assert.equal(loose.stats.changed, 0);
});

test('忽略空白选项生效', () => {
  const strict = diffLines('a  b', 'a b');
  assert.equal(strict.stats.changed, 2);

  const loose = diffLines('a  b', 'a b', { ignoreWhitespace: true });
  assert.equal(loose.stats.changed, 0);
});

test('超大规模输入会标记 truncated 而不是卡死', () => {
  const left = Array.from({ length: 2500 }, (_, i) => `l${i}`).join('\n');
  const right = Array.from({ length: 2500 }, (_, i) => (i % 2 ? `r${i}` : `l${i}`)).join('\n');
  const result = diffLines(left, right, { maxCells: 1000 });
  assert.equal(result.truncated, true);
  assert.ok(result.ops.length >= 2500);
});

test('构建比较函数：默认严格相等', () => {
  const equals = buildComparator();
  assert.equal(equals('a', 'a'), true);
  assert.equal(equals('a', 'A'), false);
});

/* ── 词级差异 ─────────────────────────────────────────────── */

test('splitLines 兼容 CRLF 与 LF', () => {
  assert.deepEqual(splitLines('a\r\nb'), ['a', 'b']);
  assert.deepEqual(splitLines('a\nb'), ['a', 'b']);
  assert.deepEqual(splitLines('a\rb'), ['a', 'b']);
  assert.deepEqual(splitLines(''), []);
});

test('tokenizeWords 保留空白片段', () => {
  assert.deepEqual(tokenizeWords('a b'), ['a', ' ', 'b']);
  assert.deepEqual(tokenizeWords(''), []);
});

test('diffWords 只标出改动的那一个词', () => {
  const result = diffWords('the quick fox', 'the slow fox');
  assert.equal(result.stats.unchanged >= 3, true);
  assert.equal(result.stats.added, 1);
  assert.equal(result.stats.removed, 1);
});

test('inlineSegments 返回可直接渲染的片段', () => {
  const segments = inlineSegments('price: 10', 'price: 20');
  const combined = segments.map((s) => s.text).join('');
  assert.equal(combined.includes('10'), true);
  assert.equal(combined.includes('20'), true);
  assert.ok(segments.every((s) => ['equal', 'insert', 'delete'].includes(s.type)));
});

test('diffStats 相似度在 0 到 1 之间', () => {
  assert.equal(diffStats([{ type: 'equal' }]).similarity, 1);
  assert.equal(diffStats([{ type: 'insert' }, { type: 'delete' }]).similarity, 0);
  assert.equal(diffStats([]).similarity, 1);
});

/* ── 统一 diff ────────────────────────────────────────────── */

test('unifiedDiff 生成标准头部与块头', () => {
  const result = diffLines('a\nb\nc', 'a\nX\nc');
  const text = unifiedDiff(result, { fileA: 'old.txt', fileB: 'new.txt' });
  const lines = text.split('\n');
  assert.equal(lines[0], '--- old.txt');
  assert.equal(lines[1], '+++ new.txt');
  assert.match(lines[2], /^@@ -\d+,\d+ \+\d+,\d+ @@$/);
  assert.ok(lines.includes('-b'));
  assert.ok(lines.includes('+X'));
  assert.ok(lines.includes(' a'));
});

test('unifiedDiff 对无差异只输出文件头', () => {
  const result = diffLines('a\nb', 'a\nb');
  const text = unifiedDiff(result);
  assert.equal(text.split('\n').length, 2);
});

test('unifiedDiff 把相隔较远的改动拆成多个块', () => {
  const left = Array.from({ length: 40 }, (_, i) => `line${i}`);
  const right = [...left];
  right[2] = 'changed2';
  right[30] = 'changed30';
  const result = diffLines(left.join('\n'), right.join('\n'));
  const text = unifiedDiff(result, { context: 2 });
  const hunks = text.split('\n').filter((line) => line.startsWith('@@'));
  assert.equal(hunks.length, 2);
});

test('unifiedDiff 的块头行号可用', () => {
  const result = diffLines('a\nb\nc\nd\ne', 'a\nb\nX\nd\ne');
  const text = unifiedDiff(result, { context: 1 });
  const header = text.split('\n').find((line) => line.startsWith('@@'));
  assert.match(header, /@@ -2,3 \+2,3 @@/);
});

/* ── JSON 结构差异 ────────────────────────────────────────── */

test('diffJson 识别新增、删除与修改', () => {
  const result = diffJson(
    JSON.stringify({ a: 1, b: 2, c: { d: 3 } }),
    JSON.stringify({ a: 1, b: 9, c: { d: 3 }, e: 4 })
  );
  assert.equal(result.ok, true);
  const byType = result.changes.reduce((acc, change) => {
    acc[change.type] = (acc[change.type] || 0) + 1;
    return acc;
  }, {});
  assert.equal(byType.changed, 1);
  assert.equal(byType.added, 1);
  assert.equal(result.changes.find((c) => c.type === 'changed').path, '$.b');
  assert.equal(result.changes.find((c) => c.type === 'added').path, '$.e');
});

test('diffJson 数组按下标比较并反映长度变化', () => {
  const result = diffJson(JSON.stringify([1, 2, 3]), JSON.stringify([1, 9]));
  assert.equal(result.ok, true);
  assert.equal(result.changes.length, 2);
  assert.equal(result.changes[0].path, '$[1]');
  assert.equal(result.changes[0].type, 'changed');
  assert.equal(result.changes[1].type, 'removed');
  assert.equal(result.changes[1].path, '$[2]');
});

test('diffJson 检测类型变化', () => {
  const result = diffJson(JSON.stringify({ a: 1 }), JSON.stringify({ a: '1' }));
  assert.equal(result.changes[0].type, 'changed');
  assert.match(result.changes[0].reason, /number.*string/);
});

test('diffJson 使用 hasOwnProperty，不受原型链干扰', () => {
  const result = diffJson(JSON.stringify({ a: 1 }), JSON.stringify({ a: 1, toString: 'x' }));
  assert.equal(result.ok, true);
  assert.equal(result.changes.length, 1);
  assert.equal(result.changes[0].type, 'added');
  assert.equal(result.changes[0].path, '$.toString');
});

test('diffJson 对特殊键名生成可读路径', () => {
  const result = diffJson(JSON.stringify({ 'a-b': 1 }), JSON.stringify({ 'a-b': 2 }));
  assert.equal(result.changes[0].path, '$["a-b"]');
});

test('diffJson 嵌套路径正确', () => {
  const result = diffJson(
    JSON.stringify({ user: { tags: ['a', 'b'] } }),
    JSON.stringify({ user: { tags: ['a', 'c'] } })
  );
  assert.equal(result.changes[0].path, '$.user.tags[1]');
});

test('diffJson 对非法 JSON 返回错误而不是抛异常', () => {
  assert.equal(diffJson('{bad}', '{}').ok, false);
  assert.match(diffJson('{}', '{bad}').error, /右侧/);
});

test('diffJson 相同内容没有变化', () => {
  const result = diffJson('{"a":[1,2]}', '{"a":[1,2]}');
  assert.deepEqual(result.changes, []);
});

test('统一补丁的起始行不为 0（纯插入/删除除外）', () => {
  const patch = unifiedDiff(diffLines('a\nx\ny', 'b\nx\ny'));
  assert.ok(patch.includes('@@ -1,3 +1,3 @@'), patch);

  const create = unifiedDiff(diffLines('', 'a\nb'));
  assert.ok(create.includes('@@ -0,0 +1,2 @@'), create);

  const remove = unifiedDiff(diffLines('a\nb', ''));
  assert.ok(remove.includes('@@ -1,2 +0,0 @@'), remove);
});
