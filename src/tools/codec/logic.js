/* 编解码 / 哈希 —— 纯逻辑层，不依赖 DOM。
   所有函数都正确处理 UTF-8，避免中文出现乱码。 */

import { digestHex } from '../../core/hash.js';
import { md5Bytes, crc32Bytes } from '../../core/digest.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: false });

function bytesToBinaryString(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return binary;
}

/* ── Base64 ───────────────────────────────────────────────── */

export function normalizeBase64(input) {
  const cleaned = String(input).replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const remainder = cleaned.length % 4;
  if (remainder === 1) throw new Error('Base64 长度非法');
  return remainder ? cleaned + '='.repeat(4 - remainder) : cleaned;
}

export function base64Encode(text) {
  return btoa(bytesToBinaryString(encoder.encode(String(text))));
}

export function base64Decode(input) {
  // 长度类错误在 try 之外抛出，以保留更精确的提示
  const normalized = normalizeBase64(input);
  let binary;
  try {
    binary = atob(normalized);
  } catch {
    throw new Error('不是合法的 Base64 字符串');
  }
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  return decoder.decode(bytes);
}

export function toBase64Url(base64) {
  return String(base64).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(base64url) {
  return normalizeBase64(String(base64url).replace(/-/g, '+').replace(/_/g, '/'));
}

/* ── URL ──────────────────────────────────────────────────── */

export function encodeUrlComponent(text) {
  return encodeURIComponent(String(text));
}

export function decodeUrlComponent(text) {
  try {
    return decodeURIComponent(String(text));
  } catch {
    throw new Error('存在非法的百分号转义序列');
  }
}

export function encodeUrl(text) {
  return encodeURI(String(text));
}

export function decodeUrl(text) {
  try {
    return decodeURI(String(text));
  } catch {
    throw new Error('存在非法的百分号转义序列');
  }
}

/** 解析查询串为键值对，重复键保留为数组。 */
export function parseQueryString(input) {
  const text = String(input).replace(/^\?/, '');
  const out = [];
  if (!text) return out;
  for (const pair of text.split('&')) {
    if (!pair) continue;
    const index = pair.indexOf('=');
    const rawKey = index < 0 ? pair : pair.slice(0, index);
    const rawValue = index < 0 ? '' : pair.slice(index + 1);
    out.push({ key: decodeUrlComponent(rawKey.replace(/\+/g, ' ')), value: decodeUrlComponent(rawValue.replace(/\+/g, ' ')) });
  }
  return out;
}

/* ── HTML 实体 ────────────────────────────────────────────── */

const HTML_ENCODE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

const HTML_NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
  copy: '©', reg: '®', trade: '™', hellip: '…', mdash: '—', ndash: '–',
  laquo: '«', raquo: '»', times: '×', divide: '÷', euro: '€', pound: '£',
  yen: '¥', cent: '¢', sect: '§', deg: '°', plusmn: '±', micro: 'µ',
  middot: '·', bull: '•', dagger: '†', larr: '←', rarr: '→', harr: '↔'
};

export function encodeHtmlEntities(text) {
  return String(text).replace(/[&<>"']/g, (ch) => HTML_ENCODE[ch]);
}

export function decodeHtmlEntities(text) {
  return String(text).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, entity) => {
    if (entity[0] === '#') {
      const isHex = entity[1] === 'x' || entity[1] === 'X';
      const code = isHex ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    const named = HTML_NAMED[entity.toLowerCase()];
    return named === undefined ? match : named;
  });
}

/* ── 进制文本转换 ─────────────────────────────────────────── */

export function textToHex(text, { upper = false, separator = ' ' } = {}) {
  const hex = [...encoder.encode(String(text))].map((byte) => byte.toString(16).padStart(2, '0'));
  const joined = hex.join(separator);
  return upper ? joined.toUpperCase() : joined;
}

export function hexToText(input) {
  const cleaned = String(input).replace(/0x/gi, '').replace(/[\s,]+/g, '');
  if (cleaned.length % 2 !== 0) throw new Error('十六进制长度必须是偶数');
  if (!/^[0-9a-fA-F]*$/.test(cleaned)) throw new Error('包含非十六进制字符');
  const bytes = new Uint8Array(cleaned.length / 2);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = Number.parseInt(cleaned.slice(i * 2, i * 2 + 2), 16);
  return decoder.decode(bytes);
}

export function textToBinary(text, separator = ' ') {
  return [...encoder.encode(String(text))].map((byte) => byte.toString(2).padStart(8, '0')).join(separator);
}

export function binaryToText(input) {
  const cleaned = String(input).replace(/[\s,]+/g, '');
  if (!/^[01]*$/.test(cleaned)) throw new Error('包含非二进制字符');
  if (cleaned.length % 8 !== 0) throw new Error('二进制长度必须是 8 的倍数');
  const bytes = new Uint8Array(cleaned.length / 8);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = Number.parseInt(cleaned.slice(i * 8, i * 8 + 8), 2);
  return decoder.decode(bytes);
}

/* ── Base32 ───────────────────────────────────────────────── */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(text) {
  const bytes = encoder.encode(String(text));
  let buffer = 0;
  let bits = 0;
  let out = '';
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(buffer << (5 - bits)) & 31];
  return out.padEnd(Math.ceil(out.length / 8) * 8, '=');
}

export function base32Decode(input) {
  const cleaned = String(input).replace(/[\s-]+/g, '').replace(/=+$/, '').toUpperCase();
  const remainder = cleaned.length % 8;
  // RFC 4648 只允许这几种余数，其余长度必然是截断或串了内容
  if (remainder === 1 || remainder === 3 || remainder === 6) throw new Error('Base32 长度非法');
  if (!/^[A-Z2-7]*$/.test(cleaned)) throw new Error('不是合法的 Base32 字符串');

  let buffer = 0;
  let bits = 0;
  const bytes = [];
  for (const ch of cleaned) {
    buffer = (buffer << 5) | BASE32_ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      bytes.push((buffer >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return decoder.decode(Uint8Array.from(bytes));
}

/* ── 转义与字节码 ─────────────────────────────────────────── */

export function unicodeEscape(text) {
  let out = '';
  for (const ch of String(text)) {
    const code = ch.codePointAt(0);
    if (code > 0xffff) {
      // 星芒面字符必须写成代理对，才能被 JS / Java 的 \u 解析器原样读回
      const offset = code - 0x10000;
      const high = 0xd800 + (offset >> 10);
      const low = 0xdc00 + (offset & 0x3ff);
      out += `\\u${high.toString(16).padStart(4, '0')}\\u${low.toString(16).padStart(4, '0')}`;
    } else {
      out += `\\u${code.toString(16).padStart(4, '0')}`;
    }
  }
  return out;
}

export function unicodeUnescape(input) {
  /* 认三种写法：\uXXXX、\u{XXXXX}、\xXX。
     认不出来的一律原样保留，不猜；相邻的两个代理对会自然拼回一个字符。 */
  return String(input).replace(
    /\\u\{([0-9a-fA-F]{1,6})\}|\\u([0-9a-fA-F]{4})|\\x([0-9a-fA-F]{2})/g,
    (match, braced, quad, single) => {
      const raw = braced !== undefined ? braced : quad !== undefined ? quad : single;
      const code = Number.parseInt(raw, 16);
      if (!Number.isFinite(code) || code > 0x10ffff) return match;
      return String.fromCodePoint(code);
    }
  );
}

export function textToAsciiCodes(text, separator = ' ') {
  return [...encoder.encode(String(text))].map((byte) => String(byte)).join(separator);
}

export function asciiCodesToText(input) {
  const parts = String(input).split(/[\s,]+/).filter(Boolean);
  const bytes = parts.map((part) => {
    if (!/^\d{1,3}$/.test(part)) throw new Error(`「${part}」不是合法的十进制字节`);
    const value = Number(part);
    if (value > 255) throw new Error(`字节值 ${value} 超出 0–255`);
    return value;
  });
  return decoder.decode(Uint8Array.from(bytes));
}

/* ── 哈希 ─────────────────────────────────────────────────── */

/* 摘要实现已提取到 src/core/hash.js（加密工具与动态口令也在用）。
   这里保持原有函数签名，避免改动调用方与测试。 */
export { SHA_ALGORITHMS } from '../../core/hash.js';

/** 基于 WebCrypto 的摘要，返回小写十六进制。 */
export async function sha(algo, text) {
  return digestHex(algo, text);
}

/** MD5（实现见 core/digest.js，文件工具也复用同一份字节级实现）。 */
export function md5(text) {
  return md5Bytes(String(text));
}

/** CRC32（实现见 core/digest.js）。 */
export function crc32(text) {
  return crc32Bytes(String(text));
}

/* ── JWT ──────────────────────────────────────────────────── */

export function decodeJwt(token) {
  const parts = String(token).trim().split('.');
  if (parts.length < 2) return { ok: false, error: 'JWT 至少需要 header.payload 两段' };

  try {
    const header = JSON.parse(base64Decode(fromBase64Url(parts[0])));
    const payload = JSON.parse(base64Decode(fromBase64Url(parts[1])));
    const result = { ok: true, header, payload, signature: parts[2] || '', signed: parts.length === 3 };

    if (typeof payload.exp === 'number') {
      result.expiresAt = new Date(payload.exp * 1000);
      result.expired = Date.now() >= payload.exp * 1000;
    }
    if (typeof payload.iat === 'number') result.issuedAt = new Date(payload.iat * 1000);
    if (typeof payload.nbf === 'number') result.notBefore = new Date(payload.nbf * 1000);
    return result;
  } catch (error) {
    return { ok: false, error: `解析失败：${error.message}` };
  }
}

export function secondsUntilExpiry(payload, now = Date.now()) {
  if (!payload || typeof payload.exp !== 'number') return null;
  return Math.floor(payload.exp - now / 1000);
}

/* ── 命名风格（实现已提取到共享模块，此处转出以保持对外接口稳定） ── */

export {
  splitWords,
  toSnakeCase,
  toKebabCase,
  toCamelCase,
  toPascalCase,
  toConstantCase
} from '../../core/textcase.js';
