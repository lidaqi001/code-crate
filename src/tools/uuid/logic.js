/* UUID / 随机 —— 纯逻辑层，随机源可注入，因此可以被测试。
   默认随机源使用 crypto.getRandomValues，保证密码与标识符的密码学强度。 */

const HEX = '0123456789abcdef';
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 默认随机源。 */
export const defaultRng = {
  nextBytes(length) {
    const out = new Uint8Array(length);
    if (globalThis.crypto && globalThis.crypto.getRandomValues) {
      globalThis.crypto.getRandomValues(out);
    } else {
      for (let i = 0; i < length; i += 1) out[i] = Math.floor(Math.random() * 256);
    }
    return out;
  }
};

/* ── 无偏随机整数 ─────────────────────────────────────────── */

/**
 * [min, max] 闭区间内的均匀随机整数。
 * 使用拒绝采样消除取模偏差 —— 这是随机数正确性的关键。
 */
export function randomInt(min, max, rng = defaultRng) {
  if (!Number.isInteger(min) || !Number.isInteger(max)) throw new Error('范围端点必须是整数');
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  const range = high - low + 1;
  if (range > 0x100000000) throw new Error('范围过大');

  const limit = Math.floor(0x100000000 / range) * range;
  let value;
  do {
    const bytes = rng.nextBytes(4);
    value = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
  } while (value >= limit);

  return low + (value % range);
}

export function randomString(length, alphabet, rng = defaultRng) {
  if (!Number.isInteger(length) || length < 0) throw new Error('长度必须是非负整数');
  if (!alphabet || !alphabet.length) throw new Error('字符集不能为空');
  let out = '';
  for (let i = 0; i < length; i += 1) out += alphabet[randomInt(0, alphabet.length - 1, rng)];
  return out;
}

/* ── UUID ─────────────────────────────────────────────────── */

function bytesToUuid(bytes) {
  const hex = new Array(16);
  for (let i = 0; i < 16; i += 1) hex[i] = HEX[(bytes[i] >> 4) & 0x0f] + HEX[bytes[i] & 0x0f];
  return `${hex[0]}${hex[1]}${hex[2]}${hex[3]}-${hex[4]}${hex[5]}-${hex[6]}${hex[7]}-${hex[8]}${hex[9]}-${hex[10]}${hex[11]}${hex[12]}${hex[13]}${hex[14]}${hex[15]}`;
}

export const NIL_UUID = '00000000-0000-0000-0000-000000000000';

export function uuidV4(rng = defaultRng) {
  const bytes = rng.nextBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return bytesToUuid(bytes);
}

/** UUID v7：前 48 位是毫秒时间戳，因此按字典序即按时间序。 */
export function uuidV7(rng = defaultRng, timestamp = Date.now()) {
  const bytes = rng.nextBytes(16);
  const ts = Math.max(0, Math.floor(timestamp));

  bytes[0] = Math.floor(ts / 2 ** 40) & 0xff;
  bytes[1] = Math.floor(ts / 2 ** 32) & 0xff;
  bytes[2] = Math.floor(ts / 2 ** 24) & 0xff;
  bytes[3] = Math.floor(ts / 2 ** 16) & 0xff;
  bytes[4] = Math.floor(ts / 2 ** 8) & 0xff;
  bytes[5] = ts & 0xff;
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  return bytesToUuid(bytes);
}

/** 从 UUID v7 还原毫秒时间戳；不是 v7 时返回 null。 */
export function uuidV7Timestamp(uuid) {
  const text = String(uuid).replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(text)) return null;
  if (text[12] !== '7') return null;
  const hex = text.slice(0, 12);
  return Number.parseInt(hex, 16);
}

/* ── ULID ─────────────────────────────────────────────────── */

function encodeTime(timestamp, length = 10) {
  let value = Math.max(0, Math.floor(timestamp));
  const out = new Array(length);
  for (let i = length - 1; i >= 0; i -= 1) {
    out[i] = CROCKFORD[value % 32];
    value = Math.floor(value / 32);
  }
  return out.join('');
}

/** ULID：26 个 Crockford Base32 字符，前 10 位为时间戳。 */
export function ulid(rng = defaultRng, timestamp = Date.now()) {
  return encodeTime(timestamp, 10) + randomString(16, CROCKFORD, rng);
}

export function ulidTimestamp(text) {
  const value = String(text).trim().toUpperCase();
  if (value.length !== 26) return null;
  let time = 0;
  for (const char of value.slice(0, 10)) {
    const index = CROCKFORD.indexOf(char);
    if (index < 0) return null;
    time = time * 32 + index;
  }
  return time;
}

/* ── 校验 ─────────────────────────────────────────────────── */

export function validateUuid(input) {
  const text = String(input || '').trim().toLowerCase();
  const match = /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})$/.exec(text);
  if (!match) return { valid: false, reason: '格式不符合 8-4-4-4-12 的十六进制结构' };

  const version = Number.parseInt(match[3][0], 16);
  const variantNibble = Number.parseInt(match[4][0], 16);

  let variant = '未知';
  if ((variantNibble & 0b1000) === 0) variant = 'NCS 向后兼容';
  else if ((variantNibble & 0b1100) === 0b1000) variant = 'RFC 4122';
  else if ((variantNibble & 0b1110) === 0b1100) variant = 'Microsoft GUID';
  else variant = '保留（未来定义）';

  return { valid: true, version, variant, normalized: text, isNil: text === NIL_UUID };
}

/* ── 密码 ─────────────────────────────────────────────────── */

export const CHARSETS = {
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{};:,.?/'
};

const AMBIGUOUS = /[Il1O0o]/g;

export function passwordAlphabet(options = {}) {
  return buildPools(options).join('');
}

function buildPools({ lower = true, upper = true, digits = true, symbols = false, avoidAmbiguous = false } = {}) {
  const picked = [];
  if (lower) picked.push(CHARSETS.lower);
  if (upper) picked.push(CHARSETS.upper);
  if (digits) picked.push(CHARSETS.digits);
  if (symbols) picked.push(CHARSETS.symbols);
  const pools = picked.map((pool) => (avoidAmbiguous ? pool.replace(AMBIGUOUS, '') : pool)).filter(Boolean);
  if (!pools.length) throw new Error('至少需要选择一种字符类型');
  return pools;
}

/**
 * 生成强密码：先保证每种选中的字符至少出现一次，再整体洗牌。
 * 这样既满足复杂度要求，又不引入位置偏差。
 */
export function randomPassword(options = {}, rng = defaultRng) {
  const { length = 16 } = options;
  const pools = buildPools(options);
  if (!Number.isInteger(length) || length < 1) throw new Error('长度必须是正整数');
  if (length < pools.length) throw new Error(`长度至少为 ${pools.length} 才能覆盖所选字符类型`);

  const all = pools.join('');
  const chars = pools.map((pool) => pool[randomInt(0, pool.length - 1, rng)]);
  while (chars.length < length) chars.push(all[randomInt(0, all.length - 1, rng)]);

  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(0, i, rng);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

/** 熵估算：位数越高越难暴力破解。 */
export function entropyBits(length, poolSize) {
  if (poolSize <= 1) return 0;
  return length * Math.log2(poolSize);
}

export function entropyLabel(bits) {
  if (bits < 40) return { label: '弱', level: 'err' };
  if (bits < 60) return { label: '一般', level: 'warn' };
  if (bits < 90) return { label: '强', level: 'ok' };
  return { label: '很强', level: 'ok' };
}

/** 密码强度自检：是否包含所选各类字符。 */
export function checkPassword(password, options = {}) {
  const pools = buildPools(options);
  const missing = pools.filter((pool) => ![...pool].some((char) => password.includes(char)));
  return { ok: missing.length === 0, missingCount: missing.length };
}
