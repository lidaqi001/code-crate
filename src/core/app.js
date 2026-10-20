/* 工具页统一外壳：头部品牌区、命令面板入口、主题切换、全局快捷键。
   每个工具页只需 <body data-tool="xxx"> + 自己的 markup + 调用 mountTool()。 */

import { h, mount } from './dom.js';
import { icon } from './icons.js';
import { getTool, categoryName, resolveUrl } from './registry.js';
import { createToggle, followSystem } from './theme.js';
import { createPalette } from './palette.js';

export function isMac() {
  const platform = navigator.userAgentData?.platform || navigator.platform || '';
  return /mac|iphone|ipad/i.test(platform);
}

export function modKeyLabel() {
  return isMac() ? '⌘' : 'Ctrl';
}

/**
 * @param {object} options
 * @param {Array<{id:string,label:string,run:Function,keys?:string,icon?:string,primary?:boolean,keywords?:string}>} options.actions
 * @returns {{tool:object|null, palette:object, actions:Array, openPalette:Function}}
 */
export function mountTool({ actions = [] } = {}) {
  const toolId = document.body.dataset.tool || '';
  const tool = getTool(toolId);
  const palette = createPalette({ actions, currentToolId: toolId });

  if (tool) document.title = `${tool.name} · 码匣`;

  followSystem();

  const header = document.getElementById('app-header');
  if (header) {
    const paletteButton = h('button', {
      class: 'btn btn-ghost',
      type: 'button',
      title: `命令面板 (${modKeyLabel()}+K)`,
      'aria-label': `打开命令面板，快捷键 ${modKeyLabel()}+K`
    },
      icon('command', 14),
      h('span', { text: '命令面板' }),
      h('span', { class: 'kbd', text: `${modKeyLabel()} K` })
    );
    paletteButton.addEventListener('click', () => palette.open());

    const homeButton = h('button', {
      class: 'btn btn-ghost',
      type: 'button',
      title: '全部工具',
      'aria-label': '打开全部工具'
    },
      icon('toolbox', 14),
      h('span', { text: '全部工具' })
    );
    homeButton.addEventListener('click', () => {
      window.location.assign(resolveUrl('src/home/index.html'));
    });

    mount(header,
      h('div', { class: 'app-brand' },
        h('span', { class: 'logo' }, icon(tool ? tool.icon : 'dot', 13)),
        h('span', { class: 'app-title', text: tool ? tool.name : '码匣' }),
        tool ? h('span', { class: 'badge', text: categoryName(tool) }) : null
      ),
      h('span', { class: 'spacer' }),
      homeButton,
      paletteButton,
      createToggle()
    );
  }

  const primaryAction = actions.find((action) => action.primary) || actions[0] || null;

  document.addEventListener('keydown', (event) => {
    const mod = event.ctrlKey || event.metaKey;
    if (mod && !event.shiftKey && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      palette.toggle();
      return;
    }
    if (mod && event.key === 'Enter' && primaryAction) {
      event.preventDefault();
      primaryAction.run();
    }
  });

  return {
    tool,
    palette,
    actions,
    primaryAction,
    openPalette: () => palette.open()
  };
}

/** 在页面顶部渲染一条错误提示（用于工具初始化失败等不可恢复场景）。 */
export function renderFatal(message) {
  const target = document.querySelector('.tool-main') || document.body;
  mount(target,
    h('div', { class: 'panel' },
      h('div', { class: 'panel-head' }, h('span', { class: 'panel-title', text: '工具初始化失败' })),
      h('div', { class: 'panel-body' }, h('p', { text: message }))
    )
  );
}
