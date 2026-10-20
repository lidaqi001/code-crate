import test from 'node:test';
import assert from 'node:assert/strict';

import {
  KEY_ENTRIES,
  KEY_CATEGORIES,
  searchKeys,
  findByCode,
  describeKeyPress,
  suggestHandler
} from '../src/tools/keycode/logic.js';

/* ── 数据完整性 ───────────────────────────────────────────── */

test('按键表覆盖主要类别', () => {
  assert.ok(KEY_ENTRIES.length >= 90);
  for (const category of KEY_CATEGORIES) {
    assert.ok(KEY_ENTRIES.some((entry) => entry.category === category), `缺少类别 ${category}`);
  }
});

test('每个条目字段完整且 code 唯一', () => {
  const codes = new Set();
  for (const entry of KEY_ENTRIES) {
    assert.equal(typeof entry.key, 'string', entry.code);
    assert.equal(typeof entry.code, 'string', entry.code);
    assert.equal(typeof entry.keyCode, 'number', entry.code);
    assert.ok(entry.category, entry.code);
    assert.ok(entry.note, entry.code);
    assert.equal(codes.has(entry.code), false, `code 重复：${entry.code}`);
    codes.add(entry.code);
  }
});

test('字母与数字的字段符合惯例', () => {
  assert.deepEqual(findByCode('KeyA'), { key: 'a', code: 'KeyA', keyCode: 65, category: '字母', note: 'A 键' });
  assert.equal(findByCode('KeyZ').keyCode, 90);
  assert.equal(findByCode('Digit0').keyCode, 48);
  assert.equal(findByCode('Digit9').keyCode, 57);
  assert.equal(findByCode('F1').keyCode, 112);
  assert.equal(findByCode('F12').keyCode, 123);
});

test('左右修饰键分开记录', () => {
  assert.equal(findByCode('ControlLeft').keyCode, 17);
  assert.equal(findByCode('ControlRight').keyCode, 17);
  assert.notEqual(findByCode('ShiftLeft').note, findByCode('ShiftRight').note);
  assert.equal(findByCode('MetaLeft').keyCode, 91);
});

test('小键盘与主键盘分开', () => {
  assert.equal(findByCode('Numpad1').key, '1');
  assert.equal(findByCode('Digit1').key, '1');
  assert.equal(findByCode('Numpad1').category, '小键盘');
  assert.equal(findByCode('NumpadEnter').keyCode, 13);
});

test('findByCode 对未知 code 返回 null', () => {
  assert.equal(findByCode('Nope'), null);
  assert.equal(findByCode(''), null);
  assert.equal(findByCode(undefined), null);
});

/* ── 搜索 ─────────────────────────────────────────────────── */

test('空查询返回全部（受 limit 限制）', () => {
  assert.equal(searchKeys('').length, Math.min(200, KEY_ENTRIES.length));
  assert.equal(searchKeys('', { limit: 5 }).length, 5);
});

test('按 code 精确搜索排在最前', () => {
  const results = searchKeys('KeyA');
  assert.equal(results[0].code, 'KeyA');
});

test('按 keyCode 数字搜索', () => {
  const results = searchKeys('13');
  assert.ok(results.some((entry) => entry.code === 'Enter'));
  assert.ok(results.some((entry) => entry.code === 'NumpadEnter'));
});

test('按中文说明搜索', () => {
  const results = searchKeys('回车');
  assert.ok(results.length >= 2);
  assert.ok(results.every((entry) => entry.note.includes('回车') || entry.key === 'Enter' || entry.keyCode === 13));
});

test('按分类过滤', () => {
  const results = searchKeys('', { category: '功能键' });
  assert.ok(results.length >= 12);
  assert.ok(results.every((entry) => entry.category === '功能键'));
});

test('搜索大小写不敏感且无匹配时返回空', () => {
  assert.equal(searchKeys('keya')[0].code, 'KeyA');
  assert.equal(searchKeys('KEYA')[0].code, 'KeyA');
  assert.deepEqual(searchKeys('绝对不存在的按键'), []);
});

/* ── 按键描述 ─────────────────────────────────────────────── */

test('describeKeyPress 输出组合键与字段', () => {
  const info = describeKeyPress({ key: 'a', code: 'KeyA', keyCode: 65 });
  assert.equal(info.combo, 'a');
  assert.equal(info.code, 'KeyA');
  assert.equal(info.keyCode, 65);
  assert.equal(info.category, '字母');
});

test('describeKeyPress 组合修饰键', () => {
  const info = describeKeyPress({ key: 'a', code: 'KeyA', keyCode: 65, ctrlKey: true, shiftKey: true });
  assert.equal(info.combo, 'Ctrl + Shift + a');
});

test('describeKeyPress 把空格显示为 Space', () => {
  const info = describeKeyPress({ key: ' ', code: 'Space', keyCode: 32 });
  assert.equal(info.combo, 'Space');
  assert.equal(info.key, 'Space');
});

test('describeKeyPress 对未收录按键给出提示', () => {
  const info = describeKeyPress({ key: 'Unidentified', code: 'Weird', keyCode: 0 });
  assert.equal(info.category, '未收录');
  assert.match(info.note, /不在速查表/);
});

test('describeKeyPress 容忍空事件对象', () => {
  assert.doesNotThrow(() => describeKeyPress());
  const info = describeKeyPress({});
  assert.equal(info.code, '');
  assert.equal(info.keyCode, null);
});

test('describeKeyPress 标记长按重复', () => {
  assert.equal(describeKeyPress({ key: 'a', code: 'KeyA', repeat: true }).repeat, true);
  assert.equal(describeKeyPress({ key: 'a', code: 'KeyA' }).repeat, false);
});

/* ── 代码片段 ─────────────────────────────────────────────── */

test('suggestHandler 生成判定片段', () => {
  const snippet = suggestHandler({ key: 'k', code: 'KeyK', ctrlKey: true });
  assert.match(snippet, /event\.code === 'KeyK'/);
  assert.match(snippet, /event\.ctrlKey \|\| event\.metaKey/);
  assert.match(snippet, /preventDefault/);
});

test('suggestHandler 在无 code 时返回空串', () => {
  assert.equal(suggestHandler({ key: 'a' }), '');
});
