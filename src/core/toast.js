/* 轻量提示条。同一时刻最多堆叠若干条，自动消散。 */

import { h } from './dom.js';

let host = null;

function ensureHost() {
  if (host && host.isConnected) return host;
  host = h('div', { class: 'toast-host', role: 'status', 'aria-live': 'polite' });
  document.body.appendChild(host);
  return host;
}

export function toast(message, type = 'ok', duration = 1800) {
  const node = h('div', { class: `toast ${type}`, text: String(message) });
  ensureHost().appendChild(node);
  setTimeout(() => {
    node.classList.add('leaving');
    setTimeout(() => node.remove(), 200);
  }, duration);
  return node;
}

export const ok = (message) => toast(message, 'ok');
export const warn = (message) => toast(message, 'warn', 2400);
export const fail = (message) => toast(message, 'err', 3000);
