/* DOM 小工具。核心约束：h() 只接受文本子节点，永不写入 innerHTML，
   从构造上消除注入类缺陷。 */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function appendChildren(node, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false || child === true) continue;
    if (Array.isArray(child)) appendChildren(node, child);
    else if (child instanceof Node) node.appendChild(child);
    else node.appendChild(document.createTextNode(String(child)));
  }
}

/* 表单无障碍：把 .field 内部的 label 与控件自动关联。
   这样「点标签聚焦输入框」和无障碍名称都自动成立，
   不需要每个调用点都手写 id / for，也就不会漏。 */
let fieldSequence = 0;

function associateFieldLabel(field) {
  const label = field.querySelector('label:not([for])');
  if (!label || !label.textContent.trim()) return;
  const control = field.querySelector('input, select, textarea');
  if (!control) return;
  if (!control.id) {
    fieldSequence += 1;
    control.id = `codecrate-field-${fieldSequence}`;
  }
  label.setAttribute('for', control.id);
}

/**
 * 创建元素。属性支持：class/className、text、style(对象)、dataset(对象)、
 * on<Event>(函数)、其余按 setAttribute 处理。刻意不支持 html 属性。
 */
export function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class' || key === 'className') {
      node.className = Array.isArray(value) ? value.filter(Boolean).join(' ') : String(value);
    } else if (key === 'text') {
      node.textContent = String(value);
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(node.style, value);
    } else if (key === 'dataset' && typeof value === 'object') {
      Object.assign(node.dataset, value);
    } else if (key === 'html') {
      throw new Error('h(): 不支持 html 属性，请使用 text 或子元素');
    } else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) {
      node.setAttribute(key, '');
    } else {
      node.setAttribute(key, String(value));
    }
  }
  appendChildren(node, children);
  if (node.classList.contains('field')) associateFieldLabel(node);
  return node;
}

export function text(value) {
  return document.createTextNode(value === null || value === undefined ? '' : String(value));
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function mount(parent, ...children) {
  clear(parent);
  appendChildren(parent, children);
  return parent;
}

export function on(target, type, handler, options) {
  target.addEventListener(type, handler, options);
  return () => target.removeEventListener(type, handler, options);
}

export function debounce(fn, wait = 200) {
  let timer = 0;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
  wrapped.cancel = () => clearTimeout(timer);
  return wrapped;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** 仅用于生成 HTML 文本产物（如导出文件）时转义；界面渲染请优先用 h()/textContent。 */
export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatBytes(n) {
  if (!Number.isFinite(n)) return '-';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${i === 0 ? v : v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}
