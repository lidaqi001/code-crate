import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseCron,
  describeCron,
  nextRuns,
  summarizeValues,
  FIELD_SPECS,
  COMMON_EXPRESSIONS,
  MACROS
} from '../src/tools/cron/logic.js';

/** 用本地时间构造，断言也用本地时间，这样测试与时区无关。 */
const at = (y, m, d, h = 0, min = 0, s = 0) => new Date(y, m - 1, d, h, min, s);
const pad = (n) => String(n).padStart(2, '0');
const fmt = (date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
const runs = (expr, from, count = 3) => nextRuns(expr, { from, count });

/* ── 解析 ─────────────────────────────────────────────────── */

test('解析标准 5 字段', () => {
  const result = parseCron('0 3 * * *');
  assert.equal(result.ok, true);
  assert.equal(result.hasSeconds, false);
  assert.deepEqual([...result.fields.minute], [0]);
  assert.deepEqual([...result.fields.hour], [3]);
  assert.equal(result.fields.domWildcard, true);
  assert.equal(result.normalized, '0 3 * * *');
});

test('解析带秒的 6 字段', () => {
  const result = parseCron('*/30 0 3 * * *');
  assert.equal(result.ok, true);
  assert.equal(result.hasSeconds, true);
  assert.deepEqual([...result.fields.second], [0, 30]);
  assert.deepEqual([...result.fields.minute], [0]);
});

test('字段数量不对时给出明确提示', () => {
  const result = parseCron('0 3 * *');
  assert.equal(result.ok, false);
  assert.match(result.error, /5 个字段.*6 个字段/);

  assert.match(parseCron('1 2 3 4 5 6 7').error, /7 个/);
});

test('支持宏', () => {
  assert.deepEqual([...parseCron('@daily').fields.hour], [0]);
  assert.deepEqual([...parseCron('@hourly').fields.minute], [0]);
  assert.deepEqual([...parseCron('@weekly').fields.dow], [0]);
  assert.deepEqual([...parseCron('@yearly').fields.month], [1]);
  assert.equal(parseCron('@reboot').ok, false);
  assert.match(parseCron('@reboot').error, /无法计算/);
  assert.match(parseCron('@nope').error, /不认识的宏/);
  assert.equal(Object.keys(MACROS).length >= 6, true);
});

test('支持范围、步长与列表', () => {
  assert.deepEqual([...parseCron('0 9-17 * * *').fields.hour], [9, 10, 11, 12, 13, 14, 15, 16, 17]);
  assert.deepEqual([...parseCron('*/15 * * * *').fields.minute], [0, 15, 30, 45]);
  assert.deepEqual([...parseCron('0 9,18 * * *').fields.hour], [9, 18]);
  assert.deepEqual([...parseCron('0 8-12/2 * * *').fields.hour], [8, 10, 12]);
  assert.deepEqual([...parseCron('5-10 * * * *').fields.minute], [5, 6, 7, 8, 9, 10]);
  assert.deepEqual([...parseCron('0 */6 * * *').fields.hour], [0, 6, 12, 18]);
});

test('支持月份的英文缩写', () => {
  assert.deepEqual([...parseCron('0 0 1 JAN *').fields.month], [1]);
  assert.deepEqual([...parseCron('0 0 1 jan,dec *').fields.month], [1, 12]);
  assert.deepEqual([...parseCron('0 0 1 MAR-JUN *').fields.month], [3, 4, 5, 6]);
  assert.match(parseCron('0 0 1 FOO *').error, /不是合法取值/);
});

test('支持星期的英文缩写', () => {
  assert.deepEqual([...parseCron('0 0 * * MON').fields.dow], [1]);
  assert.deepEqual([...parseCron('0 0 * * MON-FRI').fields.dow], [1, 2, 3, 4, 5]);
  assert.deepEqual([...parseCron('0 0 * * SAT,SUN').fields.dow], [6, 0]);
});

test('星期 0 与 7 都表示周日', () => {
  assert.deepEqual([...parseCron('0 0 * * 0').fields.dow], [0]);
  assert.deepEqual([...parseCron('0 0 * * 7').fields.dow], [0]);
  assert.deepEqual([...parseCron('0 0 * * SUN').fields.dow], [0]);
  // 5-7 表示周五、周六、周日
  assert.deepEqual([...parseCron('0 0 * * 5-7').fields.dow], [5, 6, 0]);
});

test('越界取值会指明字段与范围', () => {
  assert.match(parseCron('60 * * * *').error, /分钟.*0-59/);
  assert.match(parseCron('0 24 * * *').error, /小时.*0-23/);
  assert.match(parseCron('0 0 32 * *').error, /日.*1-31/);
  assert.match(parseCron('0 0 * 13 *').error, /月.*1-12/);
  assert.match(parseCron('0 0 * * 8').error, /星期.*0-7/);
});

test('语法错误会给出可读原因', () => {
  assert.match(parseCron('').error, /为空/);
  assert.match(parseCron('a * * * *').error, /不是合法取值/);
  assert.match(parseCron('*/0 * * * *').error, /步长必须大于 0/);
  assert.match(parseCron('*/x * * * *').error, /步长.*不是数字/);
  assert.match(parseCron('10-5 * * * *').error, /起点大于终点/);
  assert.match(parseCron('1,,2 * * * *').error, /空的取值/);
});

/* ── 取值压缩 ─────────────────────────────────────────────── */

test('summarizeValues 压缩连续与等差取值', () => {
  assert.equal(summarizeValues(new Set([1]), FIELD_SPECS[0]), '1');
  assert.equal(summarizeValues(new Set([1, 2, 3]), FIELD_SPECS[0]), '1-3');
  assert.equal(summarizeValues(new Set([0, 15, 30, 45]), FIELD_SPECS[0]), '0-45/15');
  assert.equal(summarizeValues(new Set([1, 5, 9]), FIELD_SPECS[0]), '1-9/4');
  assert.equal(summarizeValues(new Set([0, 30]), FIELD_SPECS[0]), '0-30/30');
  assert.equal(summarizeValues(new Set([1, 2, 3, 10, 20, 30]), FIELD_SPECS[0]), '1-3,10-30/10');
});

/* ── 自然语言描述 ─────────────────────────────────────────── */

test('生成中文描述', () => {
  assert.equal(describeCron('* * * * *').text, '每分钟执行');
  assert.equal(describeCron('*/5 * * * *').text, '每 5 分钟执行');
  assert.equal(describeCron('*/15 * * * *').text, '每 15 分钟执行');
  assert.equal(describeCron('0 */6 * * *').text, '每 6 小时执行');
  assert.equal(describeCron('0 3 * * *').text, '每天 03:00 执行');
  assert.equal(describeCron('30 9 * * 1-5').text, '周一、周二、周三、周四、周五 09:30 执行');
  assert.equal(describeCron('0 0 1 * *').text, '1 日 00:00 执行');
  assert.equal(describeCron('0 0 1 1 *').text, '1 月 1 日 00:00 执行');
  assert.equal(describeCron('@daily').text, '每天 00:00 执行');
});

test('描述带秒的表达式', () => {
  assert.equal(describeCron('*/30 * * * * *').text, '第 0、30 秒触发：每分钟执行');
  assert.equal(describeCron('0 0 3 * * *').text, '第 0 秒触发：每天 03:00 执行');
});

test('描述同时限定日与星期时说明「或」关系', () => {
  const description = describeCron('0 0 1 * 1').text;
  assert.match(description, /或/);
});

test('描述返回逐字段明细', () => {
  const result = describeCron('*/15 9-17 * * 1-5');
  assert.equal(result.ok, true);
  assert.equal(result.detail.length, 5);
  assert.equal(result.detail[0].label, '分钟');
  assert.deepEqual(result.detail[0].resolved, [0, 15, 30, 45]);
  assert.equal(result.detail[3].raw, '*');
});

test('描述非法表达式时返回错误', () => {
  const result = describeCron('bad');
  assert.equal(result.ok, false);
  assert.ok(result.error.length > 0);
});

/* ── 下次触发时间 ─────────────────────────────────────────── */

test('每天固定时间', () => {
  const result = runs('0 3 * * *', at(2026, 1, 1, 0, 0));
  assert.equal(result.ok, true);
  assert.deepEqual(result.runs.map(fmt), [
    '2026-01-01 03:00:00',
    '2026-01-02 03:00:00',
    '2026-01-03 03:00:00'
  ]);
});

test('起点时刻本身不会重复返回（严格取下一次）', () => {
  const result = runs('0 3 * * *', at(2026, 1, 1, 3, 0), 1);
  assert.deepEqual(result.runs.map(fmt), ['2026-01-02 03:00:00']);
});

test('每 15 分钟', () => {
  const result = runs('*/15 * * * *', at(2026, 1, 1, 0, 7), 4);
  assert.deepEqual(result.runs.map(fmt), [
    '2026-01-01 00:15:00',
    '2026-01-01 00:30:00',
    '2026-01-01 00:45:00',
    '2026-01-01 01:00:00'
  ]);
});

test('每月 1 号会跨月推进', () => {
  const result = runs('0 0 1 * *', at(2026, 1, 15, 12, 0), 2);
  assert.deepEqual(result.runs.map(fmt), ['2026-02-01 00:00:00', '2026-03-01 00:00:00']);
});

test('每周日会跨周推进', () => {
  // 2026-01-01 是周四，下一个周日是 01-04
  const result = runs('0 0 * * 0', at(2026, 1, 1, 0, 0), 2);
  assert.deepEqual(result.runs.map(fmt), ['2026-01-04 00:00:00', '2026-01-11 00:00:00']);
});

test('工作日 9:30 会跳过周末', () => {
  // 2026-01-02 是周五，下一次应落到 01-05 周一
  const result = runs('30 9 * * 1-5', at(2026, 1, 2, 10, 0), 2);
  assert.deepEqual(result.runs.map(fmt), ['2026-01-05 09:30:00', '2026-01-06 09:30:00']);
});

test('闰年 2 月 29 日', () => {
  const result = runs('0 0 29 2 *', at(2026, 1, 1, 0, 0), 1);
  assert.deepEqual(result.runs.map(fmt), ['2028-02-29 00:00:00']);
});

test('日与星期同时限定时取「或」', () => {
  // 1 号或周一：从 2026-01-02 起，最近的周一们，然后跨到 2 月 1 日
  const result = runs('0 0 1 * 1', at(2026, 1, 2, 0, 0), 5);
  assert.deepEqual(result.runs.map(fmt), [
    '2026-01-05 00:00:00',
    '2026-01-12 00:00:00',
    '2026-01-19 00:00:00',
    '2026-01-26 00:00:00',
    '2026-02-01 00:00:00'
  ]);
});

test('跨月与跨年的推进', () => {
  assert.deepEqual(runs('0 0 1 1 *', at(2026, 6, 1), 1).runs.map(fmt), ['2027-01-01 00:00:00']);
  assert.deepEqual(runs('0 0 31 12 *', at(2026, 1, 1), 1).runs.map(fmt), ['2026-12-31 00:00:00']);
});

test('每小时整点', () => {
  const result = runs('0 * * * *', at(2026, 1, 1, 10, 30), 3);
  assert.deepEqual(result.runs.map(fmt), [
    '2026-01-01 11:00:00',
    '2026-01-01 12:00:00',
    '2026-01-01 13:00:00'
  ]);
});

test('带秒的表达式按秒推进', () => {
  const result = runs('*/30 * * * * *', at(2026, 1, 1, 0, 0, 5), 3);
  assert.deepEqual(result.runs.map(fmt), [
    '2026-01-01 00:00:30',
    '2026-01-01 00:01:00',
    '2026-01-01 00:01:30'
  ]);
});

test('不可能满足的表达式返回空并标记 truncated', () => {
  const result = runs('0 0 31 2 *', at(2026, 1, 1), 3);
  assert.equal(result.ok, true);
  assert.deepEqual(result.runs, []);
  assert.equal(result.truncated, true);
});

test('结果数量不足时标记 truncated', () => {
  const result = nextRuns('0 0 29 2 *', { from: at(2026, 1, 1), count: 3, maxDays: 800 });
  assert.equal(result.ok, true);
  assert.equal(result.runs.length, 1);
  assert.equal(result.truncated, true);
});

test('非法表达式返回错误而不是抛异常', () => {
  const wrongCount = nextRuns('nope', { from: at(2026, 1, 1) });
  assert.equal(wrongCount.ok, false);
  assert.match(wrongCount.error, /5 个字段/);

  const badValue = nextRuns('x * * * *', { from: at(2026, 1, 1) });
  assert.equal(badValue.ok, false);
  assert.match(badValue.error, /不是合法取值/);
});

test('commonExpressions 全部可解析且能算出下次触发', () => {
  assert.ok(COMMON_EXPRESSIONS.length >= 10);
  for (const entry of COMMON_EXPRESSIONS) {
    const parsed = parseCron(entry.expression);
    assert.equal(parsed.ok, true, `${entry.expression}：${parsed.error}`);
    assert.ok(entry.note);
    const next = nextRuns(entry.expression, { from: at(2026, 1, 1), count: 1 });
    assert.equal(next.ok, true, entry.expression);
    assert.ok(next.runs.length >= 1, `${entry.expression} 没有算出结果`);
  }
});

test('计算结果始终晚于起点且严格递增', () => {
  const from = at(2026, 3, 15, 13, 37, 22);
  const result = nextRuns('*/7 8-18 * * 1-5', { from, count: 20 });
  assert.equal(result.ok, true);
  let previous = from;
  for (const run of result.runs) {
    assert.ok(run.getTime() > previous.getTime(), '必须严格递增');
    previous = run;
  }
});
