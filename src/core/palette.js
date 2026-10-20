/* 命令面板（Ctrl/Cmd+K）：一处入口，既能跳转任意工具，也能执行当前工具的动作。
   这是「键盘优先」体验的核心。 */

import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { TOOLS, categoryName, goToTool, getTool, pinnedToolIds, recentToolIds } from './registry.js';
import { fuzzyScore } from './search.js';

function buildItems(actions, navigate) {
  const pinned = new Set(pinnedToolIds());
  const recent = new Set(recentToolIds());

  const toolItems = TOOLS.map((tool) => ({
    key: `tool:${tool.id}`,
    label: tool.name,
    meta: `工具 · ${categoryName(tool)}`,
    keywords: `${tool.tags.join(' ')} ${tool.desc}`,
    iconName: tool.icon,
    // 空查询时用于排序；有查询时只作为同分时的次级依据
    boost: pinned.has(tool.id) ? 300 : recent.has(tool.id) ? 150 : 0,
    run: () => navigate(tool)
  }));

  const actionItems = actions.map((action) => ({
    key: `action:${action.id}`,
    label: action.label,
    meta: action.keys ? `动作 · ${action.keys}` : '动作',
    keywords: action.keywords || '',
    iconName: action.icon || 'play',
    boost: 0,
    run: action.run
  }));

  return [...actionItems, ...toolItems];
}

export function createPalette({ actions = [], currentToolId = null, navigate = goToTool } = {}) {
  const items = buildItems(actions, navigate);

  const input = h('input', {
    type: 'text',
    placeholder: '搜索工具或执行命令…',
    'aria-label': '搜索工具或命令',
    autocomplete: 'off',
    spellcheck: 'false'
  });

  const list = h('ul', { class: 'palette-list', role: 'listbox', 'aria-label': '命令结果' });
  const palette = h('div', { class: 'palette', role: 'dialog', 'aria-modal': 'true', 'aria-label': '命令面板' },
    input,
    list,
    h('div', { class: 'palette-foot' },
      h('span', {}, h('span', { class: 'kbd' }, '↑'), ' ', h('span', { class: 'kbd' }, '↓'), ' 选择'),
      h('span', {}, h('span', { class: 'kbd' }, 'Enter'), ' 执行'),
      h('span', {}, h('span', { class: 'kbd' }, 'Esc'), ' 关闭')
    )
  );

  const backdrop = h('div', { class: 'palette-backdrop' }, palette);
  let filtered = items;
  let selected = 0;
  let restoreFocus = null;

  function render() {
    clear(list);
    if (!filtered.length) {
      list.appendChild(h('li', { class: 'palette-empty' }, '没有匹配的命令'));
      return;
    }
    filtered.forEach((item, index) => {
      const row = h('li', {
        class: 'palette-item',
        role: 'option',
        'aria-selected': String(index === selected),
        onclick: () => run(index),
        onmousemove: () => {
          if (selected !== index) {
            selected = index;
            paintSelection();
          }
        }
      },
        h('span', { class: 'pi-icon' }, icon(item.iconName, 15)),
        h('span', { class: 'pi-label', text: item.label }),
        h('span', { class: 'pi-meta', text: item.meta })
      );
      if (item.key === `tool:${currentToolId}`) row.appendChild(h('span', { class: 'badge' }, '当前'));
      list.appendChild(row);
    });
  }

  function paintSelection() {
    const rows = list.querySelectorAll('.palette-item');
    rows.forEach((row, index) => row.setAttribute('aria-selected', String(index === selected)));
    const active = rows[selected];
    if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
  }

  function applyFilter() {
    const query = input.value.trim();
    filtered = items
      .map((item) => ({ item, s: fuzzyScore(query, `${item.label} ${item.meta || ''} ${item.keywords || ''}`) }))
      .filter((entry) => entry.s > 0)
      .sort((a, b) => {
        if (b.s !== a.s) return b.s - a.s;
        return (b.item.boost || 0) - (a.item.boost || 0);
      })
      .map((entry) => entry.item);
    selected = 0;
    render();
  }

  function run(index) {
    const item = filtered[index];
    if (!item) return;
    close();
    // 先关闭面板再执行，保证跳转/动作发生在干净的焦点状态下
    setTimeout(() => item.run(), 0);
  }

  function close() {
    backdrop.remove();
    document.removeEventListener('keydown', onKeydown, true);
    if (restoreFocus && restoreFocus.isConnected) restoreFocus.focus();
  }

  function onKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'ArrowDown' || (event.key === 'n' && event.ctrlKey)) {
      event.preventDefault();
      event.stopPropagation();
      selected = Math.min(selected + 1, filtered.length - 1);
      paintSelection();
    } else if (event.key === 'ArrowUp' || (event.key === 'p' && event.ctrlKey)) {
      event.preventDefault();
      event.stopPropagation();
      selected = Math.max(selected - 1, 0);
      paintSelection();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      run(selected);
    } else if (event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  input.addEventListener('input', applyFilter);
  backdrop.addEventListener('mousedown', (event) => {
    if (event.target === backdrop) close();
  });
  return {
    open() {
      restoreFocus = document.activeElement;
      document.body.appendChild(backdrop);
      input.value = '';
      applyFilter();
      input.focus();
      // 只在面板打开期间监听键盘；关闭后必须解绑，否则会吞掉页面的 Enter/Tab/方向键
      document.removeEventListener('keydown', onKeydown, true);
      document.addEventListener('keydown', onKeydown, true);
    },
    close,
    toggle() {
      if (backdrop.isConnected) close();
      else this.open();
    }
  };
}

/** 便捷入口：一次性打开面板（不复用实例）。 */
export function openPalette(options) {
  createPalette(options).open();
}

export { getTool };
