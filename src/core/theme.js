/* 主题：深浅色切换，持久化到本地存储。 */

import { h } from './dom.js';
import { read, write } from './storage.js';
import { icon } from './icons.js';

const KEY = 'theme';

export function current() {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

export function apply(mode) {
  const next = mode === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  write(KEY, next);
  return next;
}

export function toggle() {
  return apply(current() === 'dark' ? 'light' : 'dark');
}

/** 生成一个符合设计规范的图标按钮，自动同步图标与无障碍标签。 */
export function createToggle() {
  const button = h('button', {
    class: 'btn btn-icon',
    type: 'button',
    title: '切换深浅色',
    'aria-label': '切换深浅色'
  });

  const sync = () => {
    const mode = current();
    button.replaceChildren(icon(mode === 'dark' ? 'moon' : 'sun', 15));
    button.setAttribute('aria-pressed', String(mode === 'light'));
    button.title = mode === 'dark' ? '切换到浅色' : '切换到深色';
  };

  button.addEventListener('click', () => {
    toggle();
    sync();
  });

  sync();
  return button;
}

/** 若用户从未手动选择过，则跟随系统主题变化。 */
export function followSystem() {
  if (read(KEY, null)) return;
  const mq = window.matchMedia('(prefers-color-scheme: light)');
  mq.addEventListener('change', (event) => {
    if (read(KEY, null)) return;
    document.documentElement.setAttribute('data-theme', event.matches ? 'light' : 'dark');
  });
}
