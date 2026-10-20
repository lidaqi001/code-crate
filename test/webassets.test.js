import test from 'node:test';
import assert from 'node:assert/strict';

import {
  generateMetaTags,
  generateRobotsTxt,
  summarizeRobots,
  generateSitemap,
  generateSitemapIndex,
  parseUrlList,
  escapeHtml,
  escapeXml,
  isValidHttpUrl,
  isAbsoluteUrl,
  isW3CDate,
  CHANGEFREQ,
  AI_CRAWLERS,
  SITEMAP_LIMITS,
  URL_LIST_SAMPLE,
  META_DEFAULTS
} from '../src/tools/webassets/logic.js';

/* ══════════════ 转义 ══════════════ */

test('HTML 与 XML 转义', () => {
  assert.equal(escapeHtml('<a href="x">&'), '&lt;a href=&quot;x&quot;&gt;&amp;');
  assert.equal(escapeHtml("it's"), 'it&#39;s');
  assert.equal(escapeXml('<loc>&"</loc>'), '&lt;loc&gt;&amp;&quot;&lt;/loc&gt;');
  assert.equal(escapeXml("'"), '&apos;');
});

test('地址校验', () => {
  assert.equal(isValidHttpUrl('https://example.com'), true);
  assert.equal(isValidHttpUrl('http://example.com/a?b=1'), true);
  assert.equal(isValidHttpUrl('ftp://example.com'), false);
  assert.equal(isValidHttpUrl('example.com'), false);
  assert.equal(isValidHttpUrl(''), false);
  assert.equal(isAbsoluteUrl('mailto:a@b.com'), true);
});

/* ══════════════ meta 标签 ══════════════ */

test('生成完整的 meta 标签', () => {
  const result = generateMetaTags({
    title: '码匣',
    description: '一个零权限的开发者工具箱',
    url: 'https://example.com/',
    image: 'https://example.com/og.png',
    siteName: '码匣',
    locale: 'zh_CN',
    themeColor: '#0a0a0a',
    canonical: 'https://example.com/',
    twitterSite: '@codecrate'
  });

  assert.equal(result.ok, true);
  assert.match(result.html, /<title>码匣<\/title>/);
  assert.match(result.html, /<meta name="description" content="一个零权限的开发者工具箱" \/>/);
  assert.match(result.html, /<meta property="og:title" content="码匣" \/>/);
  assert.match(result.html, /<meta property="og:image" content="https:\/\/example\.com\/og\.png" \/>/);
  assert.match(result.html, /<meta property="og:locale" content="zh_CN" \/>/);
  assert.match(result.html, /<meta name="twitter:card" content="summary_large_image" \/>/);
  assert.match(result.html, /<link rel="canonical" href="https:\/\/example\.com\/" \/>/);
  assert.match(result.html, /<meta name="theme-color" content="#0a0a0a" \/>/);
});

test('meta 标签会转义特殊字符', () => {
  const result = generateMetaTags({
    title: 'A & B <script>alert(1)</script>',
    description: 'He said "hi" & left',
    url: 'https://example.com/'
  });

  assert.equal(result.html.includes('<script>'), false);
  assert.match(result.html, /&lt;script&gt;/);
  assert.match(result.html, /&amp;/);
  assert.match(result.html, /&quot;hi&quot;/);
});

test('meta 标签缺少标题时报错', () => {
  const result = generateMetaTags({ description: 'x' });
  assert.equal(result.ok, false);
  assert.match(result.error, /标题不能为空/);
});

test('meta 标签校验地址并给出建议', () => {
  assert.match(generateMetaTags({ title: 'x', url: 'not a url' }).error, /页面地址/);
  assert.match(generateMetaTags({ title: 'x', image: 'bad' }).error, /分享图/);
  assert.match(generateMetaTags({ title: 'x', canonical: 'bad' }).error, /canonical/);

  const short = generateMetaTags({ title: 'x', description: '短描述' });
  assert.equal(short.ok, true);
  assert.ok(short.warnings.some((warning) => /页面地址/.test(warning)));

  const onlyTitle = generateMetaTags({ title: 'x' });
  assert.ok(onlyTitle.warnings.some((warning) => /没有填描述/.test(warning)));
});

test('meta 标签提示过长的标题与描述', () => {
  const long = generateMetaTags({
    title: 'T'.repeat(80),
    description: 'D'.repeat(200),
    url: 'https://example.com/'
  });
  assert.ok(long.warnings.some((warning) => /标题有 80 个字符/.test(warning)));
  assert.ok(long.warnings.some((warning) => /描述有 200 个字符/.test(warning)));
});

test('meta 默认值完整', () => {
  assert.equal(META_DEFAULTS.type, 'website');
  assert.equal(META_DEFAULTS.twitterCard, 'summary_large_image');
  assert.equal(META_DEFAULTS.robots, 'index, follow');
});

/* ══════════════ robots.txt ══════════════ */

test('生成基础 robots.txt', () => {
  const result = generateRobotsTxt({
    rules: [{ userAgent: '*', allow: ['/'], disallow: ['/admin/', '/api/'] }],
    sitemaps: ['https://example.com/sitemap.xml']
  });

  assert.equal(result.ok, true);
  assert.match(result.text, /^User-agent: \*/);
  assert.match(result.text, /Allow: \//);
  assert.match(result.text, /Disallow: \/admin\//);
  assert.match(result.text, /Sitemap: https:\/\/example\.com\/sitemap\.xml/);
  assert.ok(result.text.endsWith('\n'));
});

test('robots.txt 没有规则时给出默认允许', () => {
  const result = generateRobotsTxt({ sitemaps: ['https://example.com/sitemap.xml'] });
  assert.match(result.text, /User-agent: \*/);
  assert.match(result.text, /Allow: \//);
});

test('robots.txt 支持多条规则与 Crawl-delay', () => {
  const result = generateRobotsTxt({
    rules: [
      { userAgent: '*', disallow: ['/'] },
      { userAgent: 'Googlebot', allow: ['/'], crawlDelay: 10 }
    ]
  });

  assert.match(result.text, /User-agent: \*\nDisallow: \//);
  assert.match(result.text, /User-agent: Googlebot/);
  assert.match(result.text, /Crawl-delay: 10/);
});

test('robots.txt 按长度排序规则（更具体的优先）', () => {
  const result = generateRobotsTxt({
    rules: [{ userAgent: '*', allow: ['/'], disallow: ['/a/', '/abc/def/'] }]
  });
  const lines = result.text.split('\n').filter((line) => line.startsWith('Disallow'));
  assert.deepEqual(lines, ['Disallow: /abc/def/', 'Disallow: /a/']);
});

test('robots.txt 可以批量拒绝 AI 抓取', () => {
  const result = generateRobotsTxt({ blockAi: true });
  assert.equal(result.ok, true);
  for (const agent of AI_CRAWLERS) {
    assert.match(result.text, new RegExp(`User-agent: ${agent}\\nDisallow: /`));
  }
  assert.ok(AI_CRAWLERS.length >= 8);
});

test('robots.txt 校验地址', () => {
  assert.match(generateRobotsTxt({ sitemaps: ['not-a-url'] }).error, /不是合法的 http/);
  assert.match(generateRobotsTxt({ host: 'bad' }).error, /Host/);

  const warn = generateRobotsTxt({ sitemaps: ['https://example.com/feed'] });
  assert.equal(warn.ok, true);
  assert.ok(warn.warnings.some((warning) => /\.xml/.test(warning)));

  const noSitemap = generateRobotsTxt({});
  assert.ok(noSitemap.warnings.some((warning) => /只能靠链接发现/.test(warning)));
});

test('summarizeRobots 解析回规则摘要', () => {
  const text = [
    'User-agent: *',
    'Disallow: /admin/',
    'Allow: /admin/public/',
    '',
    'User-agent: Googlebot',
    'Disallow: /nogoogle/'
  ].join('\n');

  const groups = summarizeRobots(text);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].userAgent, '*');
  assert.deepEqual(groups[0].disallow, ['/admin/']);
  assert.deepEqual(groups[0].allow, ['/admin/public/']);
  assert.equal(groups[1].userAgent, 'Googlebot');
});

test('summarizeRobots 忽略注释与空行', () => {
  const groups = summarizeRobots('# 注释\n\nUser-agent: * # 行尾注释\nDisallow: /x/\n');
  assert.equal(groups.length, 1);
  assert.equal(groups[0].userAgent, '*');
  assert.deepEqual(groups[0].disallow, ['/x/']);
});

/* ══════════════ sitemap.xml ══════════════ */

test('生成 sitemap.xml', () => {
  const result = generateSitemap({
    entries: [
      { loc: 'https://example.com/' },
      { loc: 'https://example.com/about', lastmod: '2026-01-01', changefreq: 'monthly', priority: 0.8 }
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(result.count, 2);
  assert.match(result.xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(result.xml, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.match(result.xml, /<loc>https:\/\/example\.com\/<\/loc>/);
  assert.match(result.xml, /<lastmod>2026-01-01<\/lastmod>/);
  assert.match(result.xml, /<changefreq>monthly<\/changefreq>/);
  assert.match(result.xml, /<priority>0\.8<\/priority>/);
  assert.match(result.xml, /<\/urlset>\n$/);
});

test('sitemap 会转义地址里的特殊字符', () => {
  const result = generateSitemap({ entries: [{ loc: 'https://example.com/search?a=1&b=2' }] });
  assert.match(result.xml, /a=1&amp;b=2/);
  assert.equal(result.xml.includes('&b=2<'), false);
});

test('sitemap 空输入报错，超量报错', () => {
  assert.match(generateSitemap({ entries: [] }).error, /至少需要一个地址/);

  const tooMany = generateSitemap({
    entries: Array.from({ length: SITEMAP_LIMITS.maxUrls + 1 }, (_, i) => ({ loc: `https://example.com/${i}` }))
  });
  assert.equal(tooMany.ok, false);
  assert.match(tooMany.error, /最多 50000 个地址/);
});

test('sitemap 提示过长的地址', () => {
  const long = `https://example.com/${'a'.repeat(SITEMAP_LIMITS.maxUrlLength)}`;
  const result = generateSitemap({ entries: [{ loc: long }] });
  assert.equal(result.ok, true);
  assert.ok(result.warnings.some((warning) => /超过 2048 字符/.test(warning)));
});

test('sitemap 索引', () => {
  const result = generateSitemapIndex({
    sitemaps: [
      { loc: 'https://example.com/sitemap-1.xml', lastmod: '2026-01-01' },
      { loc: 'https://example.com/sitemap-2.xml' }
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(result.count, 2);
  assert.match(result.xml, /<sitemapindex xmlns=/);
  assert.match(result.xml, /<loc>https:\/\/example\.com\/sitemap-1\.xml<\/loc>/);
  assert.match(result.xml, /<\/sitemapindex>\n$/);
});

test('sitemap 索引的校验', () => {
  assert.match(generateSitemapIndex({ sitemaps: [] }).error, /至少需要/);
  assert.match(generateSitemapIndex({ sitemaps: [{ loc: 'bad' }] }).error, /不是合法的 http/);
});

/* ══════════════ 地址列表解析 ══════════════ */

test('parseUrlList 解析每行一个地址', () => {
  const { entries, errors } = parseUrlList(URL_LIST_SAMPLE);
  assert.deepEqual(errors, []);
  assert.equal(entries.length, 4);
  assert.equal(entries[0].loc, 'https://example.com/');
  assert.equal(entries[1].lastmod, '2026-01-01');
  assert.equal(entries[1].changefreq, 'monthly');
  assert.equal(entries[1].priority, 0.8);
});

test('parseUrlList 跳过空行与注释', () => {
  const { entries, errors } = parseUrlList('\n# 注释\nhttps://example.com/\n\n');
  assert.equal(entries.length, 1);
  assert.deepEqual(errors, []);
});

test('parseUrlList 报告非法行并指出行号', () => {
  const { entries, errors } = parseUrlList('https://example.com/\nnot-a-url\nhttps://example.com/b 2026-13-99 badfreq 2');
  // 地址本身合法就保留（只是属性有问题），完全非法的地址才会被丢掉
  assert.equal(entries.length, 2);
  assert.deepEqual(entries[1], { loc: 'https://example.com/b' });
  assert.ok(errors.some((error) => /第 2 行/.test(error)));
  assert.ok(errors.some((error) => /lastmod/.test(error)));
  assert.ok(errors.some((error) => /changefreq/.test(error)));
  assert.ok(errors.some((error) => /priority/.test(error)));
});

test('parseUrlList 接受 ISO 时间戳作为 lastmod', () => {
  const { entries, errors } = parseUrlList('https://example.com/ 2026-01-01T10:00:00Z');
  assert.deepEqual(errors, []);
  assert.equal(entries[0].lastmod, '2026-01-01T10:00:00Z');
});

test('changefreq 允许值符合 sitemap 规范', () => {
  assert.deepEqual(CHANGEFREQ, ['always', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'never']);
});

/* ── 端到端：解析再生成 ───────────────────────────────────── */

test('地址列表解析后可生成合法 sitemap', () => {
  const { entries, errors } = parseUrlList(URL_LIST_SAMPLE);
  assert.deepEqual(errors, []);
  const sitemap = generateSitemap({ entries });
  assert.equal(sitemap.ok, true);
  assert.equal((sitemap.xml.match(/<url>/g) || []).length, 4);
});

test('isW3CDate 校验真实日期而不是只校验格式', () => {
  assert.equal(isW3CDate('2026-01-01'), true);
  assert.equal(isW3CDate('2024-02-29'), true); // 闰年
  assert.equal(isW3CDate('2026-02-29'), false); // 非闰年
  assert.equal(isW3CDate('2026-13-01'), false); // 没有 13 月
  assert.equal(isW3CDate('2026-01-32'), false); // 没有 32 日
  assert.equal(isW3CDate('2026-00-10'), false);
  assert.equal(isW3CDate('2026-01-01T10:00:00Z'), true);
  assert.equal(isW3CDate('2026-01-01T25:00:00Z'), false);
  assert.equal(isW3CDate('not a date'), false);
});
