/* popup：搜索 + 分类筛选 + 置顶 + 键盘导航 + 命令面板 */

import { h, mount, clear, debounce, $ } from '../core/dom.js';
import { icon, brandMark } from '../core/icons.js';
import { TOOLS, activeCategories, categoryName, openToolInTab, getCategory, recentToolIds, PINNED_KEY, resolveUrl } from '../core/registry.js';
import { fuzzyScore } from '../core/search.js';
import { createToggle } from '../core/theme.js';
import { createPalette } from '../core/palette.js';
import { read, write } from '../core/storage.js';

const state = {
  query: '',
  category: 'all',
  selected: 0,
  pinned: new Set(read(PINNED_KEY, [])),
  recent: new Set(recentToolIds())
};

let flatCards = [];

/* ── 过滤 ─────────────────────────────────────────────────── */
function scoreOf(tool) {
  return fuzzyScore(state.query, `${tool.name} ${tool.desc} ${tool.tags.join(' ')} ${categoryName(tool)}`);
}

function visibleTools() {
  const list = TOOLS.filter(
    (tool) => (state.category === 'all' || tool.category === state.category) && (!state.query || scoreOf(tool) > 0)
  );
  // 有查询时先看匹配度；没有查询时按「置顶 → 最近使用 → 注册表顺序」
  const rank = (tool) => (state.pinned.has(tool.id) ? 0 : state.recent.has(tool.id) ? 1 : 2);
  return list.sort((a, b) => {
    if (state.query) {
      const scoreDiff = scoreOf(b) - scoreOf(a);
      if (scoreDiff) return scoreDiff;
    }
    const diff = rank(a) - rank(b);
    if (diff) return diff;
    return TOOLS.indexOf(a) - TOOLS.indexOf(b);
  });
}

/* ── 卡片 ─────────────────────────────────────────────────── */
function toolCard(tool) {
  const pinned = state.pinned.has(tool.id);

  const pin = h('button', {
    class: 'pin-btn',
    type: 'button',
    'aria-pressed': String(pinned),
    title: pinned ? '取消置顶' : '置顶',
    'aria-label': `${pinned ? '取消置顶' : '置顶'} ${tool.name}`,
    onclick: (event) => {
      event.stopPropagation();
      if (pinned) state.pinned.delete(tool.id);
      else state.pinned.add(tool.id);
      write(PINNED_KEY, [...state.pinned]);
      render();
    }
  }, icon('star', 13));

  const card = h('button', {
    class: 'tool-card',
    type: 'button',
    role: 'option',
    'aria-selected': 'false',
    dataset: { tool: tool.id },
    onclick: () => open(tool),
    onmousemove: () => {
      const index = flatCards.indexOf(card);
      if (index >= 0 && index !== state.selected) {
        state.selected = index;
        paintSelection();
      }
    }
  },
    h('span', { class: 'tc-icon' }, icon(tool.icon, 15)),
    h('span', { class: 'tc-text' },
      h('span', { class: 'tc-name' }, h('span', { text: tool.name })),
      h('span', { class: 'tc-desc', text: tool.desc })
    ),
    pin
  );

  return card;
}

function open(tool) {
  openToolInTab(tool);
  window.close();
}

/* ── 渲染 ─────────────────────────────────────────────────── */
function renderChips() {
  const nav = $('#cats');
  const chips = [{ id: 'all', name: '全部' }, ...activeCategories()];
  mount(nav, chips.map((category) =>
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
  flatCards = [];

  const tools = visibleTools();

  if (!tools.length) {
    list.appendChild(h('div', { class: 'empty' }, '没有匹配的工具，换个关键词试试'));
    $('#count').textContent = '0 / ' + TOOLS.length;
    return;
  }

  // 有置顶/最近记录且未搜索时，先渲染这两个分组
  const showGroups = !state.query;
  const pinnedTools = showGroups ? tools.filter((t) => state.pinned.has(t.id)) : [];
  const pinnedIds = new Set(pinnedTools.map((tool) => tool.id));
  const recentTools = showGroups
    ? tools.filter((t) => !pinnedIds.has(t.id) && state.recent.has(t.id))
    : [];
  const recentIds = new Set(recentTools.map((tool) => tool.id));
  const restTools = tools.filter((tool) => !pinnedIds.has(tool.id) && !recentIds.has(tool.id));

  for (const group of [
    { label: '置顶', tools: pinnedTools },
    { label: '最近使用', tools: recentTools }
  ]) {
    if (!group.tools.length) continue;
    list.appendChild(h('div', { class: 'category-label' }, group.label));
    for (const tool of group.tools) {
      const card = toolCard(tool);
      flatCards.push(card);
      list.appendChild(card);
    }
  }

  // 分类分组只在「全部」且有多个分类时显示，避免单分类下出现无意义标题
  const grouped = state.category === 'all' && !state.query;
  if (grouped) {
    for (const category of activeCategories()) {
      const group = restTools.filter((tool) => tool.category === category.id);
      if (!group.length) continue;
      list.appendChild(h('div', { class: 'category-label' }, category.name));
      for (const tool of group) {
        const card = toolCard(tool);
        flatCards.push(card);
        list.appendChild(card);
      }
    }
  } else {
    for (const tool of restTools) {
      const card = toolCard(tool);
      flatCards.push(card);
      list.appendChild(card);
    }
  }

  $('#count').textContent = `${tools.length} / ${TOOLS.length}`;
  state.selected = Math.min(state.selected, flatCards.length - 1);
  paintSelection();
}

function paintSelection() {
  flatCards.forEach((card, index) => card.setAttribute('aria-selected', String(index === state.selected)));
  const active = flatCards[state.selected];
  if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
}

/* ── 初始化 ───────────────────────────────────────────────── */
function init() {
  $('#brand-logo').appendChild(brandMark(22));
  $('#search-icon').appendChild(icon('search', 14));
  $('#palette-btn').appendChild(icon('command', 15));

  const homeButton = $('#home-btn');
  homeButton.appendChild(icon('toolbox', 15));
  homeButton.addEventListener('click', () => {
    const url = resolveUrl('src/home/index.html');
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
      chrome.tabs.create({ url });
    } else {
      window.open(url, '_blank', 'noopener');
    }
  });
  $('#theme-slot').appendChild(createToggle());

  const search = $('#search');
  const onSearch = debounce(() => {
    state.query = search.value.trim();
    state.selected = 0;
    render();
  }, 90);
  search.addEventListener('input', onSearch);
  search.focus();

  const palette = createPalette({
    currentToolId: null,
    navigate: (tool) => {
      openToolInTab(tool);
      window.close();
    }
  });
  $('#palette-btn').addEventListener('click', () => palette.open());

  document.addEventListener('keydown', (event) => {
    const mod = event.ctrlKey || event.metaKey;
    if (mod && !event.shiftKey && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      palette.toggle();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      state.selected = Math.min(state.selected + 1, flatCards.length - 1);
      paintSelection();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      state.selected = Math.max(state.selected - 1, 0);
      paintSelection();
    } else if (event.key === 'Enter') {
      const card = flatCards[state.selected];
      if (!card) return;
      event.preventDefault();
      const tool = TOOLS.find((t) => t.id === card.dataset.tool);
      if (tool) open(tool);
    } else if (event.key === '/' && document.activeElement !== search) {
      event.preventDefault();
      search.focus();
      search.select();
    }
  });

  render();
}

init();
