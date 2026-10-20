/* Web 资产生成 —— 纯逻辑层。
 *
 * 三个生成器，都是「填表 → 得到可直接粘贴的文本」：
 *   1. meta / Open Graph / Twitter 卡片标签
 *   2. robots.txt
 *   3. sitemap.xml（含 sitemap 索引）
 *
 * 所有输出都做转义，避免标题里的 < > & " 破坏 HTML 或 XML 结构。
 */

export const CHANGEFREQ = ['always', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'never'];

export const ROBOTS_PRESETS = [
  { id: 'allow-all', label: '全部允许', rule: { userAgent: '*', allow: ['/'], disallow: [] } },
  { id: 'block-all', label: '全部禁止', rule: { userAgent: '*', allow: [], disallow: ['/'] } },
  { id: 'no-admin', label: '禁止后台与接口', rule: { userAgent: '*', allow: ['/'], disallow: ['/admin/', '/api/', '/private/'] } },
  { id: 'ai-crawlers', label: '拒绝 AI 抓取', rule: { userAgent: '*', allow: [], disallow: ['/'], ai: true } }
];

export const SITEMAP_LIMITS = {
  maxUrls: 50000,
  maxBytes: 50 * 1024 * 1024,
  maxUrlLength: 2048
};

/* ── 转义 ─────────────────────────────────────────────────── */

export function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeXml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/* ── 校验 ─────────────────────────────────────────────────── */

export function isValidHttpUrl(text) {
  try {
    const url = new URL(String(text));
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function isAbsoluteUrl(text) {
  try {
    new URL(String(text));
    return true;
  } catch {
    return false;
  }
}

function assertUrl(text, label) {
  const source = String(text ?? '').trim();
  if (source === '') throw new Error(`${label}不能为空`);
  if (!isValidHttpUrl(source)) throw new Error(`${label}「${source}」不是合法的 http(s) 地址`);
  return source;
}

/* ── 1. meta 标签 ─────────────────────────────────────────── */

export const META_DEFAULTS = {
  title: '',
  description: '',
  url: '',
  image: '',
  siteName: '',
  type: 'website',
  twitterCard: 'summary_large_image',
  twitterSite: '',
  locale: '',
  themeColor: '',
  canonical: '',
  robots: 'index, follow',
  author: '',
  keywords: ''
};

/**
 * 生成 meta 标签块。
 * @returns {{ok:true, html:string, warnings:string[]}|{ok:false, error:string}}
 */
export function generateMetaTags(input = {}) {
  const data = { ...META_DEFAULTS, ...input };
  const warnings = [];

  if (!String(data.title).trim()) return { ok: false, error: '标题不能为空' };
  if (!String(data.description).trim()) warnings.push('没有填描述，搜索结果里的摘要会由搜索引擎自行截取');

  const description = String(data.description).trim();
  if (description.length > 160) warnings.push(`描述有 ${description.length} 个字符，超过 160 容易被截断`);

  const title = String(data.title).trim();
  if (title.length > 60) warnings.push(`标题有 ${title.length} 个字符，搜索结果里超过 60 左右会被截断`);

  if (data.url && !isValidHttpUrl(data.url)) return { ok: false, error: '页面地址不是合法的 http(s) 地址' };
  if (data.image && !isValidHttpUrl(data.image)) return { ok: false, error: '分享图不是合法的 http(s) 地址' };
  if (data.canonical && !isValidHttpUrl(data.canonical)) return { ok: false, error: 'canonical 不是合法的 http(s) 地址' };
  if (!data.url) warnings.push('建议填写页面地址，社交平台抓取时用得上');
  if (!data.image) warnings.push('没有分享图，转发到社交平台时卡片会比较单调');

  const lines = [];
  const meta = (attributes) => {
    const rendered = Object.entries(attributes)
      .map(([key, value]) => `${key}="${escapeHtml(value)}"`)
      .join(' ');
    lines.push(`<meta ${rendered} />`);
  };

  lines.push(`<title>${escapeHtml(title)}</title>`);
  meta({ name: 'description', content: description });
  if (data.keywords) meta({ name: 'keywords', content: data.keywords });
  if (data.author) meta({ name: 'author', content: data.author });
  if (data.robots) meta({ name: 'robots', content: data.robots });
  if (data.themeColor) meta({ name: 'theme-color', content: data.themeColor });
  if (data.canonical) lines.push(`<link rel="canonical" href="${escapeHtml(data.canonical)}" />`);

  lines.push('');
  lines.push('<!-- Open Graph -->');
  meta({ property: 'og:type', content: data.type });
  meta({ property: 'og:title', content: title });
  meta({ property: 'og:description', content: description });
  if (data.url) meta({ property: 'og:url', content: data.url });
  if (data.image) meta({ property: 'og:image', content: data.image });
  if (data.siteName) meta({ property: 'og:site_name', content: data.siteName });
  if (data.locale) meta({ property: 'og:locale', content: data.locale });

  lines.push('');
  lines.push('<!-- Twitter 卡片 -->');
  meta({ name: 'twitter:card', content: data.twitterCard });
  meta({ name: 'twitter:title', content: title });
  meta({ name: 'twitter:description', content: description });
  if (data.image) meta({ name: 'twitter:image', content: data.image });
  if (data.twitterSite) meta({ name: 'twitter:site', content: data.twitterSite });

  return { ok: true, html: lines.join('\n'), warnings };
}

/* ── 2. robots.txt ────────────────────────────────────────── */

export const AI_CRAWLERS = [
  'GPTBot',
  'ChatGPT-User',
  'CCBot',
  'Google-Extended',
  'anthropic-ai',
  'ClaudeBot',
  'Bytespider',
  'PerplexityBot',
  'Amazonbot',
  'Applebot-Extended',
  'Meta-ExternalAgent'
];

/**
 * 生成 robots.txt。
 * @param {{rules?:Array, sitemaps?:string[], host?:string, blockAi?:boolean}} input
 */
export function generateRobotsTxt(input = {}) {
  const rules = Array.isArray(input.rules) && input.rules.length
    ? input.rules
    : [{ userAgent: '*', allow: ['/'], disallow: [] }];
  const sitemaps = Array.isArray(input.sitemaps) ? input.sitemaps.filter(Boolean) : [];
  const warnings = [];

  for (const sitemap of sitemaps) {
    if (!isValidHttpUrl(sitemap)) return { ok: false, error: `Sitemap 地址「${sitemap}」不是合法的 http(s) 地址` };
    if (!/\.xml(\.gz)?$/i.test(sitemap)) warnings.push(`Sitemap 地址「${sitemap}」通常应以 .xml 或 .xml.gz 结尾`);
  }
  if (input.host && !isValidHttpUrl(input.host)) return { ok: false, error: 'Host 不是合法的 http(s) 地址' };
  if (!sitemaps.length) warnings.push('没有填 Sitemap 地址，搜索引擎只能靠链接发现页面');

  const blocks = [];

  for (const rule of rules) {
    const userAgent = String(rule.userAgent || '*').trim() || '*';
    const lines = [`User-agent: ${userAgent}`];

    // 规范要求 Allow 与 Disallow 按长度排序时更精确的规则优先，这里按长度降序输出
    const allow = (rule.allow || []).filter(Boolean).sort((a, b) => b.length - a.length);
    const disallow = (rule.disallow || []).filter(Boolean).sort((a, b) => b.length - a.length);

    for (const path of allow) lines.push(`Allow: ${path}`);
    for (const path of disallow) lines.push(`Disallow: ${path}`);
    if (rule.crawlDelay !== undefined && rule.crawlDelay !== '' && Number(rule.crawlDelay) > 0) {
      lines.push(`Crawl-delay: ${Number(rule.crawlDelay)}`);
    }
    blocks.push(lines.join('\n'));
  }

  if (input.blockAi) {
    for (const agent of AI_CRAWLERS) {
      blocks.push(`User-agent: ${agent}\nDisallow: /`);
    }
  }

  const tail = [];
  if (input.host) tail.push(`Host: ${String(input.host).trim()}`);
  for (const sitemap of sitemaps) tail.push(`Sitemap: ${sitemap.trim()}`);

  const text = [blocks.join('\n\n'), tail.join('\n')].filter(Boolean).join('\n\n');
  return { ok: true, text: `${text}\n`, warnings };
}

/** 解析 robots.txt 的规则摘要，用于界面回显。 */
export function summarizeRobots(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const groups = [];
  let current = null;

  for (const line of lines) {
    const trimmed = line.replace(/#.*$/, '').trim();
    if (trimmed === '') continue;
    const separator = trimmed.indexOf(':');
    if (separator < 0) continue;
    const field = trimmed.slice(0, separator).trim().toLowerCase();
    const value = trimmed.slice(separator + 1).trim();

    if (field === 'user-agent') {
      if (!current || current.disallow.length || current.allow.length) {
        current = { userAgent: value, allow: [], disallow: [] };
        groups.push(current);
      } else {
        current.userAgent += `, ${value}`;
      }
    } else if (current && field === 'disallow') {
      current.disallow.push(value);
    } else if (current && field === 'allow') {
      current.allow.push(value);
    }
  }

  return groups;
}

/* ── 3. sitemap.xml ───────────────────────────────────────── */

/**
 * 校验 W3C 日期。只检查格式不够：2026-13-99 格式合法但并不存在，
 * 这种值会让搜索引擎报错，所以这里按真实日历校验。
 */
export function isW3CDate(text) {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text));
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/.test(String(text))) {
    return !Number.isNaN(Date.parse(String(text)));
  }
  return false;
}

/** 解析「每行一个地址」的输入，支持用空格或制表符附加 lastmod/changefreq/priority。 */
export function parseUrlList(text) {
  const entries = [];
  const errors = [];

  String(text ?? '').split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) return;

    const [loc, lastmod, changefreq, priority] = trimmed.split(/[\s\t]+/);
    if (!isValidHttpUrl(loc)) {
      errors.push(`第 ${index + 1} 行「${loc}」不是合法的 http(s) 地址`);
      return;
    }

    const entry = { loc };
    if (lastmod) {
      if (!isW3CDate(lastmod)) {
        errors.push(`第 ${index + 1} 行的 lastmod「${lastmod}」不是有效的 W3C 日期（YYYY-MM-DD，且必须是真实存在的日期）`);
      } else {
        entry.lastmod = lastmod;
      }
    }
    if (changefreq) {
      if (!CHANGEFREQ.includes(changefreq)) {
        errors.push(`第 ${index + 1} 行的 changefreq「${changefreq}」不在允许值内`);
      } else {
        entry.changefreq = changefreq;
      }
    }
    if (priority !== undefined && priority !== '') {
      const value = Number(priority);
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        errors.push(`第 ${index + 1} 行的 priority「${priority}」需要在 0.0-1.0 之间`);
      } else {
        entry.priority = value;
      }
    }

    entries.push(entry);
  });

  return { entries, errors };
}

/**
 * 生成 sitemap.xml。
 * @param {{entries:Array, includeLastmod?:boolean}} input
 */
export function generateSitemap(input = {}) {
  const entries = Array.isArray(input.entries) ? input.entries : [];
  const warnings = [];

  if (!entries.length) return { ok: false, error: '至少需要一个地址' };
  if (entries.length > SITEMAP_LIMITS.maxUrls) {
    return {
      ok: false,
      error: `单个 sitemap 最多 ${SITEMAP_LIMITS.maxUrls} 个地址，当前 ${entries.length} 个，请改用 sitemap 索引`
    };
  }

  const tooLong = entries.filter((entry) => entry.loc.length > SITEMAP_LIMITS.maxUrlLength);
  if (tooLong.length) warnings.push(`有 ${tooLong.length} 个地址超过 ${SITEMAP_LIMITS.maxUrlLength} 字符`);

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
  ];

  for (const entry of entries) {
    lines.push('  <url>');
    lines.push(`    <loc>${escapeXml(entry.loc)}</loc>`);
    if (entry.lastmod) lines.push(`    <lastmod>${escapeXml(entry.lastmod)}</lastmod>`);
    if (entry.changefreq) lines.push(`    <changefreq>${escapeXml(entry.changefreq)}</changefreq>`);
    if (entry.priority !== undefined && entry.priority !== null) {
      lines.push(`    <priority>${Number(entry.priority).toFixed(1)}</priority>`);
    }
    lines.push('  </url>');
  }

  lines.push('</urlset>');
  const xml = `${lines.join('\n')}\n`;
  const bytes = new TextEncoder().encode(xml).length;

  if (bytes > SITEMAP_LIMITS.maxBytes) {
    return { ok: false, error: `sitemap 超过 ${SITEMAP_LIMITS.maxBytes / 1024 / 1024} MB 上限，请拆分` };
  }

  return { ok: true, xml, count: entries.length, bytes, warnings };
}

/**
 * 生成 sitemap 索引（当站点有很多 sitemap 时使用）。
 */
export function generateSitemapIndex(input = {}) {
  const sitemaps = Array.isArray(input.sitemaps) ? input.sitemaps.filter((entry) => entry && entry.loc) : [];
  if (!sitemaps.length) return { ok: false, error: '至少需要一个子 sitemap 地址' };
  if (sitemaps.length > SITEMAP_LIMITS.maxUrls) {
    return { ok: false, error: `索引最多 ${SITEMAP_LIMITS.maxUrls} 条` };
  }

  for (const entry of sitemaps) {
    if (!isValidHttpUrl(entry.loc)) return { ok: false, error: `「${entry.loc}」不是合法的 http(s) 地址` };
  }

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
  ];
  for (const entry of sitemaps) {
    lines.push('  <sitemap>');
    lines.push(`    <loc>${escapeXml(entry.loc)}</loc>`);
    if (entry.lastmod) lines.push(`    <lastmod>${escapeXml(entry.lastmod)}</lastmod>`);
    lines.push('  </sitemap>');
  }
  lines.push('</sitemapindex>');

  return { ok: true, xml: `${lines.join('\n')}\n`, count: sitemaps.length };
}

/** 常见的静态站点地址示例，方便一键填充。 */
export const URL_LIST_SAMPLE = [
  'https://example.com/',
  'https://example.com/about 2026-01-01 monthly 0.8',
  'https://example.com/blog 2026-02-15 weekly 0.9',
  'https://example.com/contact 2026-01-01 yearly 0.5'
].join('\n');
