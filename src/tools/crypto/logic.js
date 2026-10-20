/* 加密与摘要 —— 纯逻辑层，全部基于浏览器原生 WebCrypto，无第三方库。
 *
 * 覆盖：
 *   HMAC 签名（SHA-1 / 256 / 384 / 512）
 *   AES-GCM 加解密（认证加密，篡改会被检出）
 *   PBKDF2 口令派生密钥
 *   随机密钥 / 随机 IV 生成
 *
 * 关于 AES-GCM 的一个关键细节：WebCrypto 会把 16 字节认证标签**拼在密文末尾**，
 * 而多数语言（Java / Go / Python）的习惯是把标签单独存放。这里提供
 * splitGcmTag / joinGcmTag 做两种表示之间的转换，界面也会分别展示。
 */

import {
  textToBytes,
  bytesToText,
  bytesToHex,
  hexToBytes,
  bytesToBase64,
  base64ToBytes,
  concatBytes,
  randomBytes,
  timingSafeEqual,
  parseKeyInput
} from '../../core/bytes.js';
import { SHA_ALGORITHMS, digestHex, hmacBytes, hmacHex, hmacBase64 } from '../../core/hash.js';

export { SHA_ALGORITHMS, digestHex, hmacBytes, hmacHex, hmacBase64 };
export {
  textToBytes,
  bytesToText,
  bytesToHex,
  hexToBytes,
  bytesToBase64,
  base64ToBytes,
  parseKeyInput
};

export const GCM_IV_BYTES = 12;
export const GCM_TAG_BYTES = 16;
export const AES_KEY_SIZES = [16, 24, 32];

export const HMAC_ALGORITHMS = SHA_ALGORITHMS;
export const KEY_FORMATS = [
  { id: 'text', label: '文本' },
  { id: 'hex', label: '十六进制' },
  { id: 'base64', label: 'Base64' }
];
export const OUTPUT_FORMATS = [
  { id: 'hex', label: '十六进制' },
  { id: 'base64', label: 'Base64' }
];

/* ── 校验 ─────────────────────────────────────────────────── */

export function validateAesKey(keyBytes) {
  if (!(keyBytes instanceof Uint8Array)) throw new Error('密钥格式不正确');
  if (!AES_KEY_SIZES.includes(keyBytes.length)) {
    throw new Error(`AES 密钥必须是 ${AES_KEY_SIZES.join(' / ')} 字节，当前是 ${keyBytes.length} 字节`);
  }
  return keyBytes;
}

/** 生成一个符合 AES 要求的随机密钥。 */
export function generateAesKey(size = 32) {
  if (!AES_KEY_SIZES.includes(size)) {
    throw new Error(`密钥长度只能是 ${AES_KEY_SIZES.join(' / ')} 字节`);
  }
  return randomBytes(size);
}

/** GCM 推荐 12 字节 IV；这里也允许其他长度，但会提示。 */
export function generateIv(size = GCM_IV_BYTES) {
  if (!Number.isInteger(size) || size < 1 || size > 64) {
    throw new Error('IV 长度需要在 1-64 字节之间');
  }
  return randomBytes(size);
}

export function validateIv(ivBytes) {
  if (!(ivBytes instanceof Uint8Array)) throw new Error('IV 格式不正确');
  if (ivBytes.length === 0) throw new Error('IV 不能为空');
  if (ivBytes.length > 64) throw new Error('IV 过长（GCM 通常用 12 字节）');
  return ivBytes;
}

/* ── AES-GCM ──────────────────────────────────────────────── */

async function importAesKey(keyBytes, usage) {
  return crypto.subtle.importKey('raw', validateAesKey(keyBytes), { name: 'AES-GCM' }, false, [usage]);
}

function gcmParams(ivBytes, additionalData) {
  const params = { name: 'AES-GCM', iv: validateIv(ivBytes) };
  if (additionalData && additionalData.length > 0) params.additionalData = additionalData;
  return params;
}

/**
 * 加密。返回的字节里**末尾 16 字节是认证标签**（WebCrypto 的约定）。
 * @returns {Promise<Uint8Array>}
 */
export async function aesGcmEncrypt({ plaintext, keyBytes, ivBytes, additionalData }) {
  if (!(plaintext instanceof Uint8Array)) throw new Error('明文格式不正确');
  const key = await importAesKey(keyBytes, 'encrypt');
  const result = await crypto.subtle.encrypt(gcmParams(ivBytes, additionalData), key, plaintext);
  return new Uint8Array(result);
}

/**
 * 解密。认证失败（密钥错、IV 错、密文被改）会抛出可读错误，而不是返回乱码。
 * @returns {Promise<Uint8Array>}
 */
export async function aesGcmDecrypt({ ciphertext, keyBytes, ivBytes, additionalData }) {
  if (!(ciphertext instanceof Uint8Array)) throw new Error('密文格式不正确');
  if (ciphertext.length < GCM_TAG_BYTES) {
    // 注意用 < 而不是 <=：空明文加密后正好只剩 16 字节标签，那是合法密文
    throw new Error(`密文长度不足，至少要包含 ${GCM_TAG_BYTES} 字节认证标签`);
  }
  const key = await importAesKey(keyBytes, 'decrypt');
  try {
    const result = await crypto.subtle.decrypt(gcmParams(ivBytes, additionalData), key, ciphertext);
    return new Uint8Array(result);
  } catch {
    throw new Error('解密失败：密钥、IV 或附加数据不匹配，或密文已被篡改');
  }
}

/** 把 WebCrypto 的「密文‖标签」拆成两段。 */
export function splitGcmTag(combined) {
  if (!(combined instanceof Uint8Array)) throw new Error('密文格式不正确');
  if (combined.length < GCM_TAG_BYTES) {
    throw new Error(`密文至少要有 ${GCM_TAG_BYTES} 字节认证标签`);
  }
  return {
    ciphertext: combined.subarray(0, combined.length - GCM_TAG_BYTES),
    tag: combined.subarray(combined.length - GCM_TAG_BYTES)
  };
}

/** 把分开存放的密文与标签合回 WebCrypto 需要的格式。 */
export function joinGcmTag(ciphertext, tag) {
  if (!(ciphertext instanceof Uint8Array) || !(tag instanceof Uint8Array)) {
    throw new Error('密文与标签都需要是字节');
  }
  if (tag.length !== GCM_TAG_BYTES) {
    throw new Error(`认证标签必须是 ${GCM_TAG_BYTES} 字节，当前是 ${tag.length} 字节`);
  }
  return concatBytes(ciphertext, tag);
}

/* ── PBKDF2 ───────────────────────────────────────────────── */

export const PBKDF2_ITERATIONS = [
  { value: 10000, label: '10 000（快，仅演示）' },
  { value: 100000, label: '100 000（常用）' },
  { value: 210000, label: '210 000（OWASP 2023 建议）' },
  { value: 600000, label: '600 000（更稳但更慢）' }
];

/**
 * 口令派生密钥。
 * @returns {Promise<Uint8Array>}
 */
export async function pbkdf2({ password, salt, iterations = 210000, hash = 'SHA-256', length = 32 }) {
  if (!SHA_ALGORITHMS.includes(hash)) throw new Error(`不支持的哈希：${hash}`);
  if (!Number.isInteger(iterations) || iterations < 1) throw new Error('迭代次数必须是正整数');
  if (!Number.isInteger(length) || length < 1 || length > 128) throw new Error('派生长度需要在 1-128 字节之间');

  const saltBytes = salt instanceof Uint8Array ? salt : textToBytes(salt);
  if (saltBytes.length === 0) throw new Error('盐不能为空（建议至少 16 字节随机值）');

  const baseKey = await crypto.subtle.importKey(
    'raw',
    textToBytes(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations, hash },
    baseKey,
    length * 8
  );
  return new Uint8Array(bits);
}

/* ── 输出格式化 ───────────────────────────────────────────── */

export function formatBytes(bytes, format = 'hex', { group = 0 } = {}) {
  if (format === 'base64') return bytesToBase64(bytes);
  const hex = bytesToHex(bytes);
  if (group > 0) {
    const parts = [];
    for (let i = 0; i < hex.length; i += group) parts.push(hex.slice(i, i + group));
    return parts.join(' ');
  }
  return hex;
}

/** 校验一个 HMAC 是否与期望值一致（常量时间比较）。 */
export async function verifyHmac(algorithm, key, message, expected) {
  const actual = await hmacBytes(algorithm, key, message);
  let expectedBytes;
  try {
    expectedBytes = parseKeyInput(expected, /^[0-9a-fA-F\s]+$/.test(expected) ? 'hex' : 'base64');
  } catch {
    return { ok: false, error: '期望值既不是十六进制也不是 Base64' };
  }
  if (expectedBytes.length !== actual.length) {
    return { ok: false, error: `长度不匹配：期望 ${expectedBytes.length} 字节，实际 ${actual.length} 字节` };
  }
  return { ok: timingSafeEqual(actual, expectedBytes), actual };
}

/** 给界面用的密文概览。 */
export function describeCiphertext(combined) {
  const { ciphertext, tag } = splitGcmTag(combined);
  return {
    total: combined.length,
    ciphertextLength: ciphertext.length,
    tagLength: tag.length,
    ciphertextHex: bytesToHex(ciphertext),
    tagHex: bytesToHex(tag),
    ciphertextBase64: bytesToBase64(ciphertext),
    tagBase64: bytesToBase64(tag)
  };
}
