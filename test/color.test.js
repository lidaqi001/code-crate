import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseColor,
  rgbToHex,
  rgbToHsl,
  hslToRgb,
  formatColor,
  relativeLuminance,
  contrastRatio,
  wcagLevels,
  bestTextColor,
  mix,
  lighten,
  darken,
  colorScale,
  tints,
  shades,
  harmony,
  shiftHue,
  withAlpha,
  randomColor,
  randomHex,
  NAMED_COLORS,
  HARMONY_KINDS,
  FORMATS
} from '../src/tools/color/logic.js';

const rgbaOf = (input) => {
  const result = parseColor(input);
  assert.equal(result.ok, true, `${input} 解析失败：${result.error}`);
  return result.rgba;
};

/* ── 解析 ─────────────────────────────────────────────────── */

test('parseColor 支持 3/4/6/8 位十六进制', () => {
  assert.deepEqual(rgbaOf('#abc'), { r: 170, g: 187, b: 204, a: 1 });
  assert.deepEqual(rgbaOf('#aabbcc'), { r: 170, g: 187, b: 204, a: 1 });
  assert.deepEqual(rgbaOf('#ABC'), { r: 170, g: 187, b: 204, a: 1 });

  const withAlpha = rgbaOf('#aabbcc80');
  assert.equal(withAlpha.r, 170);
  assert.equal(Math.round(withAlpha.a * 255), 128);

  const shortAlpha = rgbaOf('#abcd');
  assert.equal(shortAlpha.r, 170);
  assert.equal(Math.round(shortAlpha.a * 255), 221);
});

test('parseColor 支持 rgb 与 rgba 的各种写法', () => {
  assert.deepEqual(rgbaOf('rgb(255, 0, 0)'), { r: 255, g: 0, b: 0, a: 1 });
  assert.deepEqual(rgbaOf('rgb(255 0 0)'), { r: 255, g: 0, b: 0, a: 1 });
  assert.deepEqual(rgbaOf('rgb(100% 0% 0%)'), { r: 255, g: 0, b: 0, a: 1 });

  const half = rgbaOf('rgb(255 0 0 / 50%)');
  assert.equal(half.r, 255);
  assert.equal(half.a, 0.5);

  assert.equal(rgbaOf('rgba(0, 0, 0, 0.25)').a, 0.25);
});

test('parseColor 支持 hsl 与 hsla', () => {
  assert.deepEqual(rgbaOf('hsl(0, 100%, 50%)'), { r: 255, g: 0, b: 0, a: 1 });
  assert.deepEqual(rgbaOf('hsl(210, 100%, 50%)'), { r: 0, g: 128, b: 255, a: 1 });
  assert.equal(rgbaOf('hsla(0, 100%, 50%, 0.4)').a, 0.4);
});

test('parseColor 支持颜色名与 transparent', () => {
  assert.deepEqual(rgbaOf('red'), { r: 255, g: 0, b: 0, a: 1 });
  assert.deepEqual(rgbaOf('REBECCAPURPLE'), { r: 102, g: 51, b: 153, a: 1 });
  assert.equal(rgbaOf('transparent').a, 0);
  assert.ok(Object.keys(NAMED_COLORS).length > 40);
});

test('parseColor 对非法输入返回错误而不是抛异常', () => {
  for (const input of ['', '   ', '#12', '#12345', 'rgb(1,2)', 'notacolor', 'rgb(a,b,c)']) {
    const result = parseColor(input);
    assert.equal(result.ok, false, input);
    assert.ok(result.error.length > 0);
  }
});

/* ── 转换 ─────────────────────────────────────────────────── */

test('rgb 与 hex 互转', () => {
  assert.equal(rgbToHex({ r: 255, g: 0, b: 0 }), '#ff0000');
  assert.equal(rgbToHex({ r: 0, g: 0, b: 0 }), '#000000');
  assert.equal(rgbToHex({ r: 255, g: 255, b: 255 }), '#ffffff');
  assert.equal(rgbToHex({ r: 255, g: 0, b: 0, a: 0.5 }, { withAlpha: true }), '#ff000080');
  assert.equal(rgbToHex({ r: 171, g: 205, b: 239 }, { upper: true }), '#ABCDEF');
});

test('rgb 与 hsl 已知换算', () => {
  assert.deepEqual(rgbToHsl({ r: 255, g: 0, b: 0 }), { h: 0, s: 100, l: 50 });
  assert.deepEqual(rgbToHsl({ r: 0, g: 255, b: 0 }), { h: 120, s: 100, l: 50 });
  assert.deepEqual(rgbToHsl({ r: 0, g: 0, b: 255 }), { h: 240, s: 100, l: 50 });
  assert.deepEqual(rgbToHsl({ r: 255, g: 255, b: 255 }), { h: 0, s: 0, l: 100 });
  assert.deepEqual(rgbToHsl({ r: 0, g: 0, b: 0 }), { h: 0, s: 0, l: 0 });

  assert.deepEqual(hslToRgb({ h: 0, s: 100, l: 50 }), { r: 255, g: 0, b: 0 });
  assert.deepEqual(hslToRgb({ h: 120, s: 100, l: 50 }), { r: 0, g: 255, b: 0 });
  assert.deepEqual(hslToRgb({ h: 0, s: 0, l: 50 }), { r: 128, g: 128, b: 128 });
});

test('hsl 负角度与超过 360 的角度都能归一化', () => {
  assert.deepEqual(hslToRgb({ h: -120, s: 100, l: 50 }), hslToRgb({ h: 240, s: 100, l: 50 }));
  assert.deepEqual(hslToRgb({ h: 480, s: 100, l: 50 }), hslToRgb({ h: 120, s: 100, l: 50 }));
});

test('rgb -> hsl -> rgb 往返误差在 1 以内', () => {
  for (const hex of ['#ff0000', '#00ff00', '#0000ff', '#5b8cff', '#123456', '#f0f0f0', '#7f7f7f']) {
    const rgb = rgbaOf(hex);
    const back = hslToRgb(rgbToHsl(rgb));
    for (const channel of ['r', 'g', 'b']) {
      assert.ok(Math.abs(back[channel] - rgb[channel]) <= 1, `${hex} 的 ${channel} 偏差过大`);
    }
  }
});

test('formatColor 输出各种格式', () => {
  const red = { r: 255, g: 0, b: 0, a: 1 };
  assert.equal(formatColor(red, 'hex'), '#ff0000');
  assert.equal(formatColor(red, 'hex-upper'), '#FF0000');
  assert.equal(formatColor(red, 'rgb'), 'rgb(255, 0, 0)');
  assert.equal(formatColor(red, 'hsl'), 'hsl(0, 100%, 50%)');
  assert.equal(formatColor(red, 'css-var'), '0 100% 50%');

  const half = { r: 255, g: 0, b: 0, a: 0.5 };
  assert.equal(formatColor(half, 'rgb'), 'rgba(255, 0, 0, 0.5)');
  assert.equal(formatColor(half, 'hex'), '#ff000080');
});

test('FORMATS 列表非空且都能格式化', () => {
  assert.ok(FORMATS.length >= 4);
  for (const format of FORMATS) {
    assert.equal(typeof formatColor({ r: 1, g: 2, b: 3, a: 1 }, format.id), 'string', format.id);
  }
});

/* ── 对比度 ───────────────────────────────────────────────── */

test('相对亮度端点值正确', () => {
  assert.equal(relativeLuminance({ r: 0, g: 0, b: 0 }), 0);
  assert.equal(relativeLuminance({ r: 255, g: 255, b: 255 }), 1);
});

test('黑白对比度为 21，同色为 1', () => {
  const white = { r: 255, g: 255, b: 255 };
  const black = { r: 0, g: 0, b: 0 };
  assert.equal(Math.round(contrastRatio(white, black) * 100) / 100, 21);
  assert.equal(contrastRatio(white, white), 1);
  assert.equal(contrastRatio(black, black), 1);
});

test('对比度与参数顺序无关', () => {
  const a = { r: 91, g: 140, b: 255 };
  const b = { r: 255, g: 255, b: 255 };
  assert.equal(contrastRatio(a, b), contrastRatio(b, a));
});

test('对比度符合 WCAG 已知数值', () => {
  // #767676 对白约 4.54（刚好通过 AA），#777777 约 4.48（刚好不通过）
  const pass = contrastRatio(rgbaOf('#767676'), rgbaOf('#ffffff'));
  const fail = contrastRatio(rgbaOf('#777777'), rgbaOf('#ffffff'));
  assert.ok(Math.abs(pass - 4.54) < 0.02, `实际 ${pass}`);
  assert.ok(Math.abs(fail - 4.48) < 0.02, `实际 ${fail}`);
  assert.equal(wcagLevels(pass).aaNormal, true);
  assert.equal(wcagLevels(fail).aaNormal, false);
});

test('wcagLevels 阈值判定正确', () => {
  assert.deepEqual(wcagLevels(21), { aaNormal: true, aaLarge: true, aaaNormal: true, aaaLarge: true });
  assert.deepEqual(wcagLevels(7), { aaNormal: true, aaLarge: true, aaaNormal: true, aaaLarge: true });
  assert.deepEqual(wcagLevels(4.5), { aaNormal: true, aaLarge: true, aaaNormal: false, aaaLarge: true });
  assert.deepEqual(wcagLevels(3), { aaNormal: false, aaLarge: true, aaaNormal: false, aaaLarge: false });
  assert.deepEqual(wcagLevels(1), { aaNormal: false, aaLarge: false, aaaNormal: false, aaaLarge: false });
});

test('bestTextColor 在浅底上给黑字、深底上给白字', () => {
  const onWhite = bestTextColor(rgbaOf('#ffffff'));
  assert.equal(onWhite.color, '#000000');
  assert.equal(Math.round(onWhite.ratio), 21);

  const onBlack = bestTextColor(rgbaOf('#000000'));
  assert.equal(onBlack.color, '#ffffff');

  const onBlue = bestTextColor(rgbaOf('#3161e0'));
  assert.equal(onBlue.color, '#ffffff');
});

/* ── 混合与色阶（旧版本出错的地方） ───────────────────────── */

test('mix 在两个颜色之间线性插值', () => {
  const white = { r: 255, g: 255, b: 255 };
  const black = { r: 0, g: 0, b: 0 };
  assert.deepEqual(mix(black, white, 0), { r: 0, g: 0, b: 0, a: 1 });
  assert.deepEqual(mix(black, white, 1), { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual(mix(black, white, 0.5), { r: 128, g: 128, b: 128, a: 1 });
});

test('lighten 一定更亮，darken 一定更暗', () => {
  const base = rgbaOf('#5b8cff');
  assert.ok(relativeLuminance(lighten(base, 0.5)) > relativeLuminance(base));
  assert.ok(relativeLuminance(darken(base, 0.5)) < relativeLuminance(base));
  assert.ok(relativeLuminance(lighten(base, 0.9)) > relativeLuminance(lighten(base, 0.3)));
  assert.ok(relativeLuminance(darken(base, 0.9)) < relativeLuminance(darken(base, 0.1)));
});

test('色阶亮度随编号单调递减（旧实现的 darker 反而更亮）', () => {
  for (const hex of ['#5b8cff', '#ff0000', '#3fb950', '#d29922', '#000000', '#ffffff']) {
    const scale = colorScale(rgbaOf(hex));
    assert.equal(scale.length, 10);
    assert.equal(scale[0].name, '50');
    assert.equal(scale[9].name, '900');

    for (let i = 1; i < scale.length; i += 1) {
      assert.ok(
        scale[i].luminance <= scale[i - 1].luminance,
        `${hex}：${scale[i - 1].name}(${scale[i - 1].luminance.toFixed(4)}) 应当不暗于 ${scale[i].name}(${scale[i].luminance.toFixed(4)})`
      );
    }
  }
});

test('色阶的 500 就是基色本身', () => {
  const base = rgbaOf('#5b8cff');
  const scale = colorScale(base);
  const step500 = scale.find((step) => step.name === '500');
  assert.equal(step500.hex, '#5b8cff');
});

test('色阶编号与明暗方向符合直觉', () => {
  const base = rgbaOf('#5b8cff');
  const scale = colorScale(base);
  const light = scale.find((step) => step.name === '100');
  const dark = scale.find((step) => step.name === '800');
  assert.ok(relativeLuminance(light.color) > relativeLuminance(base));
  assert.ok(relativeLuminance(dark.color) < relativeLuminance(base));
});

test('tints 与 shades 序列方向正确', () => {
  const base = rgbaOf('#5b8cff');
  const tintList = tints(base, 5);
  const shadeList = shades(base, 5);

  assert.equal(tintList.length, 5);
  assert.equal(shadeList.length, 5);

  // tints 由浅到深
  for (let i = 1; i < tintList.length; i += 1) {
    assert.ok(relativeLuminance(tintList[i]) <= relativeLuminance(tintList[i - 1]));
  }
  assert.ok(tintList.every((color) => relativeLuminance(color) > relativeLuminance(base)));

  // shades 由浅到深，且都暗于基色
  for (let i = 1; i < shadeList.length; i += 1) {
    assert.ok(relativeLuminance(shadeList[i]) <= relativeLuminance(shadeList[i - 1]));
  }
  assert.ok(shadeList.every((color) => relativeLuminance(color) < relativeLuminance(base)));
});

/* ── 配色方案 ─────────────────────────────────────────────── */

test('互补色是色相旋转 180 度', () => {
  const base = rgbaOf('#ff0000');
  const [first, second] = harmony(base, 'complementary');
  assert.deepEqual(first, base);
  assert.equal(Math.round(rgbToHsl(second).h), 180);
});

test('三角配色的色相间隔为 120 度', () => {
  const colors = harmony(rgbaOf('#ff0000'), 'triadic');
  assert.equal(colors.length, 3);
  assert.equal(Math.round(rgbToHsl(colors[1]).h), 120);
  assert.equal(Math.round(rgbToHsl(colors[2]).h), 240);
});

test('所有配色方案都能生成且保持明度', () => {
  const base = rgbaOf('#5b8cff');
  const baseHsl = rgbToHsl(base);
  for (const kind of HARMONY_KINDS) {
    const colors = harmony(base, kind.id);
    assert.equal(colors.length, kind.angles.length + 1, kind.id);
    for (const color of colors) {
      assert.ok(Math.abs(rgbToHsl(color).l - baseHsl.l) < 1.5, `${kind.id} 明度漂移过大`);
    }
  }
  assert.throws(() => harmony(base, 'unknown'), /未知的配色方案/);
});

test('shiftHue 转 360 度回到原色', () => {
  const base = rgbaOf('#5b8cff');
  const shifted = shiftHue(base, 360);
  assert.equal(rgbToHex(shifted), rgbToHex(base));
});

test('withAlpha 设置透明度并夹紧范围', () => {
  const base = rgbaOf('#5b8cff');
  assert.equal(withAlpha(base, 0.5).a, 0.5);
  assert.equal(withAlpha(base, 2).a, 1);
  assert.equal(withAlpha(base, -1).a, 0);
});

/* ── 随机颜色（旧版本取不到 #ffffff） ─────────────────────── */

test('randomColor 能取到纯白与纯黑（旧实现永远取不到 #ffffff）', () => {
  const white = randomColor({ nextBytes: () => new Uint8Array([255, 255, 255]) });
  assert.equal(rgbToHex(white), '#ffffff');

  const black = randomColor({ nextBytes: () => new Uint8Array([0, 0, 0]) });
  assert.equal(rgbToHex(black), '#000000');
});

test('randomHex 每通道独立取满 0-255', () => {
  assert.equal(randomHex({ nextBytes: () => new Uint8Array([0, 128, 255]) }), '#0080ff');
  for (let i = 0; i < 50; i += 1) {
    assert.match(randomHex(), /^#[0-9a-f]{6}$/);
  }
});
