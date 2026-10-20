import test from 'node:test';
import assert from 'node:assert/strict';

/* registry/storage 依赖 localStorage，这里给测试进程一个最小实现。
   node --test 每个测试文件独立进程，不会污染其他用例。 */
const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key)
};

const { recentToolIds, markToolUsed, TOOLS } = await import('../src/core/registry.js');

test('未使用过时返回空列表', () => {
  assert.deepEqual(recentToolIds(), []);
});

test('最近使用按时间倒序、去重', () => {
  markToolUsed('json');
  markToolUsed('codec');
  markToolUsed('json');
  assert.deepEqual(recentToolIds(), ['json', 'codec']);
});

test('最多保留 6 个', () => {
  store.set('codecrate:recent', JSON.stringify(TOOLS.map((tool) => tool.id)));
  markToolUsed('uuid');
  const ids = recentToolIds();
  assert.equal(ids.length, 6);
  assert.equal(ids[0], 'uuid');
});

test('忽略未登记的工具 id', () => {
  markToolUsed('not-a-tool');
  assert.ok(!recentToolIds().includes('not-a-tool'));
});

test('存储里混入脏数据时安全降级', () => {
  store.set('codecrate:recent', JSON.stringify(['json', 'gone', 42]));
  assert.deepEqual(recentToolIds(), ['json']);
  store.set('codecrate:recent', JSON.stringify('oops'));
  assert.deepEqual(recentToolIds(), []);
  store.set('codecrate:recent', '{bad json');
  assert.deepEqual(recentToolIds(), []);
});
