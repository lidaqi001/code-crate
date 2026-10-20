/* 字节与文本互转的共享工具。
   被「加密与摘要」和「动态口令」两个工具共同使用，避免同一段逻辑写多份。 */

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: false });

export function textToBytes(text) {
  return encoder.encode(String(text ?? ''));
}

export function bytesToText(bytes) {
  return decoder.decode(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
}

export function bytesToHex(bytes, { upper = false } = {}) {
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return upper ? hex.toUpperCase() : hex;
}

export function hexToBytes(text) {
  const cleaned = String(text ?? '').replace(/0x/gi, '').replace(/[\s:,_-]+/g, '');
  if (cleaned === '') return new Uint8Array(0);
  if (cleaned.length % 2 !== 0) throw new Error('十六进制长度必须是偶数');
  if (!/^[0-9a-fA-F]+$/.test(cleaned)) throw new Error('包含非十六进制字符');
  const bytes = new Uint8Array(cleaned.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(cleaned.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function bytesToBase64(bytes, { urlSafe = false } = {}) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  const base64 = btoa(binary);
  return urlSafe ? base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : base64;
}

export function base64ToBytes(text) {
  const source = String(text ?? '').trim();
  if (source === '') return new Uint8Array(0);
  const normalized = source.replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
  const remainder = normalized.length % 4;
  if (remainder === 1) throw new Error('Base64 长度非法');
  const padded = remainder ? normalized + '='.repeat(4 - remainder) : normalized;
  let binary;
  try {
    binary = atob(padded);
  } catch {
    throw new Error('不是合法的 Base64 字符串');
  }
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function concatBytes(...chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export function randomBytes(length) {
  const out = new Uint8Array(length);
  crypto.getRandomValues(out);
  return out;
}

/**
 * 常量时间比较：逐个字节异或累积，避免因为提前返回而泄露信息。
 * 长度不同直接返回 false（长度本身不是秘密）。
 */
export function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** 把用户的密钥输入按指定格式解析成字节。 */
export function parseKeyInput(text, format = 'text') {
  if (format === 'hex') return hexToBytes(text);
  if (format === 'base64') return base64ToBytes(text);
  return textToBytes(text);
}
