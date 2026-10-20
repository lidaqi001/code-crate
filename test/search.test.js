import test from 'node:test';
import assert from 'node:assert/strict';
import { fuzzyScore } from '../src/core/search.js';

test('空查询视为命中', () => {
  assert.equal(fuzzyScore('', 'json 工具'), 1);
  assert.equal(fuzzyScore('   ', 'json 工具'), 1);
});

test('连续子串得分高于散落子序列', () => {
  const direct = fuzzyScore('json', 'json 工具');
  const scattered = fuzzyScore('json', 'j-s-o-n 工具');
  assert.ok(direct > scattered);
  assert.ok(scattered > 0);
});

test('子串位置越靠前得分越高', () => {
  assert.ok(fuzzyScore('json', 'json 格式化') > fuzzyScore('json', '格式化 json'));
});

test('大小写与多 token', () => {
  assert.ok(fuzzyScore('JSON format', 'JSON 格式化 format') > 0);
  assert.equal(fuzzyScore('json missing', 'json 工具'), 0);
});

test('完全无关返回 0', () => {
  assert.equal(fuzzyScore('zzz', 'json 工具'), 0);
  assert.equal(fuzzyScore('jj', 'json 工具'), 0);
});
