import test from 'node:test';
import assert from 'node:assert/strict';

import {
  generateSvg,
  generateSet,
  toDataUri,
  toCssBackground,
  isValidColor,
  autoFontSize,
  estimateTextWidth,
  charWidthRatio,
  PATTERNS,
  SIZE_PRESETS,
  DEFAULT_OPTIONS
} from '../src/tools/svg/logic.js';
import { parseXml } from '../src/tools/converter/xml.js';

/** 用自己写的 XML 解析器验证生成的 SVG 是合法 XML —— 结构错误会直接让图片加载失败。 */
function assertWellFormed(svg) {
  assert.doesNotThrow(() => parseXml(svg), `SVG 不是合法 XML：${svg.slice(0, 120)}`);
  const parsed = parseXml(svg);
  assert.equal(parsed.rootName, 'svg');
  return parsed;
}

/* ── 基础生成 ─────────────────────────────────────────────── */

test('生成基本 SVG 且是合法 XML', () => {
  const result = generateSvg({ width: 600, height: 400, text: '600 × 400' });
  assert.equal(result.ok, true);
  assert.match(result.svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(result.svg, /width="600"/);
  assert.match(result.svg, /height="400"/);
  assert.match(result.svg, /viewBox="0 0 600 400"/);
  assert.match(result.svg, /<\/svg>$/);
  assertWellFormed(result.svg);
});

test('尺寸经过取整与范围校验', () => {
  assert.equal(generateSvg({ width: 100.6, height: 200.4 }).svg.includes('width="101"'), true);
  assert.match(generateSvg({ width: 0, height: 100 }).error, /宽度需要在/);
  assert.match(generateSvg({ width: 100, height: 99999 }).error, /高度需要在/);
  assert.match(generateSvg({ width: 'abc', height: 100 }).error, /宽度需要在/);
});

test('默认选项完整', () => {
  assert.equal(DEFAULT_OPTIONS.width, 600);
  assert.equal(DEFAULT_OPTIONS.pattern, 'solid');
  assert.ok(SIZE_PRESETS.length >= 5);
  assert.ok(PATTERNS.some((entry) => entry.id === 'grid'));
});

/* ── 转义与安全 ───────────────────────────────────────────── */

test('文字中的特殊字符会被转义（不会注入标签）', () => {
  const result = generateSvg({ text: '<script>alert(1)</script>', width: 400, height: 200 });
  assert.equal(result.ok, true);
  assert.equal(result.svg.includes('<script>'), false);
  assert.match(result.svg, /&lt;script&gt;/);
  assertWellFormed(result.svg);
});

test('双引号与 & 在属性中正确转义', () => {
  const result = generateSvg({ text: 'a "b" & c', width: 400, height: 200 });
  assert.match(result.svg, /&quot;b&quot;/);
  assert.match(result.svg, /&amp;/);
  assertWellFormed(result.svg);
});

test('aria-label 无法突破属性边界', () => {
  const payload = '"><img src=x onerror=alert(1)>';
  const result = generateSvg({ text: payload, width: 300, height: 300 });

  // 只断言「字符串里没出现 onerror」是没有意义的 —— 它本来就在属性值文本里。
  // 真正要验证的是：引号被转义，payload 无法逃出属性，也不会产生新的元素。
  const parsed = parseXml(result.svg);
  assert.equal(parsed.value['@aria-label'], payload, '属性值应原样还原，说明无法逃逸');
  assert.equal(parsed.value.img, undefined, '不应产生 img 元素');
  assert.equal(result.svg.includes('<img'), false);
  assertWellFormed(result.svg);
});

/* ── 自动字号 ─────────────────────────────────────────────── */

test('自动字号不超出画布', () => {
  const short = autoFontSize('Hi', 600, 400);
  const long = autoFontSize('这是一段很长的占位文字内容需要缩小', 600, 400);
  assert.ok(short > long, '文本越长字号应越小');
  assert.ok(short <= 400 * 0.28);
  assert.ok(estimateTextWidth('这是一段很长的占位文字内容需要缩小', long) <= 600 * 0.82 + 1);
});

test('中文字符比西文字符宽', () => {
  assert.equal(charWidthRatio('中'), 1);
  assert.equal(charWidthRatio('a'), 0.58);
  assert.ok(estimateTextWidth('中文', 10) > estimateTextWidth('ab', 10));
});

test('空文本不产生 text 元素', () => {
  const result = generateSvg({ text: '', width: 300, height: 200 });
  assert.equal(result.svg.includes('<text'), false);
  assertWellFormed(result.svg);
  assert.equal(generateSvg({ text: '', width: 300, height: 200 }).fontSize, 0);
});

test('指定字号时优先使用', () => {
  const result = generateSvg({ text: 'X', fontSize: 42, width: 400, height: 300 });
  assert.equal(result.fontSize, 42);
  assert.match(result.svg, /font-size="42"/);
});

test('文字过长时给出提示', () => {
  const result = generateSvg({ text: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', fontSize: 64, width: 200, height: 100 });
  assert.equal(result.ok, true);
  assert.ok(result.warnings.some((warning) => /超出画布宽度/.test(warning)));
});

/* ── 纹理 ─────────────────────────────────────────────────── */

test('每种纹理都能生成且结构合法', () => {
  for (const pattern of PATTERNS) {
    const result = generateSvg({ pattern: pattern.id, width: 400, height: 300 });
    assert.equal(result.ok, true, pattern.id);
    assertWellFormed(result.svg);
    if (pattern.id === 'solid') {
      assert.equal(result.svg.includes('<pattern'), false, 'solid 不应生成 pattern');
    } else {
      assert.match(result.svg, /<pattern id="pattern"/, pattern.id);
      assert.match(result.svg, /fill="url\(#pattern\)"/, pattern.id);
    }
  }
});

test('未知纹理回退为纯色并提示', () => {
  const result = generateSvg({ pattern: 'nope', width: 300, height: 200 });
  assert.equal(result.ok, true);
  assert.equal(result.svg.includes('<pattern'), false);
  assert.ok(result.warnings.some((warning) => /未知的纹理/.test(warning)));
});

/* ── 渐变与圆角 ───────────────────────────────────────────── */

test('渐变背景生成 linearGradient', () => {
  const result = generateSvg({ background: '#ff0000', backgroundEnd: '#0000ff', width: 400, height: 300 });
  assert.equal(result.ok, true);
  assert.match(result.svg, /<linearGradient id="bg"/);
  assert.match(result.svg, /stop-color="#ff0000"/);
  assert.match(result.svg, /stop-color="#0000ff"/);
  assert.match(result.svg, /fill="url\(#bg\)"/);
  assertWellFormed(result.svg);
});

test('圆角生成 clipPath', () => {
  const result = generateSvg({ radius: 16, width: 400, height: 300 });
  assert.match(result.svg, /<clipPath id="clip">/);
  assert.match(result.svg, /rx="16"/);
  assert.match(result.svg, /clip-path="url\(#clip\)"/);
  assertWellFormed(result.svg);
});

test('圆形按短边计算圆角', () => {
  const result = generateSvg({ circle: true, width: 200, height: 200 });
  assert.match(result.svg, /rx="100"/);
});

test('圆形用于非正方形时给出提示', () => {
  const result = generateSvg({ circle: true, width: 400, height: 200 });
  assert.ok(result.warnings.some((warning) => /圆形只对正方形/.test(warning)));
});

test('圆角过大时给出提示', () => {
  const result = generateSvg({ radius: 999, width: 200, height: 200 });
  assert.ok(result.warnings.some((warning) => /圆角半径超过/.test(warning)));
});

/* ── 颜色校验 ─────────────────────────────────────────────── */

test('颜色校验覆盖常见写法', () => {
  assert.equal(isValidColor('#fff'), true);
  assert.equal(isValidColor('#ffffff'), true);
  assert.equal(isValidColor('#ffffff80'), true);
  assert.equal(isValidColor('rgb(1,2,3)'), true);
  assert.equal(isValidColor('rgba(1,2,3,0.5)'), true);
  assert.equal(isValidColor('hsl(200, 50%, 50%)'), true);
  assert.equal(isValidColor('transparent'), true);
  assert.equal(isValidColor('not-a-color'), false);
  assert.equal(isValidColor('#gggggg'), false);
  assert.equal(isValidColor(''), false);
});

test('非法颜色给出明确错误', () => {
  assert.match(generateSvg({ background: 'nope' }).error, /背景色.*不是合法颜色/);
  assert.match(generateSvg({ backgroundEnd: 'nope' }).error, /渐变结束色/);
  assert.match(generateSvg({ foreground: 'nope' }).error, /纹理颜色/);
  assert.match(generateSvg({ textColor: 'nope' }).error, /文字颜色/);
});

/* ── 输出形式 ─────────────────────────────────────────────── */

test('data URI 可安全嵌入（含中文）', () => {
  const result = generateSvg({ text: '中文占位', width: 300, height: 200 });
  const uri = toDataUri(result.svg);
  assert.match(uri, /^data:image\/svg\+xml,/);
  // 解码后应还原原文
  assert.equal(decodeURIComponent(uri.slice('data:image/svg+xml,'.length)), result.svg);
});

test('CSS background 写法', () => {
  const result = generateSvg({ width: 100, height: 100 });
  const css = toCssBackground(result.svg);
  assert.match(css, /^background-image: url\("data:image\/svg\+xml,/);
  assert.match(css, /"\);$/);
});

test('统计字节数', () => {
  const result = generateSvg({ width: 600, height: 400 });
  assert.equal(result.bytes, new TextEncoder().encode(result.svg).length);
  assert.ok(result.bytes > 100);
});

test('generateSet 生成多尺寸', () => {
  const results = generateSet({ text: 'demo' }, ['16:9', '1:1']);
  assert.equal(results.length, 2);
  assert.equal(results[0].id, '16:9');
  for (const item of results) {
    assert.equal(item.ok, true);
    assertWellFormed(item.svg);
  }
});

test('生成的 SVG 可被 XML 解析器完整还原结构', () => {
  const result = generateSvg({
    width: 320, height: 240, text: '结构检查', pattern: 'grid', radius: 12, background: '#111111', backgroundEnd: '#333333'
  });
  const parsed = parseXml(result.svg);
  assert.equal(parsed.rootName, 'svg');
  const value = parsed.value;
  assert.equal(value['@width'], '320');
  assert.equal(value['@viewBox'], '0 0 320 240');
  assert.ok(value.defs, '应包含 defs');
});
