import test from 'node:test';
import assert from 'node:assert/strict';

/* storage 依赖 localStorage，这里给测试进程一个支持遍历的最小实现：
   迁移逻辑需要 length + key()，普通 Map 包装不够。 */
const store = new Map([
  ['devkit:theme', '"light"'],
  ['devkit:tool:json', '"{}"'],
  ['devkit:tool:codec', '"old"'],
  ['codecrate:tool:codec', '"new"']
]);
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
  key: (index) => [...store.keys()][index] ?? null,
  get length() {
    return store.size;
  }
};

const { migrateLegacyKeys } = await import('../src/core/storage.js');

test('旧 devkit: 键迁移到 codecrate: 并删除旧键', () => {
  assert.equal(store.has('devkit:theme'), false);
  assert.equal(store.has('devkit:tool:json'), false);
  assert.equal(store.get('codecrate:theme'), '"light"');
  assert.equal(store.get('codecrate:tool:json'), '"{}"');
  assert.equal(JSON.parse(store.get('codecrate:migrated')), true);
});

test('新命名空间已有同名键时以新值为准', () => {
  assert.equal(store.has('devkit:tool:codec'), false);
  assert.equal(store.get('codecrate:tool:codec'), '"new"');
});

test('迁移标记存在时不再重复扫描', () => {
  store.set('devkit:late', '"x"');
  migrateLegacyKeys();
  assert.equal(store.get('devkit:late'), '"x"');
});

test('清掉标记后可继续迁移剩余旧键', () => {
  store.delete('codecrate:migrated');
  migrateLegacyKeys();
  assert.equal(store.has('devkit:late'), false);
  assert.equal(store.get('codecrate:late'), '"x"');
});
