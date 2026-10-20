import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseTimestamp,
  partsInZone,
  zonedTimeToUtc,
  isoInZone,
  formatOffset,
  offsetMs,
  calendarDiff,
  startOfDay,
  endOfDay,
  addCalendarDays,
  addCalendarMonths,
  toDateTimeLocalValue,
  parseDateTimeLocal,
  relativeFromNow,
  listTimeZones,
  localTimeZone,
  assertValidTimeZone,
  zoneAbbreviation
} from '../src/tools/timestamp/logic.js';

const NY = 'America/New_York';
const SH = 'Asia/Shanghai';

/* ── 时间戳解析 ───────────────────────────────────────────── */

test('parseTimestamp 按数量级推断单位', () => {
  assert.equal(parseTimestamp('1700000000').unit, 'seconds');
  assert.equal(parseTimestamp('1700000000').ms, 1700000000000);
  assert.equal(parseTimestamp('1700000000000').unit, 'milliseconds');
  assert.equal(parseTimestamp('1700000000000').ms, 1700000000000);
  assert.equal(parseTimestamp('1700000000000000').unit, 'microseconds');
  assert.equal(parseTimestamp('1700000000000000').ms, 1700000000000);
  assert.equal(parseTimestamp('1700000000000000000').unit, 'nanoseconds');
  assert.equal(Math.round(parseTimestamp('1700000000000000000').ms), 1700000000000);
});

test('parseTimestamp 接受日期时间字符串', () => {
  const parsed = parseTimestamp('2026-01-02T03:04:05Z');
  assert.equal(parsed.unit, 'datetime');
  assert.equal(parsed.ms, Date.UTC(2026, 0, 2, 3, 4, 5));
});

test('parseTimestamp 对非法输入抛出可读错误', () => {
  assert.throws(() => parseTimestamp(''), /请输入/);
  assert.throws(() => parseTimestamp('not-a-date'), /无法识别/);
});

/* ── 时区偏移 ─────────────────────────────────────────────── */

test('固定偏移时区计算正确', () => {
  const ms = Date.UTC(2026, 0, 15, 0, 0, 0);
  assert.equal(formatOffset(ms, 'UTC'), '+00:00');
  assert.equal(formatOffset(ms, SH), '+08:00');
  assert.equal(formatOffset(ms, 'Asia/Kolkata'), '+05:30');
});

test('夏令时期间偏移随日期变化', () => {
  const winter = Date.UTC(2026, 0, 15, 12, 0, 0);
  const summer = Date.UTC(2026, 6, 15, 12, 0, 0);
  assert.equal(formatOffset(winter, NY), '-05:00');
  assert.equal(formatOffset(summer, NY), '-04:00');
  assert.equal(offsetMs(winter, NY), -5 * 3600000);
  assert.equal(offsetMs(summer, NY), -4 * 3600000);
});

test('非法时区抛出错误', () => {
  assert.throws(() => assertValidTimeZone('Mars/Olympus'), /无效时区/);
});

/* ── 墙上时间 <-> 瞬间 ────────────────────────────────────── */

test('zonedTimeToUtc 与 partsInZone 可往返', () => {
  const wall = { year: 2026, month: 7, day: 1, hour: 9, minute: 30, second: 15 };
  for (const zone of ['UTC', SH, NY, 'Asia/Kolkata', 'Australia/Sydney']) {
    const ms = zonedTimeToUtc(wall, zone);
    assert.deepEqual(partsInZone(ms, zone), wall, zone);
  }
});

test('zonedTimeToUtc 正确换算上海时间', () => {
  const ms = zonedTimeToUtc({ year: 2026, month: 1, day: 1, hour: 0, minute: 0, second: 0 }, SH);
  assert.equal(ms, Date.UTC(2025, 11, 31, 16, 0, 0));
  assert.equal(isoInZone(ms, SH), '2026-01-01 00:00:00');
  assert.equal(isoInZone(ms, 'UTC'), '2025-12-31 16:00:00');
});

/* ── 夏令时边界 ───────────────────────────────────────────── */

test('跨夏令时按自然日加减仍保持同一墙上时间', () => {
  // 2026-03-08 是美国东部夏令时开始日（02:00 -> 03:00）
  const start = zonedTimeToUtc({ year: 2026, month: 3, day: 7, hour: 12, minute: 0, second: 0 }, NY);
  const next = addCalendarDays(start, 1, NY);

  assert.equal(isoInZone(next, NY), '2026-03-08 12:00:00');
  // 真实经过的是 23 小时，而不是 24 小时
  assert.equal((next - start) / 3600000, 23);

  // 直接加 86400000 毫秒会得到 13:00，这正是常见错误
  assert.equal(isoInZone(start + 86400000, NY), '2026-03-08 13:00:00');
});

test('跨夏令时结束日按自然日加减', () => {
  // 2026-11-01 夏令时结束（02:00 -> 01:00），当天有 25 小时
  const start = zonedTimeToUtc({ year: 2026, month: 10, day: 31, hour: 12, minute: 0, second: 0 }, NY);
  const next = addCalendarDays(start, 1, NY);
  assert.equal(isoInZone(next, NY), '2026-11-01 12:00:00');
  assert.equal((next - start) / 3600000, 25);
});

test('addCalendarMonths 处理月末溢出', () => {
  const jan31 = zonedTimeToUtc({ year: 2026, month: 1, day: 31, hour: 8, minute: 0, second: 0 }, SH);
  const result = addCalendarMonths(jan31, 1, SH);
  // JS Date 会把 2 月 31 日规范化为 3 月 3 日
  assert.equal(isoInZone(result, SH), '2026-03-03 08:00:00');
});

/* ── 日期差 ───────────────────────────────────────────────── */

test('calendarDiff 计算年月日时分秒', () => {
  const diff = calendarDiff(Date.UTC(2026, 0, 1), Date.UTC(2027, 2, 15));
  assert.equal(diff.forward, true);
  assert.equal(diff.years, 1);
  assert.equal(diff.months, 2);
  assert.equal(diff.days, 14);
  assert.equal(diff.hours, 0);
});

test('calendarDiff 处理负方向', () => {
  const diff = calendarDiff(Date.UTC(2027, 2, 15), Date.UTC(2026, 0, 1));
  assert.equal(diff.forward, false);
  assert.equal(diff.years, 1);
  assert.equal(diff.months, 2);
  assert.equal(diff.days, 14);
});

test('calendarDiff 借位正确（时分秒回退）', () => {
  const diff = calendarDiff(Date.UTC(2026, 0, 2, 10, 20, 30), Date.UTC(2026, 0, 1, 8, 15, 10));
  assert.equal(diff.forward, false);
  assert.equal(diff.days, 1);
  assert.equal(diff.hours, 2);
  assert.equal(diff.minutes, 5);
  assert.equal(diff.seconds, 20);
});

test('calendarDiff 同一时刻全为 0', () => {
  const diff = calendarDiff(1700000000000, 1700000000000);
  assert.equal(diff.years + diff.months + diff.days + diff.hours + diff.minutes + diff.seconds, 0);
  assert.equal(diff.totalMs, 0);
});

/* ── 派生时间 ─────────────────────────────────────────────── */

test('startOfDay / endOfDay 落在正确边界', () => {
  const ms = zonedTimeToUtc({ year: 2026, month: 5, day: 20, hour: 13, minute: 45, second: 30 }, SH);
  assert.equal(isoInZone(startOfDay(ms, SH), SH), '2026-05-20 00:00:00');
  assert.equal(isoInZone(endOfDay(ms, SH), SH), '2026-05-20 23:59:59');
  assert.equal(endOfDay(ms, SH) - startOfDay(ms, SH), 86399999);
});

test('时区列表把 UTC 放在首位', () => {
  assert.equal(listTimeZones()[0], 'UTC');
});

test('datetime-local 值与瞬间互转', () => {
  const wall = { year: 2026, month: 9, day: 9, hour: 9, minute: 9, second: 9 };
  const ms = zonedTimeToUtc(wall, SH);
  assert.equal(toDateTimeLocalValue(ms, SH), '2026-09-09T09:09:09');
  assert.deepEqual(parseDateTimeLocal('2026-09-09T09:09'), {
    year: 2026,
    month: 9,
    day: 9,
    hour: 9,
    minute: 9,
    second: 0
  });
  assert.throws(() => parseDateTimeLocal('2026/09/09'), /完整日期时间/);
});

test('relativeFromNow 输出相对描述', () => {
  const now = Date.UTC(2026, 0, 1, 12, 0, 0);
  assert.equal(relativeFromNow(now - 3000, now), '3 秒前');
  assert.equal(relativeFromNow(now - 3 * 60000, now), '3 分钟前');
  assert.equal(relativeFromNow(now - 2 * 3600000, now), '2 小时前');
  assert.equal(relativeFromNow(now + 2 * 86400000, now), '2 天后');
  assert.equal(relativeFromNow(now - 200, now), '刚刚');
});

/* ── 时区列表 ─────────────────────────────────────────────── */

test('时区列表非空且包含常用时区', () => {
  const zones = listTimeZones();
  assert.ok(zones.length > 10);
  assert.ok(zones.includes('UTC') || zones.includes('Etc/UTC'));
  assert.equal(typeof localTimeZone(), 'string');
  assert.equal(typeof zoneAbbreviation(Date.UTC(2026, 0, 1), NY), 'string');
});

test('跨月借位不产生负天数', () => {
  const at = (year, month, day) => Date.UTC(year, month - 1, day);
  const janToMar = calendarDiff(at(2026, 1, 31), at(2026, 3, 1));
  assert.equal(janToMar.months, 1);
  assert.equal(janToMar.days, 1);

  const janToApr = calendarDiff(at(2024, 1, 31), at(2024, 4, 1));
  assert.equal(janToApr.months, 2);
  assert.equal(janToApr.days, 1);

  const janToFeb = calendarDiff(at(2024, 1, 31), at(2024, 2, 29));
  assert.equal(janToFeb.months, 0);
  assert.equal(janToFeb.days, 29);
});
