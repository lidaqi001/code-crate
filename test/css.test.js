import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GRADIENT_PRESETS,
  SHADOW_PRESETS,
  MAX_LAYERS,
  isHexColor,
  sanitizeColor,
  clampNumber,
  normalizeAngle,
  normalizeStops,
  buildGradient,
  buildGradientRule,
  hexToRgba,
  normalizeLayers,
  buildShadow,
  buildShadowRule
} from '../src/tools/css/logic.js';

test('十六进制颜色白名单', () => {
  for (const value of ['#fff', '#ffff', '#ff0000', '#ff000080', ' #AbC ']) {
    assert.equal(isHexColor(value), true, value);
  }
  for (const value of ['red', 'fff', '#ff', '#gggggg', 'rgba(0,0,0,.5)', '', null, 42]) {
    assert.equal(isHexColor(value), false, String(value));
  }
});

test('非法颜色退回默认值', () => {
  assert.equal(sanitizeColor('#12AB34'), '#12AB34');
  assert.equal(sanitizeColor('url(javascript:alert(1))'), '#000000');
  assert.equal(sanitizeColor(null, '#ffffff'), '#ffffff');
});

test('数值夹紧与角度回绕', () => {
  assert.equal(clampNumber('12', 0, 10, 3), 10);
  assert.equal(clampNumber(-5, 0, 10, 3), 0);
  assert.equal(clampNumber('abc', 0, 10, 3), 3);
  assert.equal(normalizeAngle(450), 90);
  assert.equal(normalizeAngle(-90), 270);
  assert.equal(normalizeAngle('x'), 0);
});

test('色标按位置升序、位置夹紧', () => {
  const stops = normalizeStops([
    { color: '#ffffff', position: 140 },
    { color: '#000000', position: -20 }
  ]);
  assert.deepEqual(stops, [
    { color: '#000000', position: 0 },
    { color: '#ffffff', position: 100 }
  ]);
});

test('色标不足时补齐到两个', () => {
  assert.equal(normalizeStops([]).length, 2);
  const one = normalizeStops([{ color: '#123456', position: 40 }]);
  assert.deepEqual(one, [
    { color: '#123456', position: 0 },
    { color: '#123456', position: 100 }
  ]);
});

test('色标数量上限', () => {
  const many = Array.from({ length: 12 }, (_, index) => ({ color: '#000000', position: index * 10 }));
  assert.equal(normalizeStops(many).length, 6);
});

test('线性渐变', () => {
  assert.equal(
    buildGradient({
      type: 'linear',
      angle: 135,
      stops: [
        { color: '#ff0000', position: 0 },
        { color: '#0000ff', position: 100 }
      ]
    }),
    'linear-gradient(135deg, #ff0000 0%, #0000ff 100%)'
  );
});

test('径向渐变使用位置与形状', () => {
  assert.equal(
    buildGradient({
      type: 'radial',
      shape: 'circle',
      x: 30,
      y: 70,
      stops: [
        { color: '#ffffff', position: 0 },
        { color: '#000000', position: 100 }
      ]
    }),
    'radial-gradient(circle at 30% 70%, #ffffff 0%, #000000 100%)'
  );
});

test('锥形渐变带起始角度', () => {
  assert.equal(
    buildGradient({
      type: 'conic',
      angle: 45,
      x: 50,
      y: 50,
      stops: [
        { color: '#ff0000', position: 0 },
        { color: '#00ff00', position: 100 }
      ]
    }),
    'conic-gradient(from 45deg at 50% 50%, #ff0000 0%, #00ff00 100%)'
  );
});

test('未知类型退回线性', () => {
  assert.ok(
    buildGradient({ type: 'nope', stops: [{ color: '#000', position: 0 }, { color: '#fff', position: 100 }] })
      .startsWith('linear-gradient(')
  );
});

test('规则字符串以分号结束', () => {
  assert.equal(
    buildGradientRule({ type: 'linear', angle: 90, stops: [{ color: '#000', position: 0 }, { color: '#fff', position: 100 }] }),
    'background: linear-gradient(90deg, #000 0%, #fff 100%);'
  );
});

test('#rgb / #rrggbb → rgba', () => {
  assert.equal(hexToRgba('#fff', 0.5), 'rgba(255, 255, 255, 0.5)');
  assert.equal(hexToRgba('#ff0000', 1), 'rgba(255, 0, 0, 1)');
  assert.equal(hexToRgba('#00ff0080', 0.25), 'rgba(0, 255, 0, 0.25)');
  assert.equal(hexToRgba('bogus', 2), 'rgba(0, 0, 0, 1)');
});

test('阴影层夹紧与默认值', () => {
  const [layer] = normalizeLayers([{ x: 999, y: -999, blur: -4, spread: 500, alpha: 9, color: '#fff' }]);
  assert.equal(layer.x, 100);
  assert.equal(layer.y, -100);
  assert.equal(layer.blur, 0);
  assert.equal(layer.spread, 100);
  assert.equal(layer.alpha, 1);
  assert.equal(layer.inset, false);
});

test('阴影层数量上限与关闭过滤', () => {
  const layers = Array.from({ length: 10 }, () => ({ x: 1, y: 1, blur: 1, spread: 0, alpha: 1 }));
  assert.equal(normalizeLayers(layers).length, MAX_LAYERS);
  assert.equal(normalizeLayers([{ x: 1, y: 1, blur: 1, spread: 0, alpha: 1, enabled: false }]).length, 0);
});

test('无阴影时返回 none', () => {
  assert.equal(buildShadow([]), 'none');
  assert.equal(buildShadowRule([]), 'box-shadow: none;');
});

test('多层阴影与 inset 顺序', () => {
  assert.equal(
    buildShadow([
      { x: 0, y: 2, blur: 8, spread: -2, color: '#000000', alpha: 0.15, inset: false },
      { x: 0, y: 1, blur: 2, spread: 0, color: '#ffffff', alpha: 0.5, inset: true }
    ]),
    '0px 2px 8px -2px rgba(0, 0, 0, 0.15), inset 0px 1px 2px 0px rgba(255, 255, 255, 0.5)'
  );
});

test('预设值都能构建出合法输出', () => {
  for (const preset of GRADIENT_PRESETS) {
    assert.ok(buildGradient(preset).startsWith(`${preset.type}-gradient(`), preset.id);
  }
  for (const preset of SHADOW_PRESETS) {
    assert.ok(buildShadow(preset.layers) !== 'none', preset.id);
  }
});
