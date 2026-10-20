/* 密码与随机串 —— 纯逻辑层。
   随机数只来自 crypto.getRandomValues，并按拒绝采样消除取模偏差。 */

import { randomBytes, bytesToHex, bytesToBase64 } from '../../core/bytes.js';

export const CHARSET_IDS = ['lower', 'upper', 'digits', 'symbols'];

export const CHARSETS = {
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{};:,.?/'
};

export const AMBIGUOUS_CHARS = 'Il1O0o';
export const MIN_LENGTH = 4;
export const MAX_LENGTH = 128;
export const MAX_RANDOM_BYTES = 256;

export const PRESETS = [
  { id: 'strong', label: '强密码', length: 20, sets: { lower: true, upper: true, digits: true, symbols: true }, avoidAmbiguous: false },
  { id: 'pin', label: '数字 PIN', length: 6, sets: { lower: false, upper: false, digits: true, symbols: false }, avoidAmbiguous: false },
  { id: 'friendly', label: '易读', length: 16, sets: { lower: true, upper: true, digits: true, symbols: false }, avoidAmbiguous: true },
  { id: 'token', label: '接口令牌', length: 40, sets: { lower: true, upper: true, digits: true, symbols: false }, avoidAmbiguous: true }
];

function stripAmbiguous(chars) {
  return [...chars].filter((char) => !AMBIGUOUS_CHARS.includes(char)).join('');
}

/** 返回启用且非空的字符组；avoidAmbiguous 会先从每组里剔除易混字符。 */
export function activeGroups(options = {}) {
  const groups = [];
  for (const id of CHARSET_IDS) {
    if (options[id] === false) continue;
    let chars = CHARSETS[id];
    if (options.avoidAmbiguous) chars = stripAmbiguous(chars);
    if (chars) groups.push({ id, chars });
  }
  return groups;
}

export function poolOf(options = {}) {
  return activeGroups(options).map((group) => group.chars).join('');
}

/** 无偏随机整数：拒绝落在尾部不完整区间里的取值。 */
export function randomInt(max) {
  if (!Number.isInteger(max) || max <= 0) throw new Error('随机范围必须是正整数');
  const limit = Math.floor(0x100000000 / max) * max;
  const buffer = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buffer);
    if (buffer[0] < limit) return buffer[0] % max;
  }
}

export function clampLength(value) {
  const length = Math.trunc(Number(value));
  if (!Number.isFinite(length)) return 16;
  return Math.min(MAX_LENGTH, Math.max(MIN_LENGTH, length));
}

/**
 * 生成密码。
 * @param {object} options
 * @param {number} [options.length]
 * @param {boolean} [options.lower] 等四个字符组开关
 * @param {boolean} [options.avoidAmbiguous]
 * @param {boolean} [options.requireEach] 是否保证每组至少出现一次
 */
export function generatePassword(options = {}) {
  const groups = activeGroups(options);
  if (!groups.length) throw new Error('至少选择一种字符类型');

  const length = clampLength(options.length);
  const requireEach = options.requireEach !== false;
  if (requireEach && groups.length > length) {
    throw new Error(`长度不能小于所选字符类型数量（${groups.length}）`);
  }

  const chars = [];
  if (requireEach) {
    for (const group of groups) chars.push(group.chars[randomInt(group.chars.length)]);
  }

  const pool = groups.map((group) => group.chars).join('');
  while (chars.length < length) chars.push(pool[randomInt(pool.length)]);

  // Fisher–Yates 洗牌，避免必选字符固定落在开头
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

export function entropyBits(options = {}) {
  const pool = poolOf(options);
  if (!pool) return 0;
  return clampLength(options.length) * Math.log2(pool.length);
}

/** 粗略强度分级，仅用于界面提示；熵值才是可比较的指标。 */
export function strengthOf(bits) {
  if (bits >= 100) return { label: '很强', tone: 'good', percent: 100 };
  if (bits >= 75) return { label: '强', tone: 'good', percent: 80 };
  if (bits >= 50) return { label: '一般', tone: 'warn', percent: 55 };
  if (bits >= 30) return { label: '偏弱', tone: 'warn', percent: 32 };
  return { label: '弱', tone: 'bad', percent: 15 };
}

/** 随机字节 → 十六进制 / Base64URL。 */
export function randomString(byteLength = 16, format = 'hex') {
  const length = Math.trunc(Number(byteLength));
  const size = Number.isFinite(length) ? Math.min(MAX_RANDOM_BYTES, Math.max(1, length)) : 16;
  const bytes = randomBytes(size);
  return format === 'base64url' ? bytesToBase64(bytes, { urlSafe: true }) : bytesToHex(bytes);
}
