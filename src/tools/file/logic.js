/* 文件哈希与编码 —— 纯逻辑层，不依赖 DOM。
   哈希既包含 WebCrypto 的 SHA 系列，也包含自实现的 MD5 / CRC32。
   所有函数都接受 Uint8Array，浏览器与 Node 测试共用。 */

import { digestHex, SHA_ALGORITHMS } from '../../core/hash.js';
import { md5Bytes, crc32Bytes } from '../../core/digest.js';
import { bytesToBase64, bytesToHex } from '../../core/bytes.js';

/** 文本化输出的体积上限：超过后只算哈希，不把整份内容塞进页面。 */
export const MAX_TEXT_BYTES = 8 * 1024 * 1024;
/** 哈希本身也会整块读入内存，超过这个体积给出明确提示。 */
export const MAX_HASH_BYTES = 256 * 1024 * 1024;

export const HASH_ALGORITHMS = ['MD5', 'CRC32', 'SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'];

const MIME_PATTERN = /^[\w.+-]+\/[\w.+-]+$/;

/** 文件类型只接受标准 MIME；空值、带参数的串都退回通用二进制类型。 */
export function safeMime(value, fallback = 'application/octet-stream') {
  const mime = String(value || '').trim().toLowerCase();
  return MIME_PATTERN.test(mime) ? mime : fallback;
}

export function describeFile(file = {}) {
  return {
    name: String(file.name || '未命名文件'),
    size: Math.max(0, Number(file.size) || 0),
    mime: safeMime(file.type),
    modified: Number(file.lastModified) > 0 ? Number(file.lastModified) : null
  };
}

/** 依次算出全部摘要，返回 [{algorithm, value}]，顺序与 HASH_ALGORITHMS 一致。 */
export async function hashFile(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const results = [
    { algorithm: 'MD5', value: md5Bytes(data) },
    { algorithm: 'CRC32', value: crc32Bytes(data) }
  ];
  for (const algorithm of SHA_ALGORITHMS) {
    results.push({ algorithm, value: await digestHex(algorithm, data) });
  }
  return results;
}

export function encodeBase64(bytes) {
  return bytesToBase64(bytes);
}

export function encodeHex(bytes) {
  return bytesToHex(bytes);
}

/** 生成可直接放进 href / src 的 Data URI。 */
export function encodeDataUri(bytes, mime) {
  return `data:${safeMime(mime)};base64,${bytesToBase64(bytes)}`;
}

/** Base64 文本的理论长度（4 字节一组，含填充）。 */
export function base64Length(byteLength) {
  const length = Math.max(0, Number(byteLength) || 0);
  return Math.ceil(length / 3) * 4;
}

export function exceedsTextLimit(byteLength, limit = MAX_TEXT_BYTES) {
  return (Number(byteLength) || 0) > limit;
}

export function exceedsHashLimit(byteLength, limit = MAX_HASH_BYTES) {
  return (Number(byteLength) || 0) > limit;
}
