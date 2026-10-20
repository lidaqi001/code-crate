import test from 'node:test';
import assert from 'node:assert/strict';

import {
  sniffImageType,
  parseImageInfo,
  mimeForExtension,
  extensionForMime,
  EXPORT_FORMATS
} from '../src/tools/image/sniff.js';
import { parseExif, dmsToDecimal, findExifBlock } from '../src/tools/image/exif.js';
import {
  computeTargetSize,
  applyColorMatrix,
  simulateColorVision,
  isWhitePreserving,
  COLOR_MATRICES,
  COLOR_VISION_TYPES,
  parseDataUri,
  toDataUri,
  normalizeImageInput,
  suggestFilename,
  describeConversion,
  formatBytes,
  hasAlphaNotice,
  RESIZE_MODES
} from '../src/tools/image/logic.js';

/* ══════════════ 测试夹具：手工构造文件头 ══════════════ */

const be16 = (value) => [(value >> 8) & 0xff, value & 0xff];
const be32 = (value) => [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
const le16 = (value) => [value & 0xff, (value >> 8) & 0xff];
const le32 = (value) => [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff];
const ascii = (text) => [...text].map((char) => char.charCodeAt(0));

function buildPng(width, height, { bitDepth = 8, colorType = 6 } = {}) {
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...be32(13), ...ascii('IHDR'),
    ...be32(width), ...be32(height),
    bitDepth, colorType, 0, 0, 0,
    0, 0, 0, 0
  ]);
}

function buildJpeg(width, height, { marker = 0xc0, components = 3 } = {}) {
  const app0 = [...ascii('JFIF\0'), 0x01, 0x01, 0x00, ...be16(1), ...be16(1), 0, 0];
  const sofPayload = [0x08, ...be16(height), ...be16(width), components, ...new Array(components * 3).fill(0)];
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, ...be16(app0.length + 2), ...app0,
    0xff, marker, ...be16(sofPayload.length + 2), ...sofPayload,
    0xff, 0xda, 0x00, 0x02
  ]);
}

function buildGif(width, height, version = '89a') {
  return new Uint8Array([...ascii(`GIF${version}`), ...le16(width), ...le16(height), 0, 0, 0, 0]);
}

function buildWebpVp8x(width, height) {
  return new Uint8Array([
    ...ascii('RIFF'), ...le32(30), ...ascii('WEBP'),
    ...ascii('VP8X'), ...le32(10),
    0, 0, 0, 0,
    (width - 1) & 0xff, ((width - 1) >> 8) & 0xff, ((width - 1) >> 16) & 0xff,
    (height - 1) & 0xff, ((height - 1) >> 8) & 0xff, ((height - 1) >> 16) & 0xff
  ]);
}

function buildWebpVp8l(width, height) {
  const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14);
  return new Uint8Array([
    ...ascii('RIFF'), ...le32(30), ...ascii('WEBP'),
    ...ascii('VP8L'), ...le32(10),
    0x2f,
    bits & 0xff, (bits >> 8) & 0xff, (bits >> 16) & 0xff, (bits >>> 24) & 0xff
  ]);
}

function buildBmp(width, height, { headerSize = 40 } = {}) {
  return new Uint8Array([
    ...ascii('BM'), ...le32(100), 0, 0, 0, 0, ...le32(54),
    ...le32(headerSize), ...le32(width), ...le32(height), ...le16(1), ...le16(24)
  ]);
}

/** 构造一个最小可用的 TIFF/EXIF 块，用来喂给解析器。 */
function buildTiff({ little = true, ifd0 = [], exif = [], gps = [] }) {
  const u16 = little ? le16 : be16;
  const u32 = little ? le32 : be32;

  const encodeNumber = (value, size) => {
    const bytes = [];
    for (let i = 0; i < size; i += 1) {
      const shift = little ? i * 8 : (size - 1 - i) * 8;
      bytes.push((value >> shift) & 0xff);
    }
    return bytes;
  };

  // 把一条逻辑条目编码成 { tag, type, count, bytes }
  const encode = (tag, type, raw) => {
    if (type === 2) {
      const bytes = [...ascii(String(raw)), 0];
      return { tag, type, count: bytes.length, bytes };
    }
    if (type === 3) {
      const values = Array.isArray(raw) ? raw : [raw];
      return { tag, type, count: values.length, bytes: values.flatMap((v) => encodeNumber(v, 2)) };
    }
    if (type === 4) {
      const values = Array.isArray(raw) ? raw : [raw];
      return { tag, type, count: values.length, bytes: values.flatMap((v) => encodeNumber(v, 4)) };
    }
    if (type === 5) {
      const pairs = Array.isArray(raw[0]) ? raw : [raw];
      return {
        tag,
        type,
        count: pairs.length,
        bytes: pairs.flatMap(([numerator, denominator]) => [...encodeNumber(numerator, 4), ...encodeNumber(denominator, 4)])
      };
    }
    throw new Error(`夹具不支持的 TIFF 类型：${type}`);
  };

  const ifdSize = (list) => 2 + list.length * 12 + 4;

  // IFD0 里必须真正存在指向 Exif / GPS 子目录的指针条目，否则解析器无从跳转
  const ifd0List = [...ifd0];
  if (exif.length) ifd0List.push({ tag: 0x8769, type: 4, value: 0 });
  if (gps.length) ifd0List.push({ tag: 0x8825, type: 4, value: 0 });

  const headerSize = 8;
  const ifd0Offset = headerSize;
  const exifOffset = ifd0Offset + ifdSize(ifd0List);
  const gpsOffset = exifOffset + (exif.length ? ifdSize(exif) : 0);
  const dataStart = gpsOffset + (gps.length ? ifdSize(gps) : 0);

  for (const entry of ifd0List) {
    if (entry.tag === 0x8769) entry.value = exifOffset;
    if (entry.tag === 0x8825) entry.value = gpsOffset;
  }

  const dataBytes = [];
  const addData = (bytes) => {
    if (dataBytes.length % 2 === 1) dataBytes.push(0);
    const offset = dataStart + dataBytes.length;
    dataBytes.push(...bytes);
    return offset;
  };

  const writeIfd = (list, nextOffset) => {
    const entries = list.map((item) => encode(item.tag, item.type, item.value));
    const out = [...u16(entries.length)];
    for (const entry of entries) {
      out.push(...u16(entry.tag), ...u16(entry.type), ...u32(entry.count));
      if (entry.bytes.length <= 4) {
        const inline = [...entry.bytes];
        while (inline.length < 4) inline.push(0);
        out.push(...inline);
      } else {
        out.push(...u32(addData(entry.bytes)));
      }
    }
    out.push(...u32(nextOffset));
    return out;
  };

  const ifd0Bytes = writeIfd(ifd0List, 0);
  const exifBytes = exif.length ? writeIfd(exif, 0) : [];
  const gpsBytes = gps.length ? writeIfd(gps, 0) : [];

  const header = [...ascii(little ? 'II' : 'MM'), ...u16(42), ...u32(ifd0Offset)];
  return new Uint8Array([...header, ...ifd0Bytes, ...exifBytes, ...gpsBytes, ...dataBytes]);
}

/** 把 TIFF 块包成完整的 JPEG（带 APP1 / Exif 标记）。 */
function buildJpegWithExif(tiff, { width = 100, height = 80 } = {}) {
  const app1Payload = [...ascii('Exif\0\0'), ...tiff];
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe1, ...be16(app1Payload.length + 2), ...app1Payload,
    ...buildJpeg(width, height).subarray(2)
  ]);
}

/* ══════════════ 格式识别 ══════════════ */

test('识别各格式的魔数', () => {
  assert.equal(sniffImageType(buildPng(10, 10)).mime, 'image/png');
  assert.equal(sniffImageType(buildJpeg(10, 10)).mime, 'image/jpeg');
  assert.equal(sniffImageType(buildGif(10, 10)).mime, 'image/gif');
  assert.equal(sniffImageType(buildWebpVp8x(10, 10)).mime, 'image/webp');
  assert.equal(sniffImageType(buildBmp(10, 10)).mime, 'image/bmp');
});

test('识别 GIF 的两种版本', () => {
  assert.equal(sniffImageType(buildGif(1, 1, '87a')).label, 'GIF');
  assert.equal(sniffImageType(buildGif(1, 1, '89a')).label, 'GIF');
});

test('识别 AVIF 与 HEIC 并标注尺寸不可读', () => {
  const avif = new Uint8Array([...be32(24), ...ascii('ftypavif'), 0, 0, 0, 0]);
  const info = sniffImageType(avif);
  assert.equal(info.mime, 'image/avif');
  assert.equal(info.sizeReadable, false);

  const heic = new Uint8Array([...be32(24), ...ascii('ftypheic'), 0, 0, 0, 0]);
  assert.equal(sniffImageType(heic).mime, 'image/heic');
});

test('非图像内容返回 null', () => {
  assert.equal(sniffImageType(new Uint8Array([1, 2, 3, 4])), null);
  assert.equal(sniffImageType(new Uint8Array(0)), null);
  assert.equal(sniffImageType(null), null);
  assert.equal(sniffImageType(new Uint8Array(ascii('hello world'))), null);
});

test('扩展名与 MIME 互查', () => {
  assert.equal(mimeForExtension('png'), 'image/png');
  assert.equal(mimeForExtension('.JPG'), 'image/jpeg');
  assert.equal(mimeForExtension('jpeg'), 'image/jpeg');
  assert.equal(mimeForExtension('tiff'), null);
  assert.equal(extensionForMime('image/webp'), 'webp');
  assert.equal(extensionForMime('image/nope'), null);
});

/* ══════════════ 尺寸解析 ══════════════ */

test('从 PNG 头部读尺寸', () => {
  const result = parseImageInfo(buildPng(1920, 1080));
  assert.equal(result.ok, true);
  assert.equal(result.width, 1920);
  assert.equal(result.height, 1080);
  assert.equal(result.type.label, 'PNG');
  assert.equal(result.details.colorType, 6);
});

test('从 JPEG 头部读尺寸（含跳过前置段）', () => {
  const result = parseImageInfo(buildJpeg(800, 600));
  assert.equal(result.ok, true);
  assert.equal(result.width, 800);
  assert.equal(result.height, 600);
  assert.equal(result.details.components, 3);
});

test('JPEG 的渐进式标记被识别', () => {
  assert.equal(parseImageInfo(buildJpeg(10, 10, { marker: 0xc2 })).details.progressive, true);
  assert.equal(parseImageInfo(buildJpeg(10, 10, { marker: 0xc0 })).details.progressive, false);
});

test('从 GIF 头部读尺寸（小端）', () => {
  const result = parseImageInfo(buildGif(320, 240));
  assert.equal(result.ok, true);
  assert.equal(result.width, 320);
  assert.equal(result.height, 240);
});

test('从 WebP 三种变体读尺寸', () => {
  const extended = parseImageInfo(buildWebpVp8x(1024, 768));
  assert.equal(extended.ok, true);
  assert.equal(extended.width, 1024);
  assert.equal(extended.height, 768);
  assert.equal(extended.details.variant, 'extended');

  const lossless = parseImageInfo(buildWebpVp8l(500, 400));
  assert.equal(lossless.ok, true);
  assert.equal(lossless.width, 500);
  assert.equal(lossless.height, 400);
  assert.equal(lossless.details.variant, 'lossless');
});

test('WebP 的 14 位尺寸上限', () => {
  const result = parseImageInfo(buildWebpVp8l(16383, 16383));
  assert.equal(result.width, 16383);
  assert.equal(result.height, 16383);
});

test('从 BMP 头部读尺寸', () => {
  const result = parseImageInfo(buildBmp(640, 480));
  assert.equal(result.ok, true);
  assert.equal(result.width, 640);
  assert.equal(result.height, 480);
});

test('BMP 的负高度表示自上而下，取绝对值', () => {
  const bytes = buildBmp(640, 0);
  // 把高度字段改成 -480（补码）
  const negative = le32(0x100000000 - 480);
  bytes[22] = negative[0];
  bytes[23] = negative[1];
  bytes[24] = negative[2];
  bytes[25] = negative[3];

  const result = parseImageInfo(bytes);
  assert.equal(result.ok, true);
  assert.equal(result.height, 480);
  assert.equal(result.details.topDown, true);
});

test('截断的文件给出可读原因而不是崩溃', () => {
  const full = buildPng(100, 100);
  for (const length of [1, 4, 8, 12, 20, 23]) {
    const result = parseImageInfo(full.subarray(0, length));
    assert.equal(result.ok, false, `长度 ${length}`);
    assert.ok(result.reason.length > 0);
  }
});

test('空输入与未知格式', () => {
  assert.match(parseImageInfo(new Uint8Array(0)).reason, /内容为空/);
  assert.match(parseImageInfo(new Uint8Array(ascii('not an image'))).reason, /无法识别的图像格式/);
});

test('AVIF 明确说明不支持读尺寸', () => {
  const avif = new Uint8Array([...be32(24), ...ascii('ftypavif'), 0, 0, 0, 0]);
  const result = parseImageInfo(avif);
  assert.equal(result.ok, false);
  assert.match(result.reason, /ISO BMFF/);
  assert.equal(result.type.mime, 'image/avif');
});

test('导出的格式清单只含 canvas 真正支持的', () => {
  assert.deepEqual(EXPORT_FORMATS.map((entry) => entry.mime), ['image/png', 'image/jpeg', 'image/webp']);
  assert.equal(EXPORT_FORMATS.find((entry) => entry.mime === 'image/jpeg').alpha, false);
});

/* ══════════════ EXIF 解析 ══════════════ */

test('解析小端 EXIF', () => {
  const tiff = buildTiff({
    little: true,
    ifd0: [
      { tag: 0x010f, type: 2, value: 'Canon' },
      { tag: 0x0110, type: 2, value: 'EOS R5' },
      { tag: 0x0112, type: 3, value: 6 }
    ],
    exif: [
      { tag: 0x829a, type: 5, value: [1, 200] },
      { tag: 0x829d, type: 5, value: [28, 10] },
      { tag: 0x8827, type: 3, value: 400 },
      { tag: 0x9003, type: 2, value: '2026:01:15 10:30:00' },
      { tag: 0x920a, type: 5, value: [50, 1] }
    ]
  });

  const result = parseExif(buildJpegWithExif(tiff));
  assert.equal(result.ok, true);
  assert.equal(result.found, true);
  assert.equal(result.byteOrder, '小端（II）');

  const value = (label) => result.tags.find((entry) => entry.label === label)?.value;
  assert.equal(value('制造商'), 'Canon');
  assert.equal(value('机型'), 'EOS R5');
  assert.equal(value('方向'), '6');
  assert.equal(value('ISO'), '400');
  assert.equal(value('拍摄时间'), '2026:01:15 10:30:00');
  assert.equal(value('焦距'), '50.0 mm');
  assert.equal(value('光圈'), 'f/2.8');
  assert.equal(value('曝光时间'), '1/200');
});

test('解析大端 EXIF', () => {
  const tiff = buildTiff({
    little: false,
    ifd0: [{ tag: 0x0110, type: 2, value: 'NIKON Z9' }],
    exif: [{ tag: 0x8827, type: 3, value: 800 }]
  });

  const result = parseExif(buildJpegWithExif(tiff));
  assert.equal(result.ok, true);
  assert.equal(result.byteOrder, '大端（MM）');
  assert.equal(result.tags.find((entry) => entry.label === '机型').value, 'NIKON Z9');
  assert.equal(result.tags.find((entry) => entry.label === 'ISO').value, '800');
});

test('方向的文字说明', () => {
  const tiff = buildTiff({ ifd0: [{ tag: 0x0112, type: 3, value: 6 }] });
  const result = parseExif(buildJpegWithExif(tiff));
  assert.equal(result.tags.find((entry) => entry.label === '方向').hint, '顺时针 90°');
});

test('解析 GPS 并换算成十进制度数', () => {
  const tiff = buildTiff({
    gps: [
      { tag: 0x0001, type: 2, value: 'N' },
      { tag: 0x0002, type: 5, value: [[39, 1], [54, 1], [2688, 100]] }, // 39°54'26.88"
      { tag: 0x0003, type: 2, value: 'E' },
      { tag: 0x0004, type: 5, value: [[116, 1], [23, 1], [2900, 100]] }, // 116°23'29"
      { tag: 0x0006, type: 5, value: [44, 1] }
    ]
  });

  const result = parseExif(buildJpegWithExif(tiff));
  assert.equal(result.ok, true);
  assert.ok(result.gps);
  assert.ok(Math.abs(result.gps.latitude - 39.907466) < 1e-5, String(result.gps.latitude));
  assert.ok(Math.abs(result.gps.longitude - 116.391388) < 1e-5, String(result.gps.longitude));
  assert.equal(result.gps.altitude, 44);
  assert.match(result.gps.mapsUrl, /openstreetmap\.org/);
});

test('南纬西经为负数', () => {
  const tiff = buildTiff({
    gps: [
      { tag: 0x0001, type: 2, value: 'S' },
      { tag: 0x0002, type: 5, value: [[33, 1], [52, 1], [0, 1]] },
      { tag: 0x0003, type: 2, value: 'W' },
      { tag: 0x0004, type: 5, value: [[151, 1], [12, 1], [0, 1]] }
    ]
  });
  const result = parseExif(buildJpegWithExif(tiff));
  assert.ok(result.gps.latitude < 0);
  assert.ok(result.gps.longitude < 0);
});

test('dmsToDecimal 直接测试', () => {
  assert.equal(dmsToDecimal([39, 54, 26.88], 'N'), 39.907467);
  assert.equal(dmsToDecimal([39, 54, 26.88], 'S'), -39.907467);
  assert.equal(dmsToDecimal([0, 0, 0], 'N'), 0);
  assert.equal(dmsToDecimal([1, 2], 'N'), null);
  assert.equal(dmsToDecimal('nope', 'N'), null);
  assert.equal(dmsToDecimal([1, 2, NaN], 'N'), null);
});

test('没有 EXIF 的 JPEG 不报错', () => {
  const result = parseExif(buildJpeg(100, 100));
  assert.equal(result.ok, true);
  assert.equal(result.found, false);
  assert.match(result.reason, /没有 EXIF/);
});

test('非 JPEG 输入安全返回', () => {
  const result = parseExif(buildPng(10, 10));
  assert.equal(result.ok, true);
  assert.equal(result.found, false);
  assert.equal(findExifBlock(buildPng(10, 10)), null);
});

test('字节序标记异常时报错', () => {
  const bad = new Uint8Array([...ascii('XX'), 42, 0, 8, 0, 0, 0, 0]);
  const jpeg = new Uint8Array([
    0xff, 0xd8, 0xff, 0xe1, ...be16(bad.length + 8), ...ascii('Exif\0\0'), ...bad,
    ...buildJpeg(10, 10).subarray(2)
  ]);
  const result = parseExif(jpeg);
  assert.equal(result.ok, false);
  assert.match(result.reason, /字节序标记异常/);
});

test('TIFF 魔数不是 42 时报错', () => {
  const bad = new Uint8Array([...ascii('II'), 43, 0, 8, 0, 0, 0, 0]);
  const jpeg = new Uint8Array([
    0xff, 0xd8, 0xff, 0xe1, ...be16(bad.length + 8), ...ascii('Exif\0\0'), ...bad,
    ...buildJpeg(10, 10).subarray(2)
  ]);
  const result = parseExif(jpeg);
  assert.equal(result.ok, false);
  assert.match(result.reason, /魔数不是 42/);
});

test('截断的 EXIF 不会崩溃', () => {
  const tiff = buildTiff({
    ifd0: [
      { tag: 0x010f, type: 2, value: 'A'.repeat(40) },
      { tag: 0x0110, type: 2, value: 'B'.repeat(40) }
    ]
  });
  const full = buildJpegWithExif(tiff);

  for (let length = 12; length < full.length; length += 7) {
    assert.doesNotThrow(() => parseExif(full.subarray(0, length)), `长度 ${length}`);
  }
});

test('IFD 偏移越界时安全返回', () => {
  const bad = new Uint8Array([...ascii('II'), 42, 0, 0xff, 0xff, 0xff, 0xff]);
  const jpeg = new Uint8Array([
    0xff, 0xd8, 0xff, 0xe1, ...be16(bad.length + 8), ...ascii('Exif\0\0'), ...bad,
    ...buildJpeg(10, 10).subarray(2)
  ]);
  const result = parseExif(jpeg);
  assert.equal(result.ok, false);
  assert.match(result.reason, /IFD 偏移越界/);
});

/* ══════════════ 尺寸换算 ══════════════ */

test('按百分比缩放', () => {
  assert.deepEqual(
    { w: computeTargetSize(1000, 500, { mode: 'scale', scale: 50 }).width, h: computeTargetSize(1000, 500, { mode: 'scale', scale: 50 }).height },
    { w: 500, h: 250 }
  );
  assert.equal(computeTargetSize(1000, 500, { mode: 'scale', scale: 200 }).width, 2000);
});

test('限制在范围内时保持宽高比', () => {
  const result = computeTargetSize(4000, 3000, { mode: 'fit', maxWidth: 1920, maxHeight: 1080 });
  assert.equal(result.height, 1080);
  assert.equal(result.width, 1440);
  assert.equal(result.aspectKept, true);
});

test('已经比上限小的时候不放大', () => {
  const result = computeTargetSize(400, 300, { mode: 'fit', maxWidth: 1920, maxHeight: 1080 });
  assert.equal(result.width, 400);
  assert.equal(result.height, 300);
  assert.equal(result.changed, false);
});

test('固定宽度时按比例算高度', () => {
  const result = computeTargetSize(1600, 900, { mode: 'width', targetWidth: 800 });
  assert.equal(result.width, 800);
  assert.equal(result.height, 450);
});

test('指定宽高会变形', () => {
  const result = computeTargetSize(1600, 900, { mode: 'exact', exactWidth: 500, exactHeight: 500 });
  assert.equal(result.width, 500);
  assert.equal(result.height, 500);
  assert.equal(result.aspectKept, false);
});

test('极端比例不会算出 0 或负数', () => {
  const result = computeTargetSize(10000, 1, { mode: 'width', targetWidth: 1 });
  assert.ok(result.height >= 1, String(result.height));
  assert.ok(result.width >= 1);

  const tiny = computeTargetSize(1, 1, { mode: 'scale', scale: 1 });
  assert.ok(tiny.width >= 1 && tiny.height >= 1);
});

test('尺寸被限制在合理上限内', () => {
  const result = computeTargetSize(100, 100, { mode: 'scale', scale: 1000 });
  assert.ok(result.width <= 16384);
});

test('非法的缩放比例有兜底', () => {
  assert.equal(computeTargetSize(100, 100, { mode: 'scale', scale: 'abc' }).width, 100);
  assert.equal(computeTargetSize(100, 100, { mode: 'scale', scale: 0 }).width, 1);
  assert.ok(RESIZE_MODES.length >= 4);
});

/* ══════════════ 色觉模拟 ══════════════ */

test('所有色觉矩阵都保持白色不变', () => {
  for (const [name, matrix] of Object.entries(COLOR_MATRICES)) {
    assert.equal(isWhitePreserving(matrix), true, name);
    const white = applyColorMatrix([255, 255, 255], matrix);
    assert.deepEqual(white, [255, 255, 255], `${name} 应把白色映射为白色`);
  }
});

test('所有色觉矩阵都保持黑色不变', () => {
  for (const [name, matrix] of Object.entries(COLOR_MATRICES)) {
    assert.deepEqual(applyColorMatrix([0, 0, 0], matrix), [0, 0, 0], name);
  }
});

test('全色盲把彩色压成灰度（三通道相等）', () => {
  for (const color of [[255, 0, 0], [0, 255, 0], [0, 0, 255], [12, 200, 90]]) {
    const [r, g, b] = simulateColorVision(color, 'achromatopsia');
    assert.equal(r, g, b, JSON.stringify(color));
  }
});

test('红色盲与绿色盲都让红绿变得接近', () => {
  for (const type of ['protanopia', 'deuteranopia']) {
    const red = simulateColorVision([255, 0, 0], type);
    const green = simulateColorVision([0, 255, 0], type);
    const distance = Math.abs(red[0] - green[0]) + Math.abs(red[1] - green[1]) + Math.abs(red[2] - green[2]);
    const original = 255 + 255;
    assert.ok(distance < original, `${type} 应缩小红绿差异，实际距离 ${distance}`);
  }
});

test('蓝色盲让蓝色与绿色变得接近', () => {
  const blue = simulateColorVision([0, 0, 255], 'tritanopia');
  const green = simulateColorVision([0, 255, 0], 'tritanopia');
  const distance = Math.abs(blue[0] - green[0]) + Math.abs(blue[1] - green[1]) + Math.abs(blue[2] - green[2]);
  assert.ok(distance < 510, `实际距离 ${distance}`);
});

test('正常视力不做变换', () => {
  assert.deepEqual(simulateColorVision([12, 34, 56], 'normal'), [12, 34, 56]);
});

test('结果被截断在 0-255', () => {
  const result = applyColorMatrix([255, 0, 0], COLOR_MATRICES.tritanopia);
  for (const channel of result) {
    assert.ok(channel >= 0 && channel <= 255, String(channel));
  }
});

test('非法输入报错', () => {
  assert.throws(() => applyColorMatrix([1, 2], COLOR_MATRICES.protanopia), /\[r, g, b\]/);
  assert.throws(() => applyColorMatrix([1, 2, 3], [1, 2, 3]), /9 个系数/);
  assert.throws(() => simulateColorVision([1, 2, 3], 'nope'), /未知的色觉类型/);
});

test('色觉类型定义完整', () => {
  assert.equal(COLOR_VISION_TYPES.length, 5);
  for (const type of COLOR_VISION_TYPES) {
    assert.ok(type.label && type.note);
    if (type.id !== 'normal') assert.ok(COLOR_MATRICES[type.id], type.id);
  }
});

/* ══════════════ Data URI 与命名 ══════════════ */

test('解析 Data URI', () => {
  const parsed = parseDataUri('data:image/png;base64,iVBORw0KGgo=');
  assert.equal(parsed.mime, 'image/png');
  assert.equal(parsed.base64, true);
  assert.equal(parsed.payload, 'iVBORw0KGgo=');

  assert.equal(parseDataUri('data:text/plain,hello').base64, false);
  assert.equal(parseDataUri('not a data uri'), null);
});

test('生成 Data URI', () => {
  assert.equal(toDataUri('AAAA', 'image/jpeg'), 'data:image/jpeg;base64,AAAA');
  assert.throws(() => toDataUri(''), /为空/);
});

test('normalizeImageInput 接受纯 Base64 与完整 Data URI', () => {
  const fromBase64 = normalizeImageInput('iVBORw0KGgo=');
  assert.equal(fromBase64.ok, true);
  assert.equal(fromBase64.dataUri, 'data:image/png;base64,iVBORw0KGgo=');

  const fromUri = normalizeImageInput('data:image/jpeg;base64,AAAA');
  assert.equal(fromUri.ok, true);
  assert.equal(fromUri.mime, 'image/jpeg');

  // 含空白的 Base64 会被清理
  assert.equal(normalizeImageInput('iVBO Rw0K Ggo=').ok, true);
});

test('normalizeImageInput 拒绝非法输入', () => {
  assert.match(normalizeImageInput('').error, /为空/);
  assert.match(normalizeImageInput('这不是 base64!').error, /既不是 Data URI/);
  assert.equal(normalizeImageInput('data:image/png;base64,AAAA', 'image/png').ok, true);
  assert.match(normalizeImageInput('data:image/svg+xml,<svg/>').error, /只支持 base64/);
});

test('生成文件名时替换扩展名', () => {
  assert.equal(suggestFilename('photo.png', 'image/jpeg'), 'photo.jpg');
  assert.equal(suggestFilename('photo.PNG', 'image/webp'), 'photo.webp');
  assert.equal(suggestFilename('no-extension', 'image/png'), 'no-extension.png');
  assert.equal(suggestFilename('', 'image/png'), 'image.png');
  assert.equal(suggestFilename('a/b/c.jpg', 'image/png'), 'c.png');
});

test('文件名里的危险字符被替换', () => {
  assert.equal(suggestFilename('a<b>c:d.jpg', 'image/png'), 'a-b-c-d.png');
  assert.equal(suggestFilename('a'.repeat(200) + '.png', 'image/png').length <= 85, true);
});

test('压缩概览', () => {
  const info = describeConversion(1000, 250);
  assert.equal(info.percent, 75);
  assert.equal(info.savedBytes, 750);
  assert.equal(info.expanded, false);

  const bigger = describeConversion(100, 200);
  assert.equal(bigger.expanded, true);
  assert.ok(bigger.percent < 0);

  assert.equal(describeConversion(0, 0).percent, 0);
});

test('字节数格式化', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(2048), '2.0 KB');
  assert.equal(formatBytes(5 * 1024 * 1024), '5.00 MB');
});

test('JPEG 透明提示', () => {
  assert.match(hasAlphaNotice('image/jpeg'), /不支持透明/);
  assert.equal(hasAlphaNotice('image/png'), '');
});
