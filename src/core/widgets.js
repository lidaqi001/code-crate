/* 复用型小部件：复制按钮、下载、字段行。用于消除各工具里的重复样板。 */

import { h } from './dom.js';
import { icon } from './icons.js';
import { copy } from './clipboard.js';
import { read, write } from './storage.js';
import * as toast from './toast.js';

/**
 * 复制按钮。getValue 为函数，每次点击时取值，避免闭包捕获过期状态。
 * 复制成功/失败都有明确反馈，不会出现「提示成功但其实失败」。
 */
export function copyButton(getValue, { label = '', title = '复制', size = 'sm', onDone } = {}) {
  const button = h('button', {
    class: `btn ${size === 'sm' ? 'btn-sm' : ''}`,
    type: 'button',
    title,
    'aria-label': title
  },
    icon('copy', 13),
    label ? h('span', { text: label }) : null
  );

  button.addEventListener('click', async () => {
    const value = typeof getValue === 'function' ? getValue() : getValue;
    if (value === null || value === undefined || value === '') {
      toast.warn('没有可复制的内容');
      return;
    }
    const okCopy = await copy(value);
    if (okCopy) {
      toast.ok('已复制');
      button.replaceChildren(icon('check', 13), label ? h('span', { text: label }) : null);
      setTimeout(() => {
        button.replaceChildren(icon('copy', 13), label ? h('span', { text: label }) : null);
      }, 1100);
      if (onDone) onDone();
    } else {
      toast.fail('复制失败，请手动选择文本');
    }
  });

  return button;
}

export function downloadText(filename, content, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = h('a', { href: url, download: filename });
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 一个带标签的字段容器。 */
export function field(labelText, control, hint) {
  const id = control && control.id ? control.id : null;
  return h('div', { class: 'field' },
    labelText ? h('label', { for: id || undefined, text: labelText }) : null,
    control,
    hint ? h('span', { class: 'hint', text: hint }) : null
  );
}

/** 面板容器：标题栏 + 内容区，统一各工具的版式。 */
export function panel(titleText, bodyContent, { actions = [], flush = false, extraClass = '' } = {}) {
  const head = h('div', { class: 'panel-head' }, h('span', { class: 'panel-title', text: titleText }));
  if (actions.length) {
    head.appendChild(h('span', { class: 'spacer', style: { flex: '1 1 auto' } }));
    for (const action of actions) head.appendChild(action);
  }
  return h('section', { class: `panel ${extraClass}`.trim() },
    titleText ? head : null,
    h('div', { class: `panel-body${flush ? ' flush' : ''}` }, bodyContent)
  );
}

/** 统一的状态行，支持 ok/err 语义色。 */
export function statusLine() {
  const node = h('div', { class: 'status-line', role: 'status', 'aria-live': 'polite' });
  return {
    node,
    set(message, kind = '') {
      node.textContent = message || '';
      node.className = `status-line ${kind}`.trim();
    }
  };
}

/**
 * 面板折叠：往 panel-head 右端挂「提示 + 折叠按钮」，状态持久化到 storageKey。
 *
 * 刻意不碰业务结构——它只负责切 layout 上的 className 与按钮本身，
 * 折叠时具体隐藏什么交给调用方的 CSS（约定见 base.css 的「面板折叠」一节：
 * 折叠后 head 里除 .fold-group 外全部隐藏）。所以编辑区、侧栏、结果区
 * 都能用同一个件。
 *
 * @param {object} options
 * @param {HTMLElement} options.layout    加 className 的容器（通常是 .tool-main）
 * @param {HTMLElement} options.head      折叠按钮挂载的 panel-head
 * @param {string} options.storageKey     持久化键（走 core/storage.js）
 * @param {string} [options.noun]         文案里的名词，如「编辑区」「输入区」
 * @param {string} [options.className]    折叠时加在 layout 上的类名
 * @param {string} [options.controls]     被折叠区域的 id，用于 aria-controls
 * @returns {{get:Function, set:Function, button:HTMLElement, hint:HTMLElement}}
 */
export function createFold({ layout, head, storageKey, noun = '编辑区', className = 'is-folded', controls }) {
  const hint = h('span', { class: 'fold-hint', text: `${noun}已折叠` });
  const button = h('button', {
    class: 'btn btn-icon fold-btn',
    type: 'button',
    'aria-expanded': 'true',
    'aria-controls': controls || undefined
  });
  head.appendChild(h('div', { class: 'fold-group' }, hint, button));

  let folded = read(storageKey, false) === true;

  function sync() {
    layout.classList.toggle(className, folded);
    const label = folded ? `展开${noun}` : `折叠${noun}`;
    button.setAttribute('aria-expanded', String(!folded));
    button.title = label;
    button.setAttribute('aria-label', label);
    button.replaceChildren(icon(folded ? 'expand' : 'collapse', 14));
  }

  function set(next) {
    folded = Boolean(next);
    write(storageKey, folded);
    sync();
    return folded;
  }

  button.addEventListener('click', () => set(!folded));
  sync();

  return { get: () => folded, set, button, hint };
}
