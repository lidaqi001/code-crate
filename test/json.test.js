import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseJson,
  formatJson,
  minifyJson,
  sortKeysDeep,
  formatSorted,
  escapeJsonString,
  unescapeJsonString,
  jsonStats,
  queryJsonPath,
  toTypeScript,
  toJsonSchema,
  valueKind
} from '../src/tools/json/logic.js';

test('parseJson 接受合法输入并返回值', () => {
  const result = parseJson('{"a":1}');
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { a: 1 });
});

test('parseJson 对空输入给出明确错误', () => {
  const result = parseJson('   ');
  assert.equal(result.ok, false);
  assert.match(result.error.message, /为空/);
});

test('parseJson 报错带行列号（V8 未给位置时由内置扫描器补全）', () => {
  const result = parseJson('{\n  "a": 1,\n  "b": ,\n}');
  assert.equal(result.ok, false);
  assert.equal(result.error.line, 3);
  assert.equal(typeof result.error.column, 'number');
  assert.ok(result.error.column > 0);
});

test('parseJson 对 V8 自带位置信息的错误同样给出行列号', () => {
  const result = parseJson('{\n  bad: 1\n}');
  assert.equal(result.ok, false);
  assert.equal(result.error.line, 2);
  assert.equal(result.error.column, 3);
});

test('parseJson 对未闭合结构定位到出错处', () => {
  const result = parseJson('{"a": [1, 2');
  assert.equal(result.ok, false);
  assert.equal(result.error.line, 1);
  assert.ok(result.error.column > 1);
});

test('formatJson 支持 2 / 4 / tab 缩进', () => {
  assert.equal(formatJson('{"a":[1,2]}', 2), '{\n  "a": [\n    1,\n    2\n  ]\n}');
  assert.match(formatJson('{"a":1}', 4), /^    "a"/m);
  assert.match(formatJson('{"a":1}', 'tab'), /^\t"a"/m);
});

test('formatJson 对非法输入抛出带行列号的错误', () => {
  assert.throws(() => formatJson('{bad}'), (error) => {
    assert.ok(error.line >= 1);
    return true;
  });
});

test('minifyJson 压缩空白', () => {
  assert.equal(minifyJson('{\n  "a": 1\n}'), '{"a":1}');
});

test('sortKeysDeep 递归排序但保持数组顺序', () => {
  const sorted = sortKeysDeep({ b: 1, a: { d: 2, c: 3 }, list: [{ y: 1, x: 2 }] });
  assert.deepEqual(Object.keys(sorted), ['a', 'b', 'list']);
  assert.deepEqual(Object.keys(sorted.a), ['c', 'd']);
  assert.deepEqual(Object.keys(sorted.list[0]), ['x', 'y']);
  const text = formatSorted('{"b":1,"a":2}');
  assert.equal(text, '{\n  "a": 2,\n  "b": 1\n}');
});

test('JSON 字符串字面量转义与还原可往返', () => {
  const raw = 'a"b\\c\n\t中文';
  const escaped = escapeJsonString(raw);
  assert.equal(escaped.startsWith('"'), true);
  assert.equal(unescapeJsonString(escaped), raw);
  assert.equal(unescapeJsonString(raw), raw);
});

test('jsonStats 统计节点、深度与类型', () => {
  const stats = jsonStats({ a: [1, 'x', true, null], b: { c: {} } });
  assert.equal(stats.nodes, 8);
  assert.equal(stats.objects, 3);
  assert.equal(stats.arrays, 1);
  assert.equal(stats.strings, 1);
  assert.equal(stats.numbers, 1);
  assert.equal(stats.booleans, 1);
  assert.equal(stats.nulls, 1);
  assert.equal(stats.depth, 3);
});

const SAMPLE = {
  store: {
    books: [
      { title: 'A', price: 5, tags: ['x'] },
      { title: 'B', price: 10, discount: true }
    ]
  },
  count: 2
};

test('JSONPath: 基础属性访问', () => {
  const result = queryJsonPath(SAMPLE, '$.store.books[0].title');
  assert.equal(result.ok, true);
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].value, 'A');
  assert.equal(result.matches[0].path, '$.store.books[0].title');
});

test('JSONPath: 通配符与负索引', () => {
  const titles = queryJsonPath(SAMPLE, '$.store.books[*].title');
  assert.deepEqual(titles.matches.map((m) => m.value), ['A', 'B']);

  const last = queryJsonPath(SAMPLE, '$.store.books[-1].title');
  assert.equal(last.matches[0].value, 'B');
});

test('JSONPath: 递归下降', () => {
  const prices = queryJsonPath(SAMPLE, '$..price');
  assert.equal(prices.ok, true);
  assert.deepEqual(prices.matches.map((m) => m.value), [5, 10]);
});

test('JSONPath: 递归通配符返回全部后代（不含根）', () => {
  const all = queryJsonPath({ a: { b: 1 } }, '$..*');
  assert.deepEqual(all.matches.map((m) => m.path), ['$.a', '$.a.b']);
});

test('JSONPath: 切片与联合', () => {
  const slice = queryJsonPath(SAMPLE, '$.store.books[0:1].title');
  assert.deepEqual(slice.matches.map((m) => m.value), ['A']);

  const union = queryJsonPath({ a: 1, b: 2, c: 3 }, "$['a','c']");
  assert.deepEqual(union.matches.map((m) => m.value), [1, 3]);
});

test('JSONPath: 无匹配时返回空数组而不是报错', () => {
  const result = queryJsonPath(SAMPLE, '$.store.missing');
  assert.equal(result.ok, true);
  assert.deepEqual(result.matches, []);
});

test('JSONPath: 非法路径给出错误', () => {
  const result = queryJsonPath(SAMPLE, '$.store[0');
  assert.equal(result.ok, false);
  assert.match(result.error, /\]/);
});

test('toTypeScript: 基本类型与嵌套对象', () => {
  const result = toTypeScript({ name: 'x', age: 1, ok: true, nothing: null }, 'User');
  assert.equal(result.ok, true);
  assert.match(result.code, /export interface User \{/);
  assert.match(result.code, /name: string;/);
  assert.match(result.code, /age: number;/);
  assert.match(result.code, /ok: boolean;/);
  assert.match(result.code, /nothing: null;/);
});

test('toTypeScript: 数组元素合并且缺失键标记为可选', () => {
  const result = toTypeScript({ books: [{ title: 'A' }, { title: 'B', price: 1 }] }, 'Root');
  assert.equal(result.ok, true);
  assert.match(result.code, /title: string;/);
  assert.match(result.code, /price\?: number;/);
  assert.match(result.code, /books: Book\[\];/);
});

test('toTypeScript: 结构相同的对象复用同一接口且只定义一次', () => {
  const result = toTypeScript({ a: { x: 1 }, b: { x: 2 } }, 'Root');
  assert.equal(result.ok, true);
  assert.match(result.code, /a: A;/);
  assert.match(result.code, /b: A;/);
  const definitions = result.code.match(/export interface A \{/g) || [];
  assert.equal(definitions.length, 1);
});

test('toTypeScript: 非标识符键名加引号', () => {
  const result = toTypeScript({ 'a-b': 1, ok: 2 }, 'Root');
  assert.match(result.code, /"a-b": number;/);
});

test('toJsonSchema: 生成 object/array/required', () => {
  const result = toJsonSchema({ id: 1, tags: ['a'] }, 'Item');
  assert.equal(result.ok, true);
  const schema = JSON.parse(result.code);
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(schema.title, 'Item');
  assert.equal(schema.type, 'object');
  assert.deepEqual(schema.required, ['id', 'tags']);
  assert.equal(schema.properties.id.type, 'integer');
  assert.equal(schema.properties.tags.type, 'array');
  assert.equal(schema.properties.tags.items.type, 'string');
});

test('toJsonSchema: 数组元素键不一致时只把公共键设为 required', () => {
  const schema = JSON.parse(toJsonSchema([{ a: 1, b: 2 }, { a: 1 }]).code);
  assert.equal(schema.type, 'array');
  assert.deepEqual(schema.items.required, ['a']);
  assert.ok('b' in schema.items.properties);
});

test('valueKind 覆盖全部 JSON 类型', () => {
  assert.equal(valueKind(null), 'null');
  assert.equal(valueKind([]), 'array');
  assert.equal(valueKind({}), 'object');
  assert.equal(valueKind(1), 'number');
  assert.equal(valueKind('a'), 'string');
  assert.equal(valueKind(true), 'boolean');
});
