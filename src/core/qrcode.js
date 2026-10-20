/* 二维码编码器 —— 纯逻辑层，从零实现，无第三方依赖。
 *
 * 支持版本 1–8、L/M/Q/H 四种纠错等级、数字/字母数字/字节三种模式、
 * 完整的 Reed-Solomon 纠错与 8 种掩码的罚分择优。
 *
 * 关于版本范围：版本 9 以上需要额外的分块结构表。本实现只收录了
 * 能用公开容量表逐项验证的版本 1–8（L 级最多 192 字节），
 * 宁可范围小也不输出可能扫不出来的码。
 */

export const MIN_VERSION = 1;
export const MAX_VERSION = 8;

export const ECC_LEVELS = [
  { id: 'L', label: 'L · 低（约可恢复 7%）', formatBits: 1 },
  { id: 'M', label: 'M · 中（约可恢复 15%）', formatBits: 0 },
  { id: 'Q', label: 'Q · 较高（约可恢复 25%）', formatBits: 3 },
  { id: 'H', label: 'H · 高（约可恢复 30%）', formatBits: 2 }
];

/* 每个版本的 [块数, 每块纠错码字数]。
   数据码字数 = 总码字数 - 块数 × 每块纠错数，其值已由测试对照公开容量表逐项验证。 */
const ECC_TABLE = [
  { L: [1, 7], M: [1, 10], Q: [1, 13], H: [1, 17] }, // 1
  { L: [1, 10], M: [1, 16], Q: [1, 22], H: [1, 28] }, // 2
  { L: [1, 15], M: [1, 26], Q: [2, 18], H: [2, 22] }, // 3
  { L: [1, 20], M: [2, 18], Q: [2, 26], H: [4, 16] }, // 4
  { L: [1, 26], M: [2, 24], Q: [4, 18], H: [4, 22] }, // 5
  { L: [2, 18], M: [4, 16], Q: [4, 24], H: [4, 28] }, // 6
  { L: [2, 20], M: [4, 18], Q: [4, 27], H: [5, 26] }, // 7
  { L: [2, 24], M: [4, 22], Q: [4, 33], H: [6, 26] } //  8
];

/* ── 版本几何 ─────────────────────────────────────────────── */

/** 扣除功能图案后可用于数据的模块数。 */
export function rawDataModules(version) {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    result -= (25 * align - 10) * align - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

export function totalCodewords(version) {
  return Math.floor(rawDataModules(version) / 8);
}

export function matrixSize(version) {
  return version * 4 + 17;
}

/** 校正图案中心坐标（含 6，不含与定位图案重叠的组合由调用方过滤）。 */
export function alignmentPositions(version) {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const size = matrixSize(version);
  // 注意是「整除后乘 2」，不是向上取整
  const step = version === 32 ? 26 : Math.floor((version * 4 + count * 2 + 1) / (count * 2 - 2)) * 2;
  const result = new Array(count);
  result[0] = 6;
  for (let i = count - 1, pos = size - 7; i >= 1; i -= 1, pos -= step) result[i] = pos;
  return result;
}

/* ── 格式与版本信息（BCH 校验） ───────────────────────────── */

export function formatInfoBits(eccFormatBits, mask) {
  const data = (eccFormatBits << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i += 1) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

export function versionInfoBits(version) {
  let rem = version;
  for (let i = 0; i < 12; i += 1) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | rem;
}

/* ── 伽罗华域 GF(256) 与 Reed-Solomon ─────────────────────── */

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);

(() => {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) GF_EXP[i] = GF_EXP[i - 255];
})();

export function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

/** 生成多项式 (x-α^0)(x-α^1)…(x-α^(degree-1))，最高次系数省略。 */
export function rsGenerator(degree) {
  const result = new Uint8Array(degree);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < degree; j += 1) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return result;
}

export function rsEncode(data, degree) {
  const generator = rsGenerator(degree);
  const result = new Uint8Array(degree);
  for (const byte of data) {
    const factor = byte ^ result[0];
    result.copyWithin(0, 1);
    result[degree - 1] = 0;
    for (let i = 0; i < degree; i += 1) result[i] ^= gfMul(generator[i], factor);
  }
  return result;
}

/** 在 GF(256) 上求多项式在 α^power 处的值（用于测试纠错码字是否正确）。 */
export function gfPolyEval(coefficients, power) {
  let result = 0;
  const x = GF_EXP[power % 255];
  for (const coefficient of coefficients) result = gfMul(result, x) ^ coefficient;
  return result;
}

/* ── 编码模式 ─────────────────────────────────────────────── */

const ALPHANUMERIC = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

export const MODES = { numeric: 0x1, alphanumeric: 0x2, byte: 0x4 };

export function chooseMode(text) {
  if (/^[0-9]*$/.test(text)) return 'numeric';
  if ([...text].every((char) => ALPHANUMERIC.includes(char))) return 'alphanumeric';
  return 'byte';
}

export function charCountBits(mode, version) {
  const group = version <= 9 ? 0 : version <= 26 ? 1 : 2;
  if (mode === 'numeric') return [10, 12, 14][group];
  if (mode === 'alphanumeric') return [9, 11, 13][group];
  return [8, 16, 16][group];
}

function appendBits(bits, value, length) {
  for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1);
}

function buildSegment(text, mode) {
  const bits = [];

  if (mode === 'numeric') {
    for (let i = 0; i < text.length; i += 3) {
      const chunk = text.slice(i, i + 3);
      appendBits(bits, Number(chunk), chunk.length * 3 + 1);
    }
    return { mode, modeBits: MODES.numeric, charCount: text.length, bits };
  }

  if (mode === 'alphanumeric') {
    for (let i = 0; i < text.length; i += 2) {
      const first = ALPHANUMERIC.indexOf(text[i]);
      if (i + 1 < text.length) {
        const second = ALPHANUMERIC.indexOf(text[i + 1]);
        appendBits(bits, first * 45 + second, 11);
      } else {
        appendBits(bits, first, 6);
      }
    }
    return { mode, modeBits: MODES.alphanumeric, charCount: text.length, bits };
  }

  const bytes = new TextEncoder().encode(text);
  for (const byte of bytes) appendBits(bits, byte, 8);
  return { mode: 'byte', modeBits: MODES.byte, charCount: bytes.length, bits };
}

export function segmentBitLength(segment, version) {
  return 4 + charCountBits(segment.mode, version) + segment.bits.length;
}

/* ── 容量 ─────────────────────────────────────────────────── */

function dataCodewords(version, ecc) {
  const [blocks, eccPerBlock] = ECC_TABLE[version - 1][ecc];
  return totalCodewords(version) - blocks * eccPerBlock;
}

/** 某版本 + 等级下、指定模式能容纳的字符数。 */
export function capacity(version, ecc, mode = 'byte') {
  if (version < MIN_VERSION || version > MAX_VERSION) return 0;
  const available = dataCodewords(version, ecc) * 8;
  const overhead = 4 + charCountBits(mode, version);
  const usable = available - overhead;
  if (usable <= 0) return 0;
  if (mode === 'numeric') return Math.floor((usable / 10) * 3);
  if (mode === 'alphanumeric') return Math.floor((usable / 11) * 2);
  return Math.floor(usable / 8);
}

export function capacityTable(mode = 'byte') {
  return ECC_LEVELS.map((level) => ({
    ecc: level.id,
    label: level.label,
    byVersion: Array.from({ length: MAX_VERSION }, (_, index) => capacity(index + 1, level.id, mode))
  }));
}

function chooseVersion(segment, ecc, minVersion) {
  for (let version = Math.max(MIN_VERSION, minVersion); version <= MAX_VERSION; version += 1) {
    if (segmentBitLength(segment, version) <= dataCodewords(version, ecc) * 8) return version;
  }
  return 0;
}

/* ── 码字组装 ─────────────────────────────────────────────── */

function buildDataCodewords(segment, version, capacityCodewords) {
  const bits = [];
  appendBits(bits, segment.modeBits, 4);
  appendBits(bits, segment.charCount, charCountBits(segment.mode, version));
  for (const bit of segment.bits) bits.push(bit);

  const capacityBits = capacityCodewords * 8;
  const terminator = Math.min(4, capacityBits - bits.length);
  for (let i = 0; i < terminator; i += 1) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const bytes = [];
  for (let i = 0; i < bits.length; i += 8) {
    let value = 0;
    for (let j = 0; j < 8; j += 1) value = (value << 1) | bits[i + j];
    bytes.push(value);
  }

  const PAD = [0xec, 0x11];
  let padIndex = 0;
  while (bytes.length < capacityCodewords) {
    bytes.push(PAD[padIndex % 2]);
    padIndex += 1;
  }
  return bytes;
}

/** 分块计算纠错码并按标准顺序交织。 */
export function interleave(dataBytes, numBlocks, eccPerBlock) {
  const shortLength = Math.floor(dataBytes.length / numBlocks);
  const numLong = dataBytes.length % numBlocks;

  // 规范要求 group 1（较短的块）排在前面，多出的码字属于最后的块。
  const blocks = [];
  let offset = 0;
  for (let i = 0; i < numBlocks; i += 1) {
    const length = shortLength + (i >= numBlocks - numLong ? 1 : 0);
    const data = dataBytes.slice(offset, offset + length);
    offset += length;
    blocks.push({ data, ecc: rsEncode(data, eccPerBlock) });
  }

  const result = [];
  const maxDataLength = shortLength + (numLong > 0 ? 1 : 0);
  for (let i = 0; i < maxDataLength; i += 1) {
    for (const block of blocks) if (i < block.data.length) result.push(block.data[i]);
  }
  for (let i = 0; i < eccPerBlock; i += 1) {
    for (const block of blocks) result.push(block.ecc[i]);
  }
  return result;
}

/* ── 矩阵构建 ─────────────────────────────────────────────── */

export function maskBit(mask, x, y) {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

function applyMask(modules, isFunction, size, mask) {
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (isFunction[y * size + x]) continue;
      if (maskBit(mask, x, y)) modules[y * size + x] ^= 1;
    }
  }
}

function drawFormat(modules, size, eccFormatBits, mask) {
  const bits = formatInfoBits(eccFormatBits, mask);
  const set = (x, y, dark) => {
    modules[y * size + x] = dark ? 1 : 0;
  };
  const bit = (index) => ((bits >>> index) & 1) === 1;

  for (let i = 0; i <= 5; i += 1) set(8, i, bit(i));
  set(8, 7, bit(6));
  set(8, 8, bit(7));
  set(7, 8, bit(8));
  for (let i = 9; i < 15; i += 1) set(14 - i, 8, bit(i));

  for (let i = 0; i < 8; i += 1) set(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i += 1) set(8, size - 15 + i, bit(i));
  set(8, size - 8, true);
}

export function penaltyScore(modules, size) {
  let penalty = 0;

  // 规则 1：同色连续 5 个以上
  const scanLine = (get) => {
    let run = 1;
    for (let i = 1; i < size; i += 1) {
      if (get(i) === get(i - 1)) {
        run += 1;
      } else {
        if (run >= 5) penalty += 3 + (run - 5);
        run = 1;
      }
    }
    if (run >= 5) penalty += 3 + (run - 5);
  };
  for (let y = 0; y < size; y += 1) scanLine((x) => modules[y * size + x]);
  for (let x = 0; x < size; x += 1) scanLine((y) => modules[y * size + x]);

  // 规则 2：2×2 同色块
  for (let y = 0; y < size - 1; y += 1) {
    for (let x = 0; x < size - 1; x += 1) {
      const value = modules[y * size + x];
      if (
        value === modules[y * size + x + 1] &&
        value === modules[(y + 1) * size + x] &&
        value === modules[(y + 1) * size + x + 1]
      ) {
        penalty += 3;
      }
    }
  }

  // 规则 3：出现类似定位图案的 1:1:3:1:1 组合
  const patternA = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const patternB = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  const scanPattern = (get) => {
    for (let i = 0; i + 11 <= size; i += 1) {
      let matchA = true;
      let matchB = true;
      for (let k = 0; k < 11; k += 1) {
        const value = get(i + k);
        if (value !== patternA[k]) matchA = false;
        if (value !== patternB[k]) matchB = false;
      }
      if (matchA) penalty += 40;
      if (matchB) penalty += 40;
    }
  };
  for (let y = 0; y < size; y += 1) scanPattern((x) => modules[y * size + x]);
  for (let x = 0; x < size; x += 1) scanPattern((y) => modules[y * size + x]);

  // 规则 4：深色比例偏离 50%
  let dark = 0;
  for (const value of modules) dark += value;
  const total = size * size;
  const k = Math.floor((Math.abs(dark * 20 - total * 10) + total - 1) / total) - 1;
  penalty += k * 10;

  return penalty;
}

export function buildMatrix(version, eccFormatBits, codewords) {
  const size = matrixSize(version);
  const modules = new Uint8Array(size * size);
  const isFunction = new Uint8Array(size * size);

  const setFunction = (x, y, dark) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    modules[y * size + x] = dark ? 1 : 0;
    isFunction[y * size + x] = 1;
  };

  // 定时图案
  for (let i = 0; i < size; i += 1) {
    setFunction(6, i, i % 2 === 0);
    setFunction(i, 6, i % 2 === 0);
  }

  // 定位图案与分隔符
  const drawFinder = (centerX, centerY) => {
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        setFunction(centerX + dx, centerY + dy, dist !== 2 && dist !== 4);
      }
    }
  };
  drawFinder(3, 3);
  drawFinder(size - 4, 3);
  drawFinder(3, size - 4);

  // 校正图案
  const positions = alignmentPositions(version);
  for (const centerY of positions) {
    for (const centerX of positions) {
      const overlapsFinder =
        (centerX === 6 && centerY === 6) ||
        (centerX === 6 && centerY === size - 7) ||
        (centerX === size - 7 && centerY === 6);
      if (overlapsFinder) continue;
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          setFunction(centerX + dx, centerY + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }
  }

  // 版本信息（版本 7 及以上）
  if (version >= 7) {
    const bits = versionInfoBits(version);
    for (let i = 0; i < 18; i += 1) {
      const dark = ((bits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFunction(a, b, dark);
      setFunction(b, a, dark);
    }
  }

  // 预留格式信息区域与固定的暗模块
  for (let i = 0; i <= 5; i += 1) setFunction(8, i, false);
  setFunction(8, 7, false);
  setFunction(8, 8, false);
  setFunction(7, 8, false);
  for (let i = 9; i < 15; i += 1) setFunction(14 - i, 8, false);
  for (let i = 0; i < 8; i += 1) setFunction(size - 1 - i, 8, false);
  for (let i = 8; i < 15; i += 1) setFunction(8, size - 15 + i, false);
  setFunction(8, size - 8, true);

  // 按 Z 字形放置数据
  let bitIndex = 0;
  const totalBits = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert += 1) {
      for (let j = 0; j < 2; j += 1) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!isFunction[y * size + x] && bitIndex < totalBits) {
          modules[y * size + x] = (codewords[bitIndex >> 3] >>> (7 - (bitIndex & 7))) & 1;
          bitIndex += 1;
        }
      }
    }
  }

  // 逐个试掩码，取罚分最低者
  let bestMask = 0;
  let bestPenalty = Infinity;
  let bestModules = null;
  for (let mask = 0; mask < 8; mask += 1) {
    const candidate = Uint8Array.from(modules);
    applyMask(candidate, isFunction, size, mask);
    drawFormat(candidate, size, eccFormatBits, mask);
    const score = penaltyScore(candidate, size);
    if (score < bestPenalty) {
      bestPenalty = score;
      bestMask = mask;
      bestModules = candidate;
    }
  }

  return { modules: bestModules, matrixSize: size, mask: bestMask, penalty: bestPenalty };
}

/* ── 对外入口 ─────────────────────────────────────────────── */

export function getModule(result, x, y) {
  return result.modules[y * result.matrixSize + x] === 1;
}

/**
 * 生成二维码。
 * @returns {{ok:true, ...}|{ok:false, error:string}}
 */
export function encode(text, { ecc = 'M', version = 0 } = {}) {
  const payload = String(text ?? '');
  if (!payload) return { ok: false, error: '内容为空' };

  const level = ECC_LEVELS.find((entry) => entry.id === ecc);
  if (!level) return { ok: false, error: `未知的纠错等级：${ecc}` };

  const mode = chooseMode(payload);
  const segment = buildSegment(payload, mode);

  let targetVersion = Number(version) || 0;
  if (targetVersion) {
    if (targetVersion < MIN_VERSION || targetVersion > MAX_VERSION) {
      return { ok: false, error: `版本需在 ${MIN_VERSION}–${MAX_VERSION} 之间` };
    }
    if (segmentBitLength(segment, targetVersion) > dataCodewords(targetVersion, ecc) * 8) {
      return { ok: false, error: `内容超出版本 ${targetVersion} 在 ${ecc} 级下的容量` };
    }
  } else {
    targetVersion = chooseVersion(segment, ecc, MIN_VERSION);
    if (!targetVersion) {
      const max = capacity(MAX_VERSION, ecc, mode);
      return {
        ok: false,
        error: `内容过长：${ecc} 级最多约 ${max} 个${mode === 'byte' ? '字节' : '字符'}，当前 ${segment.charCount}`
      };
    }
  }

  const codewordCount = dataCodewords(targetVersion, ecc);
  const dataBytes = buildDataCodewords(segment, targetVersion, codewordCount);
  const [blocks, eccPerBlock] = ECC_TABLE[targetVersion - 1][ecc];
  const allCodewords = interleave(dataBytes, blocks, eccPerBlock);
  const matrix = buildMatrix(targetVersion, level.formatBits, allCodewords);

  return {
    ok: true,
    version: targetVersion,
    ecc,
    mode,
    mask: matrix.mask,
    matrixSize: matrix.matrixSize,
    modules: matrix.modules,
    penalty: matrix.penalty,
    dataCodewords: codewordCount,
    totalCodewords: totalCodewords(targetVersion),
    blocks,
    eccPerBlock,
    bytes: segment.charCount
  };
}

/* ── 输出格式 ─────────────────────────────────────────────── */

export function toSvg(result, { margin = 4, scale = 8, dark = '#000000', light = '#ffffff' } = {}) {
  const size = result.matrixSize;
  const dimension = (size + margin * 2) * scale;
  let path = '';

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (result.modules[y * size + x]) {
        path += `M${(x + margin) * scale} ${(y + margin) * scale}h${scale}v${scale}h-${scale}z`;
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${dimension}" height="${dimension}" viewBox="0 0 ${dimension} ${dimension}" shape-rendering="crispEdges"><rect width="${dimension}" height="${dimension}" fill="${light}"/><path d="${path}" fill="${dark}"/></svg>`;
}

/** 终端可用的字符画，用半高方块让上下两行合成一个方格。 */
export function toTerminal(result, { quietZone = 2, invert = false, useHalfBlocks = true } = {}) {
  const size = result.matrixSize;
  const dark = invert ? ' ' : '█';
  const light = invert ? '█' : ' ';

  const get = (x, y) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return 0;
    return result.modules[y * size + x];
  };

  const lines = [];
  const top = -quietZone;
  const bottom = size + quietZone;

  if (!useHalfBlocks) {
    for (let y = top; y < bottom; y += 1) {
      let line = '';
      for (let x = top; x < bottom; x += 1) line += get(x, y) ? dark.repeat(2) : light.repeat(2);
      lines.push(line);
    }
    return lines.join('\n');
  }

  for (let y = top; y < bottom; y += 2) {
    let line = '';
    for (let x = top; x < bottom; x += 1) {
      const upper = get(x, y);
      const lower = get(x, y + 1);
      if (upper && lower) line += '█';
      else if (upper) line += '▀';
      else if (lower) line += '▄';
      else line += ' ';
    }
    lines.push(line);
  }
  return lines.join('\n');
}

/** 供界面直接绘制的 0/1 数组（含静默区）。 */
export function toMatrix2D(result, { quietZone = 0 } = {}) {
  const size = result.matrixSize;
  const dimension = size + quietZone * 2;
  const grid = [];
  for (let y = 0; y < dimension; y += 1) {
    const row = new Uint8Array(dimension);
    for (let x = 0; x < dimension; x += 1) {
      const sx = x - quietZone;
      const sy = y - quietZone;
      row[x] = sx >= 0 && sy >= 0 && sx < size && sy < size ? result.modules[sy * size + sx] : 0;
    }
    grid.push(row);
  }
  return grid;
}
