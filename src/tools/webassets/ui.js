/* Web 资产界面层：meta 标签 / robots.txt / sitemap.xml */

import { h, mount, clear, $, debounce } from '../../core/dom.js';
import { mountTool } from '../../core/app.js';
import { icon } from '../../core/icons.js';
import { copyButton, downloadText } from '../../core/widgets.js';
import { read, write } from '../../core/storage.js';
import * as toast from '../../core/toast.js';
import * as logic from './logic.js';

const STORAGE_ID = 'webassets';

const els = {};
const state = {
  mode: 'meta',
  meta: {
    title: '', description: '', url: '', image: '', siteName: '',
    locale: 'zh_CN', themeColor: '#0a0a0a', canonical: '', twitterSite: '',
    robots: 'index, follow', author: '', keywords: ''
  },
  robots: { disallow: '/admin/\n/api/', allow: '/', blockAi: false, sitemaps: '', host: '', crawlDelay: '' },
  sitemap: { urls: logic.URL_LIST_SAMPLE },
  ...(read(`${STORAGE_ID}:state`, null) || {})
};

let lastOutput = '';

function persist() {
  write(`${STORAGE_ID}:state`, {
    mode: state.mode,
    meta: state.meta,
    robots: state.robots,
    sitemap: state.sitemap
  });
}

/* ── 通用小部件 ───────────────────────────────────────────── */

function field(labelText, control, { full = false } = {}) {
  return h('div', { class: `field${full ? ' full' : ''}` }, h('label', { text: labelText }), control);
}

function textInput(value, { ariaLabel, placeholder = '' } = {}) {
  return h('input', {
    type: 'text',
    value,
    placeholder,
    spellcheck: 'false',
    autocomplete: 'off',
    'aria-label': ariaLabel || placeholder || '输入'
  });
}

function textArea(value, { ariaLabel, placeholder = '', rows = 3 } = {}) {
  const node = h('textarea', { spellcheck: 'false', rows: String(rows), 'aria-label': ariaLabel || placeholder });
  node.value = value;
  return node;
}

function bindInput(node, target, key, { immediate = false } = {}) {
  const handler = () => {
    target[key] = node.value;
    persist();
    // 只刷新输出；render() 会重建整个表单并让输入框失去焦点
    renderOutput();
  };
  node.addEventListener('input', immediate ? handler : debounce(handler, 250));
  return node;
}

function bindCheckbox(node, target, key) {
  node.addEventListener('change', () => {
    target[key] = node.checked;
    persist();
    renderOutput();
  });
  return node;
}

function errorBox(message) {
  return h('div', { class: 'inline-error' }, icon('close', 13), h('span', { text: message }));
}

/* ── 表单 ─────────────────────────────────────────────────── */

function renderMetaForm(container) {
  const m = state.meta;
  const inputs = {
    title: bindInput(textInput(m.title, { placeholder: '页面标题' }), m, 'title'),
    description: bindInput(textArea(m.description, { placeholder: '一句话描述页面内容（建议 120-160 字）' }), m, 'description'),
    url: bindInput(textInput(m.url, { placeholder: 'https://example.com/page' }), m, 'url'),
    image: bindInput(textInput(m.image, { placeholder: 'https://example.com/og.png' }), m, 'image'),
    siteName: bindInput(textInput(m.siteName, { placeholder: '站点名' }), m, 'siteName'),
    locale: bindInput(textInput(m.locale, { placeholder: 'zh_CN' }), m, 'locale'),
    themeColor: bindInput(textInput(m.themeColor, { placeholder: '#0a0a0a' }), m, 'themeColor'),
    canonical: bindInput(textInput(m.canonical, { placeholder: 'https://example.com/page' }), m, 'canonical'),
    twitterSite: bindInput(textInput(m.twitterSite, { placeholder: '@yourhandle' }), m, 'twitterSite'),
    robots: bindInput(textInput(m.robots, { placeholder: 'index, follow' }), m, 'robots'),
    author: bindInput(textInput(m.author, { placeholder: '作者' }), m, 'author'),
    keywords: bindInput(textInput(m.keywords, { placeholder: '逗号分隔（对排名影响很小）' }), m, 'keywords')
  };

  container.appendChild(h('div', { class: 'form-grid' },
    field('标题 *', inputs.title, { full: true }),
    field('描述', inputs.description, { full: true }),
    field('页面地址', inputs.url),
    field('分享图地址', inputs.image),
    field('站点名', inputs.siteName),
    field('语言', inputs.locale),
    field('主题色', inputs.themeColor),
    field('canonical', inputs.canonical),
    field('Twitter 账号', inputs.twitterSite),
    field('robots', inputs.robots),
    field('作者', inputs.author),
    field('关键词', inputs.keywords)
  ));

  container.appendChild(h('div', { class: 'note' },
    '标题建议 60 字以内、描述 120-160 字，超出会被搜索结果截断。'
  ));
}

function renderRobotsForm(container) {
  const r = state.robots;

  const presets = h('div', { class: 'preset-row' },
    logic.ROBOTS_PRESETS.map((preset) =>
      h('button', {
        class: 'chip',
        type: 'button',
        title: preset.label,
        onclick: () => {
          r.disallow = (preset.rule.disallow || []).join('\n');
          r.allow = (preset.rule.allow || []).join('\n');
          r.blockAi = Boolean(preset.rule.ai);
          persist();
          render();
          toast.ok(`已套用「${preset.label}」`);
        }
      }, preset.label)
    )
  );

  const disallowNode = bindInput(textArea(r.disallow, { placeholder: '/admin/\n/api/', rows: 4 }), r, 'disallow');
  const allowNode = bindInput(textArea(r.allow, { placeholder: '/', rows: 2 }), r, 'allow');
  const sitemapsNode = bindInput(textArea(r.sitemaps, { placeholder: 'https://example.com/sitemap.xml', rows: 2 }), r, 'sitemaps');
  const hostNode = bindInput(textInput(r.host, { placeholder: 'https://example.com' }), r, 'host');
  const crawlNode = bindInput(textInput(r.crawlDelay, { placeholder: '秒，留空则不输出' }), r, 'crawlDelay');
  const aiBox = bindCheckbox(h('input', { type: 'checkbox', id: 'opt-block-ai', checked: Boolean(r.blockAi) }), r, 'blockAi');

  container.appendChild(h('div', { class: 'section-label' }, '常用预设'));
  container.appendChild(presets);

  container.appendChild(h('div', { class: 'form-grid' },
    field('禁止抓取的路径（每行一个）', disallowNode, { full: true }),
    field('允许抓取的路径（每行一个）', allowNode, { full: true }),
    field('Sitemap 地址（每行一个）', sitemapsNode, { full: true }),
    field('Host', hostNode),
    field('Crawl-delay', crawlNode)
  ));

  container.appendChild(h('div', { class: 'behavior-toggle' },
    h('label', { class: 'check', for: 'opt-block-ai' }, aiBox,
      h('span', { text: `拒绝 AI 爬虫（${logic.AI_CRAWLERS.length} 个 UA）` }))
  ));

  container.appendChild(h('div', { class: 'note' },
    '路径按长度从长到短输出：爬虫遇到多条匹配时会采用最具体的那条，长路径写在前面更不容易出错。'
  ));
}

function renderSitemapForm(container) {
  const s = state.sitemap;
  const node = bindInput(
    textArea(s.urls, { placeholder: '每行一个地址，可用空格追加 lastmod / changefreq / priority', rows: 12 }),
    s,
    'urls'
  );

  container.appendChild(h('div', { class: 'section-label' }, '地址列表'));
  container.appendChild(field('每行一个地址', node, { full: true }));
  container.appendChild(h('div', { class: 'note' },
    '每行格式：地址 [lastmod] [changefreq] [priority]，例如\n' +
    'https://example.com/about 2026-01-01 monthly 0.8'
  ));
}

/* ── 输出 ─────────────────────────────────────────────────── */

function resultRow(name, value) {
  return h('tr', {},
    h('td', { class: 'col-name', text: name }),
    h('td', { class: 'col-value', text: value })
  );
}

function renderWarnings(warnings) {
  if (!warnings || !warnings.length) return null;
  return h('ul', { class: 'warn-list' },
    warnings.map((warning) => h('li', {}, icon('warn', 12), h('span', { text: warning })))
  );
}

function renderActions(filename) {
  const box = $('#actions');
  clear(box);
  if (!lastOutput) return;

  box.appendChild(copyButton(() => lastOutput, { label: '复制', title: '复制输出' }));

  const downloadButton = h('button', { class: 'btn btn-sm', type: 'button' }, icon('download', 12), h('span', { text: '下载' }));
  downloadButton.addEventListener('click', () => {
    downloadText(filename, lastOutput, 'text/plain;charset=utf-8');
    toast.ok(`已导出 ${filename}`);
  });
  box.appendChild(downloadButton);
}

function renderOutput() {
  const box = $('#output');
  clear(box);
  clear(els.status);
  els.status.className = 'panel-foot';
  lastOutput = '';

  if (state.mode === 'meta') {
    const result = logic.generateMetaTags(state.meta);
    if (!result.ok) {
      els.status.className = 'panel-foot text-err';
      els.status.textContent = `✗ ${result.error}`;
      box.appendChild(errorBox(result.error));
      renderActions('');
      return;
    }
    lastOutput = result.html;
    els.status.textContent = `已生成 ${result.html.split('\n').filter((line) => line.trim() && !line.trim().startsWith('<!--')).length} 行标签`;
    const warnings = renderWarnings(result.warnings);
    if (warnings) box.appendChild(warnings);
    box.appendChild(h('pre', { class: 'output-box', text: result.html }));
    renderActions('meta-tags.html');
    return;
  }

  if (state.mode === 'robots') {
    const result = logic.generateRobotsTxt({
      rules: [{
        userAgent: '*',
        allow: state.robots.allow.split('\n').map((line) => line.trim()).filter(Boolean),
        disallow: state.robots.disallow.split('\n').map((line) => line.trim()).filter(Boolean),
        crawlDelay: state.robots.crawlDelay
      }],
      sitemaps: state.robots.sitemaps.split('\n').map((line) => line.trim()).filter(Boolean),
      host: state.robots.host.trim(),
      blockAi: state.robots.blockAi
    });

    if (!result.ok) {
      els.status.className = 'panel-foot text-err';
      els.status.textContent = `✗ ${result.error}`;
      box.appendChild(errorBox(result.error));
      renderActions('');
      return;
    }

    lastOutput = result.text;
    const groups = logic.summarizeRobots(result.text);
    els.status.textContent = `${groups.length} 条规则 · ${result.text.split('\n').filter(Boolean).length} 行`;
    const warnings = renderWarnings(result.warnings);
    if (warnings) box.appendChild(warnings);
    box.appendChild(h('pre', { class: 'output-box', text: result.text }));
    renderActions('robots.txt');
    return;
  }

  const { entries, errors } = logic.parseUrlList(state.sitemap.urls);
  const result = logic.generateSitemap({ entries });

  if (errors.length) {
    box.appendChild(h('ul', { class: 'warn-list' },
      errors.map((error) => h('li', {}, icon('warn', 12), h('span', { text: error })))
    ));
  }

  if (!result.ok) {
    els.status.className = 'panel-foot text-err';
    els.status.textContent = `✗ ${result.error}`;
    if (!errors.length) box.appendChild(errorBox(result.error));
    renderActions('');
    return;
  }

  lastOutput = result.xml;
  els.status.textContent = `${result.count} 个地址 · ${(result.bytes / 1024).toFixed(1)} KB`;
  const warnings = renderWarnings(result.warnings);
  if (warnings) box.appendChild(warnings);

  box.appendChild(h('div', { class: 'stat-row' },
    h('div', { class: 'stat-cell' }, h('div', { class: 'k', text: '地址数' }), h('div', { class: 'v', text: String(result.count) })),
    h('div', { class: 'stat-cell' }, h('div', { class: 'k', text: '大小' }), h('div', { class: 'v', text: `${(result.bytes / 1024).toFixed(1)} KB` })),
    h('div', { class: 'stat-cell' }, h('div', { class: 'k', text: '上限' }), h('div', { class: 'v', text: '50000 条' }))
  ));

  box.appendChild(h('pre', { class: 'output-box', text: result.xml }));
  renderActions('sitemap.xml');
}

/* ── 渲染与初始化 ─────────────────────────────────────────── */

const FORMS = { meta: renderMetaForm, robots: renderRobotsForm, sitemap: renderSitemapForm };
const SAMPLES = {
  meta: {
    title: '码匣 CodeCrate — 零权限的开发者工具箱',
    description: '一个不申请任何权限的浏览器开发者工具箱，包含 JSON、格式转换、正则、加密、动态口令等常用工具。',
    url: 'https://example.com/',
    image: 'https://example.com/og.png',
    siteName: '码匣 CodeCrate',
    canonical: 'https://example.com/'
  },
  robots: { disallow: '/admin/\n/api/\n/private/', allow: '/', sitemaps: 'https://example.com/sitemap.xml', host: 'https://example.com' },
  sitemap: { urls: logic.URL_LIST_SAMPLE }
};

function render() {
  for (const tab of els.modes.querySelectorAll('[role="tab"]')) {
    tab.setAttribute('aria-selected', String(tab.dataset.mode === state.mode));
  }
  clear(els.form);
  (FORMS[state.mode] || renderMetaForm)(els.form);
  renderOutput();
}

function init() {
  els.modes = $('#modes');
  els.form = $('#form');
  els.status = $('#status');
  els.foot = $('#foot');

  if (!FORMS[state.mode]) state.mode = 'meta';

  for (const tab of els.modes.querySelectorAll('[role="tab"]')) {
    tab.addEventListener('click', () => {
      state.mode = tab.dataset.mode;
      persist();
      render();
    });
  }

  $('#btn-sample').addEventListener('click', () => {
    if (state.mode === 'meta') Object.assign(state.meta, SAMPLES.meta);
    else if (state.mode === 'robots') Object.assign(state.robots, SAMPLES.robots);
    else Object.assign(state.sitemap, SAMPLES.sitemap);
    persist();
    render();
    toast.ok('已载入示例');
  });

  els.foot.textContent = '生成结果可直接粘贴或下载';

  mountTool({
    actions: [
      { id: 'mode-meta', label: 'meta 标签生成器', icon: 'web', primary: true, keywords: 'meta og twitter 标签', run: () => switchMode('meta') },
      { id: 'mode-robots', label: 'robots.txt 生成器', icon: 'http', keywords: 'robots txt 爬虫', run: () => switchMode('robots') },
      { id: 'mode-sitemap', label: 'sitemap.xml 生成器', icon: 'network', keywords: 'sitemap xml 索引', run: () => switchMode('sitemap') },
      { id: 'sample', label: '载入示例', icon: 'markdown', keywords: 'sample 示例', run: () => $('#btn-sample').click() }
    ]
  });

  render();
}

function switchMode(mode) {
  state.mode = mode;
  persist();
  render();
}

init();
