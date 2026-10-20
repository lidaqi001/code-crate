/* 时间戳工具 —— 纯逻辑层。
   时区换算不走「手动加偏移」的捷径，而是用 Intl 反推真实偏移，
   因此夏令时切换、半小时时区（如 Asia/Kolkata）都能算对。 */

const PARTS_FORMATTERS = new Map();

function partsFormatter(timeZone) {
  if (!PARTS_FORMATTERS.has(timeZone)) {
    PARTS_FORMATTERS.set(
      timeZone,
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      })
    );
  }
  return PARTS_FORMATTERS.get(timeZone);
}

function pad(value, size = 2) {
  return String(value).padStart(size, '0');
}

export function assertValidTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return true;
  } catch {
    throw new Error(`无效时区：${timeZone}`);
  }
}

/** 某个瞬间在指定时区的「墙上时间」。 */
export function partsInZone(ms, timeZone) {
  assertValidTimeZone(timeZone);
  const parts = partsFormatter(timeZone).formatToParts(new Date(ms));
  const map = {};
  for (const part of parts) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  // 部分环境会把午夜输出为 24 时
  const hour = Number(map.hour) % 24;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour,
    minute: Number(map.minute),
    second: Number(map.second)
  };
}

/** 指定瞬间在该时区的偏移（毫秒，东为正）。 */
export function offsetMs(ms, timeZone) {
  const parts = partsInZone(ms, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/**
 * 把某时区的墙上时间转换为 UTC 瞬间。
 * 在夏令时边界上做一次迭代修正。
 */
export function zonedTimeToUtc(wall, timeZone) {
  assertValidTimeZone(timeZone);
  const guess = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour || 0,
    wall.minute || 0,
    wall.second || 0,
    wall.ms || 0
  );

  const first = guess - offsetMs(guess, timeZone);
  const second = guess - offsetMs(first, timeZone);
  return second;
}

/** 稳定的可读格式：YYYY-MM-DD HH:mm:ss。 */
export function isoInZone(ms, timeZone) {
  const p = partsInZone(ms, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
}

/** 带时区缩写的本地化展示。 */
export function formatInZone(ms, timeZone, { locale = 'zh-CN', dateStyle = 'medium', timeStyle = 'medium' } = {}) {
  assertValidTimeZone(timeZone);
  return new Intl.DateTimeFormat(locale, { timeZone, dateStyle, timeStyle }).format(new Date(ms));
}

export function zoneAbbreviation(ms, timeZone, locale = 'en-US') {
  const parts = new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: 'short' }).formatToParts(new Date(ms));
  const found = parts.find((part) => part.type === 'timeZoneName');
  return found ? found.value : '';
}

/** 偏移的 ±HH:MM 表示。 */
export function formatOffset(ms, timeZone) {
  const total = Math.round(offsetMs(ms, timeZone) / 60000);
  const sign = total < 0 ? '-' : '+';
  const abs = Math.abs(total);
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/* ── 时间戳解析 ───────────────────────────────────────────── */

const UNIT_BY_MAGNITUDE = [
  { limit: 1e11, unit: 'seconds', toMs: (v) => v * 1000 },
  { limit: 1e14, unit: 'milliseconds', toMs: (v) => v },
  { limit: 1e17, unit: 'microseconds', toMs: (v) => v / 1000 },
  { limit: Infinity, unit: 'nanoseconds', toMs: (v) => v / 1e6 }
];

/**
 * 解析用户输入：纯数字按数量级推断单位；否则交给 Date 解析。
 * @returns {{ms:number, unit:string, raw:string}}
 */
export function parseTimestamp(input) {
  const raw = String(input).trim();
  if (!raw) throw new Error('请输入时间戳或日期时间');

  if (/^-?\d+(\.\d+)?$/.test(raw)) {
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new Error('数值超出可表示范围');
    const magnitude = Math.abs(value);
    const match = UNIT_BY_MAGNITUDE.find((entry) => magnitude < entry.limit) || UNIT_BY_MAGNITUDE[3];
    const ms = match.toMs(value);
    if (!Number.isFinite(ms)) throw new Error('换算后的时间无效');
    return { ms, unit: match.unit, raw };
  }

  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) throw new Error('无法识别的日期时间格式');
  return { ms: parsed, unit: 'datetime', raw };
}

export const UNIT_LABELS = {
  seconds: '秒',
  milliseconds: '毫秒',
  microseconds: '微秒',
  nanoseconds: '纳秒',
  datetime: '日期时间'
};

/* ── 日期差 ───────────────────────────────────────────────── */

function calendarParts(ms) {
  const date = new Date(ms);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth(),
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds()
  };
}

/**
 * 自然日历差值（年/月/日 + 时/分/秒），并给出总毫秒。
 * 用「借位」算法，结果与人对日期的直觉一致。
 */
export function calendarDiff(startMs, endMs) {
  const forward = endMs >= startMs;
  const a = calendarParts(forward ? startMs : endMs);
  const b = calendarParts(forward ? endMs : startMs);

  let seconds = b.second - a.second;
  let minutes = b.minute - a.minute;
  let hours = b.hour - a.hour;
  let days = b.day - a.day;
  let months = b.month - a.month;
  let years = b.year - a.year;

  if (seconds < 0) {
    seconds += 60;
    minutes -= 1;
  }
  if (minutes < 0) {
    minutes += 60;
    hours -= 1;
  }
  if (hours < 0) {
    hours += 24;
    days -= 1;
  }
  if (days < 0) {
    // 借开始日期所在月份的天数：Jan 31 → Mar 1 应得到 1 个月 1 天
    const daysInStartMonth = new Date(Date.UTC(a.year, a.month + 1, 0)).getUTCDate();
    days += daysInStartMonth;
    months -= 1;
  }
  if (months < 0) {
    months += 12;
    years -= 1;
  }

  const totalMs = Math.abs(endMs - startMs);
  return {
    forward,
    years,
    months,
    days,
    hours,
    minutes,
    seconds,
    totalMs,
    totalSeconds: totalMs / 1000,
    totalMinutes: totalMs / 60000,
    totalHours: totalMs / 3600000,
    totalDays: totalMs / 86400000,
    totalWeeks: totalMs / 604800000
  };
}

/* ── 常用派生时间 ─────────────────────────────────────────── */

export function startOfDay(ms, timeZone) {
  const p = partsInZone(ms, timeZone);
  return zonedTimeToUtc({ year: p.year, month: p.month, day: p.day, hour: 0, minute: 0, second: 0 }, timeZone);
}

export function endOfDay(ms, timeZone) {
  return startOfDay(ms, timeZone) + 86400000 - 1;
}

export function startOfWeek(ms, timeZone, weekStartsOn = 1) {
  const p = partsInZone(ms, timeZone);
  const dayStart = zonedTimeToUtc({ year: p.year, month: p.month, day: p.day, hour: 0, minute: 0, second: 0 }, timeZone);
  const weekday = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  const delta = (weekday - weekStartsOn + 7) % 7;
  return dayStart - delta * 86400000;
}

/** 按自然日加减天数（跨夏令时仍保持同一墙上时间）。 */
export function addCalendarDays(ms, days, timeZone) {
  const p = partsInZone(ms, timeZone);
  const shifted = new Date(Date.UTC(p.year, p.month - 1, p.day + days));
  return zonedTimeToUtc(
    {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
      hour: p.hour,
      minute: p.minute,
      second: p.second
    },
    timeZone
  );
}

export function addCalendarMonths(ms, months, timeZone) {
  const p = partsInZone(ms, timeZone);
  const shifted = new Date(Date.UTC(p.year, p.month - 1 + months, p.day));
  return zonedTimeToUtc(
    {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
      hour: p.hour,
      minute: p.minute,
      second: p.second
    },
    timeZone
  );
}

/* ── 时区列表 ─────────────────────────────────────────────── */

const FALLBACK_ZONES = [
  'UTC',
  'Asia/Shanghai',
  'Asia/Hong_Kong',
  'Asia/Taipei',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Asia/Singapore',
  'Asia/Kolkata',
  'Asia/Dubai',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Moscow',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Australia/Sydney',
  'Pacific/Auckland'
];

export function listTimeZones() {
  try {
    if (typeof Intl.supportedValuesOf === 'function') {
      const zones = Intl.supportedValuesOf('timeZone');
      // supportedValuesOf 不返回 UTC（它是 IANA 链接），而 UTC 恰恰是最常用的，手动置顶
      if (zones && zones.length) return ['UTC', ...zones.filter((zone) => zone !== 'UTC')];
    }
  } catch {
    /* 落到内置列表 */
  }
  return FALLBACK_ZONES;
}

export function localTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** 解析 <input type="datetime-local"> 的值（该值代表某个时区的墙上时间）。 */
export function parseDateTimeLocal(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(value).trim());
  if (!match) throw new Error('请输入完整日期时间，如 2026-01-02T03:04');
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] || 0)
  };
}

export function toDateTimeLocalValue(ms, timeZone) {
  const p = partsInZone(ms, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
}

/** 相对时间描述，用于「3 分钟前」这类展示。 */
export function relativeFromNow(ms, now = Date.now()) {
  const diff = ms - now;
  const abs = Math.abs(diff);
  const units = [
    { ms: 31536000000, one: '年' },
    { ms: 2592000000, one: '个月' },
    { ms: 604800000, one: '周' },
    { ms: 86400000, one: '天' },
    { ms: 3600000, one: '小时' },
    { ms: 60000, one: '分钟' },
    { ms: 1000, one: '秒' }
  ];
  if (abs < 1000) return '刚刚';
  const unit = units.find((entry) => abs >= entry.ms);
  const count = Math.round(abs / unit.ms);
  return diff < 0 ? `${count} ${unit.one}前` : `${count} ${unit.one}后`;
}
