/* 动态口令（HOTP / TOTP）—— 纯逻辑层。
 *
 * 按 RFC 4226（HOTP）与 RFC 6238（TOTP）实现，支持 SHA-1 / SHA-256 / SHA-512。
 * 全部在本地计算：**不要把 2FA 密钥粘到在线网站上**，这正是本工具存在的意义。
 *
 * 密钥支持三种输入格式：Base32（otpauth 链接里的标准格式）、十六进制、纯文本。
 */

import { textToBytes, hexToBytes, bytesToHex } from '../../core/bytes.js';
import { hmacBytes } from '../../core/hash.js';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export const SECRET_FORMATS = [
  { id: 'base32', label: 'Base32（otpauth 标准）' },
  { id: 'hex', label: '十六进制' },
  { id: 'text', label: '纯文本' }
];

export const OTP_ALGORITHMS = ['SHA-1', 'SHA-256', 'SHA-512'];
export const DIGIT_OPTIONS = [6, 7, 8];
export const PERIOD_OPTIONS = [15, 30, 60];

/* ── Base32（RFC 4648，无填充） ───────────────────────────── */

export function base32Decode(text) {
  const cleaned = String(text ?? '').toUpperCase().replace(/[\s=_-]+/g, '');
  if (cleaned === '') return new Uint8Array(0);

  const out = [];
  let buffer = 0;
  let bits = 0;

  for (const char of cleaned) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) throw new Error(`「${char}」不是合法的 Base32 字符`);
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >>> bits) & 0xff);
    }
    // 只保留尚未消费的位，避免 buffer 无限增长
    buffer &= (1 << bits) - 1;
  }

  return new Uint8Array(out);
}

export function base32Encode(bytes) {
  let buffer = 0;
  let bits = 0;
  let out = '';

  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += BASE32_ALPHABET[(buffer >>> bits) & 31];
    }
    buffer &= (1 << bits) - 1;
  }

  if (bits > 0) out += BASE32_ALPHABET[(buffer << (5 - bits)) & 31];
  return out;
}

/** 把 Secret 输入解析成字节。 */
export function parseSecret(secret, format = 'base32') {
  if (secret instanceof Uint8Array) return secret;
  const text = String(secret ?? '').trim();
  if (text === '') throw new Error('密钥不能为空');

  if (format === 'hex') return hexToBytes(text);
  if (format === 'text') return textToBytes(text);
  return base32Decode(text);
}

function assertAlgorithm(algorithm) {
  if (!OTP_ALGORITHMS.includes(algorithm)) {
    throw new Error(`不支持的算法：${algorithm}（可用：${OTP_ALGORITHMS.join('、')}）`);
  }
  return algorithm;
}

function assertDigits(digits) {
  if (!DIGIT_OPTIONS.includes(digits)) {
    throw new Error(`位数只能是 ${DIGIT_OPTIONS.join(' / ')}`);
  }
  return digits;
}

/* ── HOTP（RFC 4226） ─────────────────────────────────────── */

/** 把计数器写成 8 字节大端。 */
export function counterToBytes(counter) {
  const value = BigInt(counter);
  if (value < 0n) throw new Error('计数器不能为负');
  const bytes = new Uint8Array(8);
  let rest = value;
  for (let i = 7; i >= 0; i -= 1) {
    bytes[i] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  return bytes;
}

/**
 * 计算 HOTP。
 * @returns {Promise<string>} 补零后的口令
 */
export async function hotp({ secret, counter, digits = 6, algorithm = 'SHA-1', format = 'base32' }) {
  assertAlgorithm(algorithm);
  assertDigits(digits);

  const key = parseSecret(secret, format);
  if (key.length === 0) throw new Error('密钥不能为空');

  const hash = await hmacBytes(algorithm, key, counterToBytes(counter));

  // 动态截断：取最后一字节低 4 位作为偏移
  const offset = hash[hash.length - 1] & 0x0f;
  const binary =
    ((hash[offset] & 0x7f) << 24) |
    ((hash[offset + 1] & 0xff) << 16) |
    ((hash[offset + 2] & 0xff) << 8) |
    (hash[offset + 3] & 0xff);

  return String(binary % 10 ** digits).padStart(digits, '0');
}

/* ── TOTP（RFC 6238） ─────────────────────────────────────── */

export function totpCounter(timestamp, period = 30) {
  if (!Number.isFinite(period) || period <= 0) throw new Error('周期必须是正数秒');
  return Math.floor(timestamp / 1000 / period);
}

export function totpRemaining(timestamp, period = 30) {
  const seconds = timestamp / 1000;
  return period - (seconds % period);
}

/**
 * 计算 TOTP。timestamp 用毫秒。
 * @returns {Promise<string>}
 */
export async function totp({
  secret,
  timestamp = Date.now(),
  period = 30,
  digits = 6,
  algorithm = 'SHA-1',
  format = 'base32'
}) {
  return hotp({ secret, counter: totpCounter(timestamp, period), digits, algorithm, format });
}

/**
 * 校验一个口令，允许前后偏移若干个周期（应对时钟偏差）。
 * @returns {Promise<{ok:boolean, offset:number|null}>}
 */
export async function verifyTotp({
  secret,
  token,
  timestamp = Date.now(),
  period = 30,
  digits = 6,
  algorithm = 'SHA-1',
  format = 'base32',
  window = 1
}) {
  const target = String(token ?? '').trim();
  const expectedLength = digits;
  if (!/^\d+$/.test(target) || target.length !== expectedLength) {
    return { ok: false, offset: null, error: `口令应该是 ${expectedLength} 位数字` };
  }

  const current = totpCounter(timestamp, period);
  for (let offset = -window; offset <= window; offset += 1) {
    const candidate = await hotp({
      secret,
      counter: current + offset,
      digits,
      algorithm,
      format
    });
    if (candidate === target) return { ok: true, offset };
  }

  return { ok: false, offset: null };
}

/* ── otpauth:// 链接 ──────────────────────────────────────── */

const ALGORITHM_FROM_URI = { SHA1: 'SHA-1', SHA256: 'SHA-256', SHA512: 'SHA-512' };
const ALGORITHM_TO_URI = { 'SHA-1': 'SHA1', 'SHA-256': 'SHA256', 'SHA-512': 'SHA512' };

/**
 * 解析 otpauth:// 链接。
 * @returns {{type:string, label:string, account:string, issuer:string, secret:string, algorithm:string, digits:number, period:number, counter:number}}
 */
export function parseOtpAuthUri(uri) {
  const text = String(uri ?? '').trim();
  if (!/^otpauth:\/\//i.test(text)) throw new Error('不是 otpauth:// 链接');

  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error('链接格式不合法');
  }

  const type = url.host.toLowerCase();
  if (type !== 'totp' && type !== 'hotp') {
    throw new Error(`不支持的类型：${type}（只支持 totp 与 hotp）`);
  }

  const rawLabel = decodeURIComponent(url.pathname.replace(/^\//, ''));
  const secret = (url.searchParams.get('secret') || '').replace(/\s+/g, '');
  if (!secret) throw new Error('链接里没有 secret 参数');

  const [labelIssuer, ...rest] = rawLabel.split(':');
  const account = (rest.length ? rest.join(':') : rawLabel).trim();
  const issuer = (url.searchParams.get('issuer') || (rest.length ? labelIssuer : '')).trim();

  const algorithmKey = (url.searchParams.get('algorithm') || 'SHA1').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const algorithm = ALGORITHM_FROM_URI[algorithmKey];
  if (!algorithm) throw new Error(`不支持的算法：${algorithmKey}`);

  const digits = Number(url.searchParams.get('digits') || 6);
  if (!DIGIT_OPTIONS.includes(digits)) throw new Error(`不支持的位数：${digits}`);

  const period = Number(url.searchParams.get('period') || 30);
  const counter = Number(url.searchParams.get('counter') || 0);

  // 提前校验密钥能否解析，避免把错误留到计算时才暴露
  base32Decode(secret);

  return { type, label: rawLabel, account, issuer, secret, algorithm, digits, period, counter };
}

export function buildOtpAuthUri({
  type = 'totp',
  account = '',
  issuer = '',
  secret,
  algorithm = 'SHA-1',
  digits = 6,
  period = 30,
  counter = 0
}) {
  if (!secret) throw new Error('缺少 secret');
  if (type !== 'totp' && type !== 'hotp') throw new Error(`不支持的类型：${type}`);

  const label = issuer ? `${issuer}:${account}` : account;
  // 标签里的冒号要保留，其余部分按 URL 规则编码
  const encodedLabel = label.split(':').map(encodeURIComponent).join(':');

  const params = new URLSearchParams();
  params.set('secret', String(secret).toUpperCase().replace(/\s+/g, ''));
  if (issuer) params.set('issuer', issuer);
  params.set('algorithm', ALGORITHM_TO_URI[algorithm] || 'SHA1');
  params.set('digits', String(digits));
  if (type === 'totp') params.set('period', String(period));
  else params.set('counter', String(counter));

  return `otpauth://${type}/${encodedLabel}?${params.toString()}`;
}

/* ── 界面辅助 ─────────────────────────────────────────────── */

/** 把密钥从一种格式转成另一种，方便用户在 Base32 / 十六进制之间切换。 */
export function convertSecret(secret, fromFormat, toFormat) {
  const bytes = parseSecret(secret, fromFormat);
  if (toFormat === 'base32') return base32Encode(bytes);
  if (toFormat === 'hex') return bytesToHex(bytes);
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

export function describeSecret(secret, format = 'base32') {
  const bytes = parseSecret(secret, format);
  return {
    bytes: bytes.length,
    bits: bytes.length * 8,
    base32: base32Encode(bytes),
    hex: bytesToHex(bytes),
    strength: bytes.length >= 20 ? '足够（≥160 位）' : bytes.length >= 10 ? '偏短' : '过短'
  };
}
