/* 摘要与 HMAC —— 基于 WebCrypto 的共享原语。
   被「编解码 / 哈希」「加密与摘要」「动态口令」三个工具共同使用。 */

import { textToBytes, bytesToHex, bytesToBase64 } from './bytes.js';

export const SHA_ALGORITHMS = ['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'];

export function assertAlgorithm(algorithm) {
  if (!SHA_ALGORITHMS.includes(algorithm)) {
    throw new Error(`不支持的算法：${algorithm}（可用：${SHA_ALGORITHMS.join('、')}）`);
  }
  return algorithm;
}

function toBytes(input) {
  if (input instanceof Uint8Array) return input;
  return textToBytes(input);
}

/** 摘要，返回小写十六进制。 */
export async function digestHex(algorithm, input) {
  assertAlgorithm(algorithm);
  const result = await crypto.subtle.digest(algorithm, toBytes(input));
  return bytesToHex(new Uint8Array(result));
}

/** 摘要，返回字节。 */
export async function digestBytes(algorithm, input) {
  assertAlgorithm(algorithm);
  const result = await crypto.subtle.digest(algorithm, toBytes(input));
  return new Uint8Array(result);
}

/** HMAC 签名，返回字节。密钥与消息都接受字符串或字节。 */
export async function hmacBytes(algorithm, key, message) {
  assertAlgorithm(algorithm);
  const keyBytes = toBytes(key);
  if (keyBytes.length === 0) throw new Error('HMAC 密钥不能为空');

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: algorithm },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, toBytes(message));
  return new Uint8Array(signature);
}

export async function hmacHex(algorithm, key, message) {
  return bytesToHex(await hmacBytes(algorithm, key, message));
}

export async function hmacBase64(algorithm, key, message, options = {}) {
  return bytesToBase64(await hmacBytes(algorithm, key, message), options);
}

/** 用 HMAC 做密钥派生（HKDF-Expand 的单块简化版），常用于把口令转成固定长度密钥。 */
export async function hkdfExpand(algorithm, key, info, length = 32) {
  const infoBytes = toBytes(info);
  const blocks = [];
  let previous = new Uint8Array(0);
  let counter = 1;

  while (blocks.reduce((sum, block) => sum + block.length, 0) < length) {
    if (counter > 255) throw new Error('派生长度过长');
    const input = new Uint8Array(previous.length + infoBytes.length + 1);
    input.set(previous, 0);
    input.set(infoBytes, previous.length);
    input[input.length - 1] = counter;
    previous = await hmacBytes(algorithm, key, input);
    blocks.push(previous);
    counter += 1;
  }

  const combined = new Uint8Array(blocks.reduce((sum, block) => sum + block.length, 0));
  let offset = 0;
  for (const block of blocks) {
    combined.set(block, offset);
    offset += block.length;
  }
  return combined.subarray(0, length);
}
