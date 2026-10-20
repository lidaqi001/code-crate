import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_TEXT_BYTES,
  HASH_ALGORITHMS,
  safeMime,
  describeFile,
  hashFile,
  encodeBase64,
  encodeHex,
  encodeDataUri,
  base64Length,
  exceedsTextLimit,
  exceedsHashLimit
} from '../src/tools/file/logic.js';
import { md5, crc32 } from '../src/tools/codec/logic.js';

const bytes = (text) => new TextEncoder().encode(text);

test('MD5 与 CRC32 支持字节输入', async () => {
  const [md5Entry, crcEntry] = await hashFile(bytes('abc'));
  assert.equal(md5Entry.value, '900150983cd24fb0d6963f7d28e17f72');
  assert.equal(crcEntry.value, '352441c2'); // crc32('abc')
});

test('MD5 空输入与 UTF-8 与文本实现一致', async () => {
  const [empty] = await hashFile(new Uint8Array());
  assert.equal(empty.value, 'd41d8cd98f00b204e9800998ecf8427e');
  const [zh] = await hashFile(bytes('中文'));
  assert.equal(zh.value, md5('中文'));
});

test('CRC32 标准向量', async () => {
  const entries = await hashFile(bytes('123456789'));
  assert.equal(entries[1].value, 'cbf43926');
  assert.equal(crc32('123456789'), 'cbf43926');
});

test('SHA 系列值正确且顺序稳定', async () => {
  const entries = await hashFile(bytes('abc'));
  assert.deepEqual(entries.map((entry) => entry.algorithm), HASH_ALGORITHMS);
  const sha256 = entries.find((entry) => entry.algorithm === 'SHA-256');
  assert.equal(sha256.value, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const sha1 = entries.find((entry) => entry.algorithm === 'SHA-1');
  assert.equal(sha1.value, 'a9993e364706816aba3e25717850c26c9cd0d89d');
});

test('二进制字节不会被当成 UTF-8 文本', async () => {
  const data = Uint8Array.from([0x00, 0xff, 0x80, 0x7f]);
  assert.equal(encodeBase64(data), 'AP+Afw==');
  assert.equal(encodeHex(data), '00ff807f');
});

test('Data URI 使用安全 MIME', () => {
  assert.equal(encodeDataUri(bytes('abc'), 'text/plain'), 'data:text/plain;base64,YWJj');
  assert.equal(
    encodeDataUri(bytes('abc'), 'text/plain; charset=utf-8'),
    'data:application/octet-stream;base64,YWJj'
  );
  assert.equal(safeMime('image/png'), 'image/png');
  assert.equal(safeMime(''), 'application/octet-stream');
  assert.equal(safeMime('javascript:alert(1)'), 'application/octet-stream');
});

test('文件描述兜底', () => {
  assert.deepEqual(describeFile({ name: 'a.txt', size: '12', type: 'text/plain', lastModified: 0 }), {
    name: 'a.txt',
    size: 12,
    mime: 'text/plain',
    modified: null
  });
  assert.equal(describeFile({}).name, '未命名文件');
  assert.equal(describeFile({}).mime, 'application/octet-stream');
});

test('体积上限判断', () => {
  assert.equal(base64Length(0), 0);
  assert.equal(base64Length(1), 4);
  assert.equal(base64Length(3), 4);
  assert.equal(base64Length(4), 8);
  assert.equal(exceedsTextLimit(MAX_TEXT_BYTES), false);
  assert.equal(exceedsTextLimit(MAX_TEXT_BYTES + 1), true);
  assert.equal(exceedsHashLimit(MAX_TEXT_BYTES), false);
});
