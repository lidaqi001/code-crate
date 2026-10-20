/* 全部工具首页：大网格浏览 + 模糊搜索 + 置顶/最近分组 + 键盘操作。
   卡片是真实 <a href>，因此 Ctrl/⌘ 点击、中键、右键新标签页都由浏览器原生处理。 */

import { h, mount, clear, debounce, $ } from '../core/dom.js';
import { icon, brandMark } from '../core/icons.js';
import {
  TOOLS,
  activeCategories,
  categoryName,
  toolUrl,
  markToolUsed,
  pinnedToolIds,
  recentToolIds,
  goToTool
} from '../core/registry.js';
import { createToggle } from '../core/theme.js';
import { createPalette } from '../core/palette.js';
import { fuzzyScore } from '../core/search.js';

const state = {
  query: '',
  category: 'all',
  selected: 0,
  pinned: new Set(pinnedToolIds()),
  recent: new Set(recentToolIds())
};

let cards = [];

function scoreOf(tool) {
  return fuzzyScore(state.query, `${tool.name} ${tool.desc} ${tool.tags.join(' ')} ${categoryName(tool)}`);
}

function visibleTools() {
  const list = TOOLS.filter(
    (tool) => (state.category === 'all' || tool.category === state.category) && (!state.query || scoreOf(tool) > 0)
  );
  const rank = (tool) => (state.pinned.has(tool.id) ? 0 : state.recent.has(tool.id) ? 1 : 2);
  return list.sort((a, b) => {
    if (state.query) {
      const scoreDiff = scoreOf(b) - scoreOf(a);
      if (scoreDiff) return scoreDiff;
    }
    const rankDiff = rank(a) - rank(b);
    if (rankDiff) return rankDiff;
    return TOOLS.indexOf(a) - TOOLS.indexOf(b);
  });
}

/* ── 卡片 ─────────────────────────────────────────────────── */

function cardNode(tool) {
  const node = h('a', {
    class: 'tool-card',
    href: toolUrl(tool),
    dataset: { tool: tool.id },
    onclick: () => markToolUsed(tool.id),
    onmousemove: () => {
      const index = cards.indexOf(node);
      if (index >= 0 && index !== state.selected) {
        state.selected = index;
        paintSelection();
      }
    }
  },
    h('span', { class: 'tc-icon' }, icon(tool.icon, 16)),
    h('span', { class: 'tc-text' },
      h('span', { class: 'tc-name', text: tool.name }),
      h('span', { class: 'tc-desc', text: tool.desc })
    ),
    state.pinned.has(tool.id)
      ? h('span', { class: 'badge', text: '置顶' })
      : state.recent.has(tool.id)
        ? h('span', { class: 'badge', text: '最近' })
        : null
  );
  cards.push(node);
  return node;
}

function appendGroup(list, label, tools) {
  if (!tools.length) return;
  list.appendChild(h('div', { class: 'group-label', text: label }));
  for (const tool of tools) list.appendChild(cardNode(tool));
}

/* ── 渲染 ─────────────────────────────────────────────────── */

function renderChips() {
  const chips = [{ id: 'all', name: '全部' }, ...activeCategories()];
  mount($('#cats'), chips.map((category) =>
    h('button', {
      class: 'chip',
      type: 'button',
      'aria-pressed': String(state.category === category.id),
      text: category.name,
      onclick: () => {
        state.category = category.id;
        state.selected = 0;
        render();
      }
    })
  ));
}

function render() {
  renderChips();

  const list = $('#list');
  clear(list);
  cards = [];

  const tools = visibleTools();
  $('#count').textContent = `${tools.length} / ${TOOLS.length}`;

  if (!tools.length) {
    list.appendChild(h('div', { class: 'empty', text: '没有匹配的工具，换个关键词试试' }));
    return;
  }

  if (state.query || state.category !== 'all') {
    for (const tool of tools) list.appendChild(cardNode(tool));
  } else {
    const pinned = tools.filter((tool) => state.pinned.has(tool.id));
    const pinnedIds = new Set(pinned.map((tool) => tool.id));
    const recent = tools.filter((tool) => !pinnedIds.has(tool.id) && state.recent.has(tool.id));
    const recentIds = new Set(recent.map((tool) => tool.id));
    const rest = tools.filter((tool) => !pinnedIds.has(tool.id) && !recentIds.has(tool.id));

    appendGroup(list, '置顶', pinned);
    appendGroup(list, '最近使用', recent);
    for (const category of activeCategories()) {
      appendGroup(list, category.name, rest.filter((tool) => tool.category === category.id));
    }
  }

  state.selected = Math.min(state.selected, cards.length - 1);
  paintSelection();
}

function paintSelection() {
  cards.forEach((card, index) => card.classList.toggle('is-selected', index === state.selected));
  const active = cards[state.selected];
  if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
}

/* ── 初始化 ───────────────────────────────────────────────── */

function init() {
  $('#brand-logo').appendChild(brandMark(28));
  $('#search-icon').appendChild(icon('search', 15));
  $('#theme-slot').appendChild(createToggle());

  const palette = createPalette({ currentToolId: null, navigate: goToTool });
  const paletteButton = $('#palette-btn');
  paletteButton.appendChild(icon('command', 15));
  paletteButton.addEventListener('click', () => palette.open());

  const search = $('#search');
  const onSearch = debounce(() => {
    state.query = search.value.trim();
    state.selected = 0;
    render();
  }, 90);
  search.addEventListener('input', onSearch);
  search.focus();

  document.addEventListener('keydown', (event) => {
    const mod = event.ctrlKey || event.metaKey;
    if (mod && !event.shiftKey && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      palette.toggle();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      state.selected = Math.min(state.selected + 1, cards.length - 1);
      paintSelection();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      state.selected = Math.max(state.selected - 1, 0);
      paintSelection();
    } else if (event.key === 'Enter' && document.activeElement !== paletteButton) {
      const active = cards[state.selected];
      if (!active) return;
      event.preventDefault();
      active.click();
    } else if (event.key === '/' && document.activeElement !== search) {
      event.preventDefault();
      search.focus();
      search.select();
    } else if (event.key === 'Escape' && document.activeElement !== search && state.query) {
      search.value = '';
      state.query = '';
      render();
    }
  });

  render();
}

init();
