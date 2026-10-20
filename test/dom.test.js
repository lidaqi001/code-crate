/* dom.js 的行为测试。
   这里用手写的极小 DOM 替身，验证两件关键事情：
   1. h() 只接受文本子节点，绝不把字符串变成标签或属性（XSS 防线）
   2. .field 内的 label 与控件会被自动关联（无障碍） */

import test from 'node:test';
import assert from 'node:assert/strict';

/* ── 极小 DOM 替身 ────────────────────────────────────────── */

class FakeNode {}

class FakeText extends FakeNode {
  constructor(data) {
    super();
    this.nodeType = 3;
    this.data = String(data);
  }
  get textContent() {
    return this.data;
  }
}

class FakeElement extends FakeNode {
  constructor(tag) {
    super();
    this.nodeType = 1;
    this.tagName = String(tag).toUpperCase();
    this.childNodes = [];
    this.style = {};
    this.dataset = {};
    this.attributes = {};
    this.listeners = {};
    this.className = '';
    this._text = '';
  }

  get classList() {
    const self = this;
    return {
      contains(name) {
        return self.className.split(/\s+/).filter(Boolean).includes(name);
      }
    };
  }

  /** 真实 DOM 里 id 属性与 id 属性值是同步的，替身也要保持一致。 */
  get id() {
    return this.attributes.id || '';
  }

  set id(value) {
    this.attributes.id = String(value);
  }

  get firstChild() {
    return this.childNodes.length ? this.childNodes[0] : null;
  }

  appendChild(child) {
    this.childNodes.push(child);
    child.parentNode = this;
    return child;
  }

  removeChild(child) {
    this.childNodes = this.childNodes.filter((node) => node !== child);
  }

  replaceChildren(...children) {
    this.childNodes = [];
    for (const child of children) this.appendChild(child);
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  hasAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name);
  }

  addEventListener(type, handler) {
    this.listeners[type] = handler;
  }

  set textContent(value) {
    this._text = String(value);
    this.childNodes = [];
  }

  get textContent() {
    if (this.childNodes.length === 0) return this._text;
    return this.childNodes.map((child) => child.textContent).join('');
  }

  /** 只实现 dom.js 里实际用到的两种选择器。 */
  querySelector(selector) {
    const descendants = [];
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType !== 1) continue;
        descendants.push(child);
        walk(child);
      }
    };
    walk(this);

    if (selector === 'label:not([for])') {
      return descendants.find((node) => node.tagName === 'LABEL' && !node.hasAttribute('for')) || null;
    }
    if (selector === 'input, select, textarea') {
      return descendants.find((node) => ['INPUT', 'SELECT', 'TEXTAREA'].includes(node.tagName)) || null;
    }
    return null;
  }
}

globalThis.Node = FakeNode;
globalThis.document = {
  createElement: (tag) => new FakeElement(tag),
  createTextNode: (value) => new FakeText(value)
};
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);

const { h, clear, mount, escapeHtml, clamp } = await import('../src/core/dom.js');

/* ── 安全性 ───────────────────────────────────────────────── */

test('h() 把字符串子节点变成纯文本，不产生标签', () => {
  const node = h('div', {}, '<img src=x onerror=alert(1)>');
  assert.equal(node.childNodes.length, 1);
  assert.equal(node.childNodes[0].nodeType, 3);
  assert.equal(node.textContent, '<img src=x onerror=alert(1)>');
});

test('h() 拒绝 html 属性，避免有人绕开防线', () => {
  assert.throws(() => h('div', { html: '<b>x</b>' }), /不支持 html 属性/);
});

test('h() 不把属性值当作标签解析', () => {
  const node = h('img', { alt: '" onerror="alert(1)', src: 'x' });
  assert.equal(node.attributes.alt, '" onerror="alert(1)');
  assert.equal('onerror' in node.attributes, false);
});

test('h() 忽略 null / undefined / false 子节点', () => {
  const node = h('div', {}, null, undefined, false, 'ok', true);
  assert.equal(node.textContent, 'ok');
  assert.equal(node.childNodes.length, 1);
});

test('h() 支持嵌套数组子节点', () => {
  const node = h('div', {}, ['a', ['b', 'c']]);
  assert.equal(node.textContent, 'abc');
});

test('h() 绑定 on* 属性为事件监听', () => {
  let clicked = 0;
  const node = h('button', { onclick: () => { clicked += 1; } });
  node.listeners.click();
  assert.equal(clicked, 1);
});

test('h() 在值为 true 时输出空属性，false 时跳过', () => {
  const node = h('input', { disabled: true, checked: false, type: 'text' });
  assert.equal(node.hasAttribute('disabled'), true);
  assert.equal(node.hasAttribute('checked'), false);
  assert.equal(node.attributes.type, 'text');
});

/* ── 无障得：label 与控件自动关联 ─────────────────────────── */

test('.field 内的 label 自动关联到控件', () => {
  const input = h('input', { type: 'text' });
  const field = h('div', { class: 'field' }, h('label', { text: '用户名' }), input);

  const label = field.childNodes[0];
  assert.equal(label.tagName, 'LABEL');
  assert.equal(label.hasAttribute('for'), true);
  assert.equal(label.attributes.for, input.id);
  assert.ok(input.id.startsWith('codecrate-field-'));
});

test('label 位于包裹层内时同样能关联', () => {
  const input = h('input', { type: 'text' });
  const field = h('div', { class: 'field' },
    h('div', { class: 'field-head' }, h('label', { text: '输入' })),
    input
  );
  const label = field.childNodes[0].childNodes[0];
  assert.equal(label.attributes.for, input.id);
});

test('已有 id 的控件沿用原 id，不覆盖', () => {
  const input = h('input', { type: 'text', id: 'my-input' });
  const field = h('div', { class: 'field' }, h('label', { text: '名称' }), input);
  assert.equal(input.id, 'my-input');
  assert.equal(field.childNodes[0].attributes.for, 'my-input');
});

test('已有 for 的 label 不被改写', () => {
  const input = h('input', { type: 'text', id: 'x' });
  const field = h('div', { class: 'field' }, h('label', { for: 'x', text: '名称' }), input);
  assert.equal(field.childNodes[0].attributes.for, 'x');
});

test('没有 label 或没有控件时不报错', () => {
  assert.doesNotThrow(() => h('div', { class: 'field' }, h('input', { type: 'text' })));
  assert.doesNotThrow(() => h('div', { class: 'field' }, h('label', { text: '空' })));
  assert.doesNotThrow(() => h('div', { class: 'field' }, h('label', { text: '  ' }), h('input', {})));
});

test('各字段获得互不相同的 id', () => {
  const a = h('div', { class: 'field' }, h('label', { text: 'A' }), h('input', { type: 'text' }));
  const b = h('div', { class: 'field' }, h('label', { text: 'B' }), h('input', { type: 'text' }));
  assert.notEqual(a.childNodes[1].id, b.childNodes[1].id);
});

/* ── 其它工具函数 ─────────────────────────────────────────── */

test('clear 与 mount 正确替换子节点', () => {
  const host = h('div', {}, 'old');
  mount(host, 'new', ' content');
  assert.equal(host.textContent, 'new content');
  clear(host);
  assert.equal(host.childNodes.length, 0);
});

test('escapeHtml 覆盖五个敏感字符', () => {
  assert.equal(escapeHtml('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
});

test('clamp 夹紧到区间内', () => {
  assert.equal(clamp(5, 1, 3), 3);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(2, 1, 3), 2);
});
