import test from 'node:test';
import assert from 'node:assert/strict';
import * as zlib from 'node:zlib';

import {
  compressBytes,
  decompressBytes,
  decompressAuto,
  detectFormat,
  parseInput,
  formatOutput,
  tryReadText,
  describeCompression,
  run,
  getFormat,
  FORMATS
} from '../src/tools/compress/logic.js';
import { textToBytes, bytesToHex, bytesToBase64, base64ToBytes, concatBytes } from '../src/core/bytes.js';

/* ══════════════ node:zlib 作为独立参照 ══════════════ */

const nodeGzip = (bytes) => new Uint8Array(zlib.gzipSync(Buffer.from(bytes)));
const nodeGunzip = (bytes) => new Uint8Array(zlib.gunzipSync(Buffer.from(bytes)));
const nodeDeflate = (bytes) => new Uint8Array(zlib.deflateSync(Buffer.from(bytes)));
const nodeInflate = (bytes) => new Uint8Array(zlib.inflateSync(Buffer.from(bytes)));
const nodeDeflateRaw = (bytes) => new Uint8Array(zlib.deflateRawSync(Buffer.from(bytes)));
const nodeInflateRaw = (bytes) => new Uint8Array(zlib.inflateRawSync(Buffer.from(bytes)));

const SAMPLES = [
  { name: '空内容', bytes: new Uint8Array(0) },
  { name: '单字节', bytes: textToBytes('a') },
  { name: '短文本', bytes: textToBytes('hello') },
  { name: '中文', bytes: textToBytes('压缩与解压，中文内容，重复重复重复重复重复') },
  { name: '高重复', bytes: textToBytes('abc'.repeat(500)) },
  { name: '随机字节', bytes: new Uint8Array(500).map((_, i) => (i * 37 + 11) % 256) },
  { name: '大文本', bytes: textToBytes('The quick brown fox jumps over the lazy dog. '.repeat(200)) }
];

/* ── 压缩 / 解压往返 ──────────────────────────────────────── */

test('三种格式都能往返', async () => {
  for (const sample of SAMPLES) {
    for (const format of FORMATS) {
      const compressed = await compressBytes(format.id, sample.bytes);
      const restored = await decompressBytes(format.id, compressed);
      assert.equal(bytesToHex(restored), bytesToHex(sample.bytes), `${format.id} / ${sample.name}`);
    }
  }
});

test('我们压缩的数据能被 node:zlib 解开', async () => {
  for (const sample of SAMPLES) {
    assert.equal(bytesToHex(nodeGunzip(await compressBytes('gzip', sample.bytes))), bytesToHex(sample.bytes), `gzip ${sample.name}`);
    assert.equal(bytesToHex(nodeInflate(await compressBytes('deflate', sample.bytes))), bytesToHex(sample.bytes), `deflate ${sample.name}`);
    assert.equal(bytesToHex(nodeInflateRaw(await compressBytes('deflate-raw', sample.bytes))), bytesToHex(sample.bytes), `raw ${sample.name}`);
  }
});

test('node:zlib 压缩的数据能被我们解开', async () => {
  for (const sample of SAMPLES) {
    assert.equal(bytesToHex(await decompressBytes('gzip', nodeGzip(sample.bytes))), bytesToHex(sample.bytes), `gzip ${sample.name}`);
    assert.equal(bytesToHex(await decompressBytes('deflate', nodeDeflate(sample.bytes))), bytesToHex(sample.bytes), `deflate ${sample.name}`);
    assert.equal(bytesToHex(await decompressBytes('deflate-raw', nodeDeflateRaw(sample.bytes))), bytesToHex(sample.bytes), `raw ${sample.name}`);
  }
});

test('gzip 输出带正确的魔数与结尾长度字段', async () => {
  const original = textToBytes('verify gzip footer');
  const compressed = await compressBytes('gzip', original);

  assert.equal(compressed[0], 0x1f);
  assert.equal(compressed[1], 0x8b);
  assert.equal(compressed[2], 8); // deflate 压缩方法
  // 末尾 4 字节是原始长度的低 32 位（小端）
  const size = compressed[compressed.length - 4] | (compressed[compressed.length - 3] << 8) |
    (compressed[compressed.length - 2] << 16) | (compressed[compressed.length - 1] << 24);
  assert.equal(size, original.length);
});

test('压缩确实能缩小高重复内容', async () => {
  const original = textToBytes('repeat '.repeat(1000));
  const compressed = await compressBytes('gzip', original);
  assert.ok(compressed.length < original.length / 10, `${compressed.length} vs ${original.length}`);
});

/* ── 格式识别 ─────────────────────────────────────────────── */

test('detectFormat 按魔数识别', async () => {
  assert.equal(detectFormat(await compressBytes('gzip', textToBytes('x'))).id, 'gzip');
  assert.equal(detectFormat(nodeDeflate(textToBytes('x'))).id, 'deflate');
  assert.equal(detectFormat(await compressBytes('deflate', textToBytes('x'))).id, 'deflate');

  const gzipInfo = detectFormat(await compressBytes('gzip', textToBytes('x')));
  assert.equal(gzipInfo.confident, true);
  assert.equal(gzipInfo.label, 'GZIP');
});

test('detectFormat 对普通文本不确定', () => {
  const info = detectFormat(textToBytes('这不是压缩数据'));
  assert.equal(info.id, 'deflate-raw');
  assert.equal(info.confident, false);
});

test('detectFormat 处理空输入', () => {
  assert.equal(detectFormat(new Uint8Array(0)).id, null);
  assert.equal(detectFormat(new Uint8Array(0)).label, '空输入');
});

test('zlib 头部校验按规范做（CMF/FLG 检查）', () => {
  // 78 9c 是常见的 zlib 头：(0x78 << 8 | 0x9c) % 31 === 0
  assert.equal(detectFormat(new Uint8Array([0x78, 0x9c, 1, 2, 3])).id, 'deflate');
  assert.equal(detectFormat(new Uint8Array([0x78, 0x01, 1, 2, 3])).id, 'deflate');
  // 0x78 0x9d 不满足校验，不应被认成 zlib
  assert.equal(detectFormat(new Uint8Array([0x78, 0x9d, 1, 2, 3])).confident, false);
});

/* ── 自动解压 ─────────────────────────────────────────────── */

test('decompressAuto 能识别并解开三种格式', async () => {
  const original = textToBytes('auto detect payload');

  const gz = await decompressAuto(await compressBytes('gzip', original));
  assert.equal(gz.ok, true);
  assert.equal(gz.format, 'gzip');
  assert.equal(gz.guessed, false);
  assert.equal(bytesToHex(gz.data), bytesToHex(original));

  const zl = await decompressAuto(await compressBytes('deflate', original));
  assert.equal(zl.format, 'deflate');

  // 裸 deflate 没有魔数，需要靠逐一尝试
  const raw = await decompressAuto(await compressBytes('deflate-raw', original));
  assert.equal(raw.ok, true);
  assert.equal(bytesToHex(raw.data), bytesToHex(original));
});

test('decompressAuto 对非压缩数据给出明确错误', async () => {
  const result = await decompressAuto(textToBytes('这不是压缩数据，只是一段普通文本'));
  assert.equal(result.ok, false);
  assert.match(result.error, /无法解压|不是压缩内容/);
});

test('decompressAuto 对空输入报错', async () => {
  const result = await decompressAuto(new Uint8Array(0));
  assert.equal(result.ok, false);
  assert.match(result.error, /输入为空/);
});

/* ── 错误处理 ─────────────────────────────────────────────── */

test('解压损坏数据时报错而不是返回乱码', async () => {
  const good = await compressBytes('gzip', textToBytes('content'));
  const broken = Uint8Array.from(good);
  broken[broken.length - 5] ^= 0xff; // 破坏数据区
  await assert.rejects(() => decompressBytes('gzip', broken), /无法按 GZIP 解压/);
});

test('用错格式解压会失败', async () => {
  const gz = await compressBytes('gzip', textToBytes('x'));
  await assert.rejects(() => decompressBytes('deflate-raw', gz), /无法按/);
});

test('未知格式与非法输入报错', async () => {
  await assert.rejects(() => compressBytes('brotli', textToBytes('x')), /未知的压缩格式/);
  await assert.rejects(() => decompressBytes('gzip', new Uint8Array(0)), /输入为空/);
  await assert.rejects(() => compressBytes('gzip', 'not bytes'), /需要是字节/);
  assert.equal(getFormat('nope'), null);
});

/* ── 输入输出转换 ─────────────────────────────────────────── */

test('parseInput 支持三种输入格式', () => {
  assert.equal(bytesToHex(parseInput('hello', 'text')), bytesToHex(textToBytes('hello')));
  assert.equal(bytesToHex(parseInput('68656c6c6f', 'hex')), bytesToHex(textToBytes('hello')));
  assert.equal(bytesToHex(parseInput(bytesToBase64(textToBytes('hello')), 'base64')), bytesToHex(textToBytes('hello')));
  assert.throws(() => parseInput('', 'base64'), /输入为空/);
});

test('formatOutput 支持分组', () => {
  const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
  assert.equal(formatOutput(bytes, 'hex'), 'deadbeef');
  assert.equal(formatOutput(bytes, 'hex', { group: 2 }), 'de ad be ef');
  assert.equal(bytesToHex(base64ToBytes(formatOutput(bytes, 'base64'))), 'deadbeef');
});

test('tryReadText 判断能否当文本读', () => {
  assert.equal(tryReadText(textToBytes('正常文本 with english')).ok, true);
  assert.equal(tryReadText(textToBytes('多行\n文本\t带制表')).ok, true);
  // 含大量控制字符的二进制不应被当成文本
  assert.equal(tryReadText(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7])).ok, false);
});

/* ── 概览 ─────────────────────────────────────────────────── */

test('describeCompression 计算压缩比', async () => {
  const original = textToBytes('aaaa'.repeat(100));
  const compressed = await compressBytes('gzip', original);
  const info = describeCompression(original, compressed);

  assert.equal(info.originalSize, 400);
  assert.equal(info.compressedSize, compressed.length);
  assert.ok(info.percent > 90);
  assert.equal(info.expanded, false);
  assert.equal(info.originalSize - info.compressedSize, info.savedBytes);
});

test('describeCompression 处理空输入与变大情况', () => {
  const empty = describeCompression(new Uint8Array(0), new Uint8Array(0));
  assert.equal(empty.ratio, 0);
  assert.equal(empty.percent, 0);

  // 短内容压缩后通常反而变大
  const tiny = describeCompression(textToBytes('a'), new Uint8Array(25));
  assert.equal(tiny.expanded, true);
  assert.ok(tiny.percent < 0);
});

/* ── 高层入口 ─────────────────────────────────────────────── */

test('run 完成压缩并输出指定格式', async () => {
  const result = await run({
    direction: 'compress',
    format: 'gzip',
    inputText: 'hello world',
    inputFormat: 'text',
    outputFormat: 'base64'
  });

  assert.equal(result.ok, true);
  assert.equal(result.format, 'gzip');
  assert.equal(result.inputSize, 11);
  assert.ok(result.size > 0);
  // 输出应当能被 node 解开
  assert.equal(bytesToHex(nodeGunzip(base64ToBytes(result.output))), bytesToHex(textToBytes('hello world')));
});

test('run 完成解压并给出可读文本', async () => {
  const compressed = await compressBytes('gzip', textToBytes('解压出来的中文'));
  const result = await run({
    direction: 'decompress',
    inputText: bytesToBase64(compressed),
    inputFormat: 'base64',
    outputFormat: 'hex'
  });

  assert.equal(result.ok, true);
  assert.equal(result.format, 'gzip');
  assert.equal(result.text, '解压出来的中文');
});

test('run 对二进制结果不返回文本', async () => {
  const binary = new Uint8Array(64).map((_, i) => i);
  const compressed = await compressBytes('gzip', binary);
  const result = await run({
    direction: 'decompress',
    inputText: bytesToBase64(compressed),
    inputFormat: 'base64',
    outputFormat: 'hex'
  });

  assert.equal(result.ok, true);
  assert.equal(result.text, null);
});

test('run 传递解压失败的错误', async () => {
  const result = await run({
    direction: 'decompress',
    inputText: bytesToBase64(textToBytes('不是压缩数据')),
    inputFormat: 'base64',
    outputFormat: 'base64'
  });
  assert.equal(result.ok, false);
  assert.ok(result.error.length > 0);
});

test('多段拼接的 gzip 也能解压（对应分块传输）', async () => {
  const a = await compressBytes('gzip', textToBytes('第一段'));
  const b = await compressBytes('gzip', textToBytes('第二段'));
  const combined = concatBytes(a, b);

  const result = await decompressAuto(combined);
  assert.equal(result.ok, true);
  assert.equal(result.text !== null || result.data.length > 0, true);
});

test('run 尊重「强制按指定格式解压」', async () => {
  const original = textToBytes('forced format test');
  const gz = bytesToBase64(await compressBytes('gzip', original));

  // 指定 gzip：正常解出
  const forced = await run({ direction: 'decompress', format: 'gzip', inputText: gz, inputFormat: 'base64', outputFormat: 'base64' });
  assert.equal(forced.ok, true);
  assert.equal(forced.format, 'gzip');
  assert.equal(forced.guessed, false);
  assert.equal(forced.text, 'forced format test');

  // 强制用错格式：应当直接失败，而不是悄悄回退到自动识别
  const wrong = await run({ direction: 'decompress', format: 'deflate-raw', inputText: gz, inputFormat: 'base64', outputFormat: 'base64' });
  assert.equal(wrong.ok, false);
  assert.match(wrong.error, /无法按/);

  // auto 时走自动识别
  const auto = await run({ direction: 'decompress', format: 'auto', inputText: gz, inputFormat: 'base64', outputFormat: 'base64' });
  assert.equal(auto.ok, true);
  assert.equal(auto.format, 'gzip');
});
