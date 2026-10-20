import test from 'node:test';
import assert from 'node:assert/strict';

import {
  encode,
  capacity,
  capacityTable,
  chooseMode,
  charCountBits,
  totalCodewords,
  matrixSize,
  alignmentPositions,
  rawDataModules,
  formatInfoBits,
  versionInfoBits,
  gfMul,
  gfPolyEval,
  rsGenerator,
  rsEncode,
  interleave,
  maskBit,
  buildMatrix,
  getModule,
  toSvg,
  toTerminal,
  toMatrix2D,
  MIN_VERSION,
  MAX_VERSION,
  ECC_LEVELS
} from '../src/tools/qrcode/logic.js';

/* ══════════════════════════════════════════════════════════
   独立解码器：只依赖公开的矩阵输出，用来端到端验证编码结果。
   位置规则按规范重新实现，不复用编码器内部实现。
   ══════════════════════════════════════════════════════════ */

function buildFunctionMap(version, size) {
  const map = new Uint8Array(size * size);
  const mark = (x, y) => {
    if (x >= 0 && y >= 0 && x < size && y < size) map[y * size + x] = 1;
  };

  for (let i = 0; i < size; i += 1) {
    mark(6, i);
    mark(i, 6);
  }

  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy += 1) for (let dx = -4; dx <= 4; dx += 1) mark(cx + dx, cy + dy);
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);

  const positions = alignmentPositions(version);
  for (const cy of positions) {
    for (const cx of positions) {
      const overlap =
        (cx === 6 && cy === 6) || (cx === 6 && cy === size - 7) || (cx === size - 7 && cy === 6);
      if (overlap) continue;
      for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) mark(cx + dx, cy + dy);
    }
  }

  if (version >= 7) {
    for (let i = 0; i < 18; i += 1) {
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      mark(a, b);
      mark(b, a);
    }
  }

  for (let i = 0; i <= 5; i += 1) mark(8, i);
  mark(8, 7);
  mark(8, 8);
  mark(7, 8);
  for (let i = 9; i < 15; i += 1) mark(14 - i, 8);
  for (let i = 0; i < 8; i += 1) mark(size - 1 - i, 8);
  for (let i = 8; i < 15; i += 1) mark(8, size - 15 + i);
  mark(8, size - 8);

  return map;
}

function readCodewords(result) {
  const size = result.matrixSize;
  const isFunction = buildFunctionMap(result.version, size);

  // 去掩码
  const plain = Uint8Array.from(result.modules);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (!isFunction[y * size + x] && maskBit(result.mask, x, y)) plain[y * size + x] ^= 1;
    }
  }

  const bits = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert += 1) {
      for (let j = 0; j < 2; j += 1) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!isFunction[y * size + x]) bits.push(plain[y * size + x]);
      }
    }
  }

  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let value = 0;
    for (let k = 0; k < 8; k += 1) value = (value << 1) | bits[i + k];
    bytes.push(value);
  }
  return bytes;
}

function deinterleave(bytes, numBlocks, eccPerBlock) {
  const totalData = bytes.length - numBlocks * eccPerBlock;
  const shortLength = Math.floor(totalData / numBlocks);
  const numLong = totalData % numBlocks;
  // 与规范一致：短块在前，多出的码字属于末尾的长块
  const lengths = Array.from({ length: numBlocks }, (_, i) => shortLength + (i >= numBlocks - numLong ? 1 : 0));

  const blocks = lengths.map((length) => ({ length, data: [] }));
  let index = 0;
  const maxLength = shortLength + (numLong > 0 ? 1 : 0);
  for (let i = 0; i < maxLength; i += 1) {
    for (const block of blocks) if (i < block.length) block.data.push(bytes[index++]);
  }

  return blocks.flatMap((block) => block.data);
}

const ALPHANUMERIC = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

function decodeResult(result) {
  const bytes = deinterleave(readCodewords(result), result.blocks, result.eccPerBlock);
  const bits = [];
  for (const byte of bytes) for (let k = 7; k >= 0; k -= 1) bits.push((byte >> k) & 1);

  let pos = 0;
  const take = (n) => {
    let value = 0;
    for (let i = 0; i < n; i += 1) value = (value << 1) | bits[pos++];
    return value;
  };

  const mode = take(4);
  if (mode === 0x1) {
    const length = take(charCountBits('numeric', result.version));
    let out = '';
    let remaining = length;
    while (remaining >= 3) {
      out += String(take(10)).padStart(3, '0');
      remaining -= 3;
    }
    if (remaining === 2) out += String(take(7)).padStart(2, '0');
    else if (remaining === 1) out += String(take(4));
    return out;
  }

  if (mode === 0x2) {
    const length = take(charCountBits('alphanumeric', result.version));
    let out = '';
    let remaining = length;
    while (remaining >= 2) {
      const value = take(11);
      out += ALPHANUMERIC[Math.floor(value / 45)] + ALPHANUMERIC[value % 45];
      remaining -= 2;
    }
    if (remaining === 1) out += ALPHANUMERIC[take(6)];
    return out;
  }

  if (mode === 0x4) {
    const length = take(charCountBits('byte', result.version));
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i += 1) out[i] = take(8);
    return new TextDecoder().decode(out);
  }

  throw new Error(`未知的模式：${mode}`);
}

/* ── 几何与容量 ───────────────────────────────────────────── */

test('总码字数与矩阵尺寸符合规范', () => {
  const expectedCodewords = [26, 44, 70, 100, 134, 172, 196, 242];
  const expectedSize = [21, 25, 29, 33, 37, 41, 45, 49];
  for (let version = 1; version <= MAX_VERSION; version += 1) {
    assert.equal(totalCodewords(version), expectedCodewords[version - 1], `v${version} 总码字数`);
    assert.equal(matrixSize(version), expectedSize[version - 1], `v${version} 尺寸`);
  }
});

test('可用模块数公式正确', () => {
  assert.equal(rawDataModules(1), 208);
  assert.equal(rawDataModules(2), 359);
  assert.equal(rawDataModules(7), 1568);
});

test('校正图案位置与规范一致', () => {
  assert.deepEqual(alignmentPositions(1), []);
  assert.deepEqual(alignmentPositions(2), [6, 18]);
  assert.deepEqual(alignmentPositions(3), [6, 22]);
  assert.deepEqual(alignmentPositions(4), [6, 26]);
  assert.deepEqual(alignmentPositions(5), [6, 30]);
  assert.deepEqual(alignmentPositions(6), [6, 34]);
  assert.deepEqual(alignmentPositions(7), [6, 22, 38]);
  assert.deepEqual(alignmentPositions(8), [6, 24, 42]);
});

test('字节模式容量与公开容量表逐项一致', () => {
  // 这是校验纠错分块表是否正确的关键测试
  const published = {
    L: [17, 32, 53, 78, 106, 134, 154, 192],
    M: [14, 26, 42, 62, 84, 106, 122, 152],
    Q: [11, 20, 32, 46, 60, 74, 86, 108],
    H: [7, 14, 24, 34, 44, 58, 64, 84]
  };
  for (const level of ECC_LEVELS) {
    for (let version = 1; version <= MAX_VERSION; version += 1) {
      assert.equal(
        capacity(version, level.id, 'byte'),
        published[level.id][version - 1],
        `v${version}-${level.id} 字节容量`
      );
    }
  }
});

test('数字与字母数字模式容量更大', () => {
  assert.ok(capacity(1, 'L', 'numeric') > capacity(1, 'L', 'byte'));
  assert.ok(capacity(1, 'L', 'alphanumeric') > capacity(1, 'L', 'byte'));
  // v1-L 公开容量：数字 41、字母数字 25、字节 17
  assert.equal(capacity(1, 'L', 'numeric'), 41);
  assert.equal(capacity(1, 'L', 'alphanumeric'), 25);
  assert.equal(capacity(1, 'L', 'byte'), 17);
});

test('容量表结构完整', () => {
  const table = capacityTable('byte');
  assert.equal(table.length, 4);
  for (const row of table) {
    assert.equal(row.byVersion.length, MAX_VERSION);
    assert.ok(row.byVersion.every((value) => value > 0));
    // 容量随版本严格递增
    for (let i = 1; i < row.byVersion.length; i += 1) {
      assert.ok(row.byVersion[i] > row.byVersion[i - 1], row.ecc);
    }
  }
});

test('纠错等级越高容量越小', () => {
  for (let version = 1; version <= MAX_VERSION; version += 1) {
    const l = capacity(version, 'L', 'byte');
    const m = capacity(version, 'M', 'byte');
    const q = capacity(version, 'Q', 'byte');
    const h = capacity(version, 'H', 'byte');
    assert.ok(l >= m && m >= q && q >= h, `v${version}`);
  }
});

/* ── BCH 校验位 ───────────────────────────────────────────── */

/** 多项式取余：value 除以 generator（generator 为 genDegree 次）。 */
function polyRemainder(value, generator, genDegree, valueDegree) {
  let result = value;
  for (let i = valueDegree; i >= genDegree; i -= 1) {
    if ((result >>> i) & 1) result ^= generator << (i - genDegree);
  }
  return result;
}

test('格式信息已知值正确', () => {
  assert.equal(formatInfoBits(1, 0), 0x77c4); // L + 掩码 0
  assert.equal(formatInfoBits(0, 0), 0x5412); // M + 掩码 0
});

test('全部 32 个格式信息码都是生成多项式的倍数且互不相同', () => {
  const seen = new Set();
  for (const level of ECC_LEVELS) {
    for (let mask = 0; mask < 8; mask += 1) {
      const bits = formatInfoBits(level.formatBits, mask);
      // 去掉固定的异或掩码后应当是 BCH 码字
      const codeword = bits ^ 0x5412;
      assert.equal(polyRemainder(codeword, 0x537, 10, 14), 0, `${level.id}/mask${mask} 不是 BCH 码字`);
      seen.add(bits);
    }
  }
  assert.equal(seen.size, 32);
});

test('版本信息已知值与 BCH 性质', () => {
  assert.equal(versionInfoBits(7), 0x07c94);
  assert.equal(versionInfoBits(8), 0x085bc);
  // 7–40 版本的版本信息都必须是生成多项式的倍数
  for (let version = 7; version <= 40; version += 1) {
    assert.equal(polyRemainder(versionInfoBits(version), 0x1f25, 12, 17), 0, `v${version}`);
  }
});

/* ── Reed-Solomon ─────────────────────────────────────────── */

test('伽罗华域乘法满足基本性质', () => {
  assert.equal(gfMul(0, 5), 0);
  assert.equal(gfMul(5, 0), 0);
  assert.equal(gfMul(1, 7), 7);
  // 本原元 2 的 255 次方回到 1
  let x = 1;
  for (let i = 0; i < 255; i += 1) x = gfMul(x, 2);
  assert.equal(x, 1);
});

test('生成多项式次数正确且常数项非零', () => {
  for (const degree of [7, 10, 13, 17, 26]) {
    const generator = rsGenerator(degree);
    assert.equal(generator.length, degree);
    assert.notEqual(generator[degree - 1], 0, `degree=${degree} 常数项为零`);
  }
});

test('纠错码字使整体多项式在 α^0…α^(n-1) 处取零', () => {
  // 这是 Reed-Solomon 的定义性质，能证明纠错码字算对了
  const data = Uint8Array.from([0x10, 0x20, 0x0c, 0x56, 0x61, 0x80, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11]);
  for (const degree of [7, 10, 13, 17]) {
    const ecc = rsEncode(data, degree);
    assert.equal(ecc.length, degree);
    const full = [...data, ...ecc];
    for (let i = 0; i < degree; i += 1) {
      assert.equal(gfPolyEval(full, i), 0, `degree=${degree} 在 α^${i} 处不为零`);
    }
  }
});

test('交织后的码字总数等于总码字数', () => {
  const data = new Uint8Array(34).fill(0x11);
  const result = interleave(data, 1, 10);
  assert.equal(result.length, 44); // v2-M：34 数据 + 10 纠错
});

/* ── 模式选择 ─────────────────────────────────────────────── */

test('自动选择最紧凑的编码模式', () => {
  assert.equal(chooseMode('123456'), 'numeric');
  assert.equal(chooseMode('HELLO WORLD'), 'alphanumeric');
  assert.equal(chooseMode('Hello'), 'byte');
  assert.equal(chooseMode('你好'), 'byte');
  assert.equal(chooseMode('https://a.com/#x'), 'byte');
});

test('字符计数指示位随版本与模式变化', () => {
  assert.equal(charCountBits('byte', 1), 8);
  assert.equal(charCountBits('byte', 10), 16);
  assert.equal(charCountBits('numeric', 1), 10);
  assert.equal(charCountBits('numeric', 10), 12);
  assert.equal(charCountBits('alphanumeric', 1), 9);
});

/* ── 端到端：从矩阵里把内容解回来 ─────────────────────────── */

test('生成的矩阵可以完整解回原文（字节模式）', () => {
  const samples = ['Hello', 'https://example.com/codecrate?q=1', '你好，世界', 'a😀b'];
  for (const text of samples) {
    const result = encode(text, { ecc: 'M' });
    assert.equal(result.ok, true, text);
    assert.equal(decodeResult(result), text, text);
  }
});

test('生成的矩阵可以完整解回原文（数字与字母数字模式）', () => {
  for (const text of ['1234567890', '0001', 'HELLO WORLD', 'ABC-123/XYZ', 'A']) {
    const result = encode(text, { ecc: 'Q' });
    assert.equal(result.ok, true, text);
    assert.equal(result.mode, chooseMode(text));
    assert.equal(decodeResult(result), text, text);
  }
});

test('四种纠错等级都能正确往返', () => {
  const text = 'CodeCrate QR 测试内容';
  for (const level of ECC_LEVELS) {
    const result = encode(text, { ecc: level.id });
    assert.equal(result.ok, true, level.id);
    assert.equal(result.ecc, level.id);
    assert.equal(decodeResult(result), text, level.id);
  }
});

test('从版本 1 到 8 都能正确往返', () => {
  for (let version = 1; version <= MAX_VERSION; version += 1) {
    const fill = capacity(version, 'L', 'byte');
    const text = 'x'.repeat(Math.max(1, Math.min(fill, 10)));
    const result = encode(text, { ecc: 'L', version });
    assert.equal(result.ok, true, `v${version}`);
    assert.equal(result.version, version);
    assert.equal(result.matrixSize, matrixSize(version));
    assert.equal(decodeResult(result), text, `v${version}`);
  }
});

test('接近容量上限时仍能正确编码', () => {
  for (const level of ['L', 'M', 'Q', 'H']) {
    for (let version = 1; version <= MAX_VERSION; version += 1) {
      const limit = capacity(version, level, 'byte');
      const text = 'z'.repeat(limit);
      const result = encode(text, { ecc: level, version });
      assert.equal(result.ok, true, `v${version}-${level} 恰好填满应当成功`);
      assert.equal(decodeResult(result), text, `v${version}-${level}`);
    }
  }
});

test('超出容量时明确报错', () => {
  const limit = capacity(MAX_VERSION, 'H', 'byte');
  const result = encode('z'.repeat(limit + 1), { ecc: 'H' });
  assert.equal(result.ok, false);
  assert.match(result.error, /内容过长|容量/);
});

/* ── 矩阵结构 ─────────────────────────────────────────────── */

test('三个定位图案与分隔符正确', () => {
  const result = encode('test', { ecc: 'M' });
  const size = result.matrixSize;
  const finder = (ox, oy) => {
    for (let y = 0; y < 7; y += 1) {
      for (let x = 0; x < 7; x += 1) {
        const edge = x === 0 || y === 0 || x === 6 || y === 6;
        const core = x >= 2 && x <= 4 && y >= 2 && y <= 4;
        const expected = edge || core;
        assert.equal(getModule(result, ox + x, oy + y), expected, `定位图案 (${ox},${oy}) 的 (${x},${y})`);
      }
    }
  };
  finder(0, 0);
  finder(size - 7, 0);
  finder(0, size - 7);
});

test('定时图案黑白交替', () => {
  const result = encode('test', { ecc: 'M' });
  const size = result.matrixSize;
  for (let i = 8; i < size - 8; i += 1) {
    assert.equal(getModule(result, i, 6), i % 2 === 0, `横向定时 ${i}`);
    assert.equal(getModule(result, 6, i), i % 2 === 0, `纵向定时 ${i}`);
  }
});

test('固定的暗模块被点亮', () => {
  const result = encode('test', { ecc: 'M' });
  assert.equal(getModule(result, 8, result.matrixSize - 8), true);
});

test('格式信息在矩阵中可读回', () => {
  const result = encode('test', { ecc: 'Q' });
  const size = result.matrixSize;
  const level = ECC_LEVELS.find((entry) => entry.id === 'Q');
  const expected = formatInfoBits(level.formatBits, result.mask);
  const bit = (index) => ((expected >>> index) & 1) === 1;

  // 第一份副本
  for (let i = 0; i <= 5; i += 1) assert.equal(getModule(result, 8, i), bit(i), `第一副本 ${i}`);
  assert.equal(getModule(result, 8, 7), bit(6));
  assert.equal(getModule(result, 8, 8), bit(7));
  assert.equal(getModule(result, 7, 8), bit(8));
  for (let i = 9; i < 15; i += 1) assert.equal(getModule(result, 14 - i, 8), bit(i), `第一副本 ${i}`);

  // 第二份副本
  for (let i = 0; i < 8; i += 1) assert.equal(getModule(result, size - 1 - i, 8), bit(i), `第二副本 ${i}`);
  for (let i = 8; i < 15; i += 1) assert.equal(getModule(result, 8, size - 15 + i), bit(i), `第二副本 ${i}`);
});

test('版本信息在矩阵中可读回（版本 7 及以上）', () => {
  const result = encode('x'.repeat(150), { ecc: 'L' });
  assert.ok(result.version >= 7, `实际版本 ${result.version}`);
  const size = result.matrixSize;
  const bits = versionInfoBits(result.version);
  for (let i = 0; i < 18; i += 1) {
    const expected = ((bits >>> i) & 1) === 1;
    const a = size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    assert.equal(getModule(result, a, b), expected, `右上 ${i}`);
    assert.equal(getModule(result, b, a), expected, `左下 ${i}`);
  }
});

test('掩码取值在 0-7 且罚分为非负数', () => {
  for (const text of ['a', 'hello world', '12345', 'x'.repeat(100)]) {
    const result = encode(text, { ecc: 'M' });
    assert.ok(result.mask >= 0 && result.mask <= 7);
    assert.ok(result.penalty >= 0);
  }
});

test('掩码函数符合规范定义', () => {
  assert.equal(maskBit(0, 1, 1), true);
  assert.equal(maskBit(0, 1, 2), false);
  assert.equal(maskBit(1, 5, 4), true);
  assert.equal(maskBit(2, 3, 7), true);
  assert.equal(maskBit(3, 1, 2), true);
});

test('buildMatrix 输出尺寸与掩码一致', () => {
  const matrix = buildMatrix(2, 0, new Array(totalCodewords(2)).fill(0));
  assert.equal(matrix.matrixSize, 25);
  assert.equal(matrix.modules.length, 625);
  assert.ok(matrix.mask >= 0 && matrix.mask <= 7);
});

/* ── 参数校验与输出格式 ───────────────────────────────────── */

test('空内容与非法参数给出可读错误', () => {
  assert.equal(encode('').ok, false);
  assert.match(encode('').error, /为空/);
  assert.equal(encode('x', { ecc: 'Z' }).ok, false);
  assert.match(encode('x', { ecc: 'Z' }).error, /纠错等级/);
  assert.equal(encode('x', { version: 99 }).ok, false);
  assert.match(encode('x', { version: 99 }).error, /版本/);
});

test('指定版本但内容放不下时明确报错', () => {
  const result = encode('z'.repeat(500), { ecc: 'H', version: 1 });
  assert.equal(result.ok, false);
  assert.match(result.error, /容量/);
});

test('更高的纠错等级会选用更大的版本', () => {
  const text = 'x'.repeat(60);
  const low = encode(text, { ecc: 'L' });
  const high = encode(text, { ecc: 'H' });
  assert.equal(low.ok, true);
  assert.equal(high.ok, true);
  assert.ok(high.version >= low.version, `H 版 ${high.version} 应不小于 L 版 ${low.version}`);
});

test('版本选择随内容增长而提升', () => {
  let previous = 0;
  for (const length of [5, 20, 60, 120, 190]) {
    const result = encode('a'.repeat(length), { ecc: 'L' });
    assert.equal(result.ok, true, `长度 ${length}`);
    assert.ok(result.version >= previous, `长度 ${length}`);
    previous = result.version;
  }
  assert.equal(previous, MAX_VERSION);
});

test('toSvg 输出合法 SVG', () => {
  const result = encode('svg', { ecc: 'M' });
  const svg = toSvg(result, { scale: 4, margin: 2, dark: '#123456', light: '#ffffff' });
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /fill="#123456"/);
  assert.match(svg, /shape-rendering="crispEdges"/);
  assert.match(svg, /<\/svg>$/);
  assert.equal(svg.includes('undefined'), false);
});

test('toTerminal 输出可复制到终端', () => {
  const result = encode('hi', { ecc: 'M' });
  const text = toTerminal(result, { quietZone: 1 });
  const lines = text.split('\n');
  assert.ok(lines.length > 5);
  assert.ok(lines.every((line) => line.length > 5));
  assert.match(text, /[█▀▄ ]/);

  const plain = toTerminal(result, { useHalfBlocks: false });
  assert.equal(plain.split('\n').length > 10, true);
});

test('toMatrix2D 支持静默区', () => {
  const result = encode('m', { ecc: 'M' });
  const grid = toMatrix2D(result, { quietZone: 2 });
  assert.equal(grid.length, result.matrixSize + 4);
  assert.equal(grid[0].length, result.matrixSize + 4);
  assert.equal(grid[0][0], 0);
  assert.equal(grid[2][2], result.modules[0]);
});

test('版本常量与等级定义完整', () => {
  assert.equal(MIN_VERSION, 1);
  assert.equal(MAX_VERSION, 8);
  assert.equal(ECC_LEVELS.length, 4);
  assert.deepEqual(ECC_LEVELS.map((entry) => entry.id), ['L', 'M', 'Q', 'H']);
  for (const level of ECC_LEVELS) {
    assert.equal(typeof level.label, 'string');
    assert.ok(level.formatBits >= 0 && level.formatBits <= 3);
  }
});

test('交织按规范把多出的码字放在末尾块', () => {
  // 5 个数据码字分 2 块：group 1 为 2 个，group 2 为 3 个
  const result = interleave([1, 2, 3, 4, 5], 2, 1);
  assert.deepEqual(result.slice(0, 5), [1, 3, 2, 4, 5]);
});

