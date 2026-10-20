/* Cron 表达式解析与计算 —— 纯逻辑层。
 *
 * 支持标准 5 字段（分 时 日 月 周）与带秒的 6 字段写法，以及 @daily 这类宏。
 * 字段语法：星号  a  a-b  a-b/步长  星号/步长  a,b,c
 * 月与星期支持三个字母的英文缩写（JAN / MON）。
 *
 * 两个容易踩的点，这里按规范处理：
 * - 星期 0 与 7 都表示周日
 * - 「日」与「星期」同时被限定时取**或**关系（这是 cron 的历史语义）
 */

const MONTH_NAMES = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
const DOW_NAMES = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };

const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export const FIELD_SPECS = [
  { key: 'minute', label: '分钟', min: 0, max: 59 },
  { key: 'hour', label: '小时', min: 0, max: 23 },
  { key: 'dom', label: '日', min: 1, max: 31 },
  { key: 'month', label: '月', min: 1, max: 12, names: MONTH_NAMES },
  { key: 'dow', label: '星期', min: 0, max: 6, parseMax: 7, names: DOW_NAMES, wrap: (value) => (value === 7 ? 0 : value) }
];

const SECOND_SPEC = { key: 'second', label: '秒', min: 0, max: 59 };

export const MACROS = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *'
};

function parseValueToken(text, spec) {
  const raw = String(text).trim().toUpperCase();
  if (spec.names && raw in spec.names) return spec.names[raw];
  if (!/^\d+$/.test(raw)) throw new Error(`「${text}」不是合法取值`);
  const value = Number(raw);
  const upper = spec.parseMax ?? spec.max;
  if (value < spec.min || value > upper) {
    throw new Error(`「${text}」超出 ${spec.label} 的取值范围 ${spec.min}-${upper}`);
  }
  return value;
}

function parseField(text, spec) {
  const source = String(text).trim();
  if (source === '') throw new Error(`${spec.label}字段为空`);

  const values = new Set();

  for (const part of source.split(',')) {
    const token = part.trim();
    if (token === '') throw new Error(`${spec.label}字段里有空的取值`);

    const slash = token.indexOf('/');
    const rangeText = slash >= 0 ? token.slice(0, slash) : token;
    const stepText = slash >= 0 ? token.slice(slash + 1) : null;

    let step = 1;
    if (stepText !== null) {
      if (!/^\d+$/.test(stepText)) throw new Error(`${spec.label}字段的步长「${stepText}」不是数字`);
      step = Number(stepText);
      if (step < 1) throw new Error(`${spec.label}字段的步长必须大于 0`);
    }

    let start;
    let end;

    if (rangeText === '*') {
      start = spec.min;
      end = spec.max;
    } else if (rangeText.includes('-')) {
      const [left, right] = rangeText.split('-');
      start = parseValueToken(left, spec);
      end = parseValueToken(right, spec);
      if (start > end) throw new Error(`${spec.label}字段的范围「${rangeText}」起点大于终点`);
    } else {
      start = parseValueToken(rangeText, spec);
      end = stepText !== null ? spec.parseMax ?? spec.max : start;
    }

    for (let value = start; value <= end; value += step) {
      values.add(spec.wrap ? spec.wrap(value) : value);
    }
  }

  if (values.size === 0) throw new Error(`${spec.label}字段没有解析出任何取值`);
  return values;
}

/**
 * 解析 cron 表达式。
 * @returns {{ok:true, fields:object, hasSeconds:boolean, normalized:string}|{ok:false, error:string}}
 */
export function parseCron(text) {
  const raw = String(text ?? '').trim();
  if (raw === '') return { ok: false, error: '表达式为空' };

  const lower = raw.toLowerCase();
  if (lower.startsWith('@')) {
    if (lower === '@reboot') return { ok: false, error: '@reboot 与时间无关，无法计算下次触发' };
    const expanded = MACROS[lower];
    if (!expanded) return { ok: false, error: `不认识的宏：${raw}` };
    return parseCron(expanded);
  }

  const parts = raw.split(/\s+/);
  let hasSeconds = false;
  let specs;

  if (parts.length === 5) {
    specs = FIELD_SPECS;
  } else if (parts.length === 6) {
    hasSeconds = true;
    specs = [SECOND_SPEC, ...FIELD_SPECS];
  } else {
    return {
      ok: false,
      error: `需要 5 个字段（分 时 日 月 周）或 6 个字段（秒 分 时 日 月 周），当前是 ${parts.length} 个`
    };
  }

  const fields = {};
  for (let i = 0; i < specs.length; i += 1) {
    const spec = specs[i];
    try {
      fields[spec.key] = parseField(parts[i], spec);
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  for (const spec of FIELD_SPECS) {
    fields[`${spec.key}Wildcard`] = parts[specs.indexOf(spec)].trim() === '*';
  }
  if (hasSeconds) fields.secondWildcard = parts[0].trim() === '*';

  return {
    ok: true,
    fields,
    hasSeconds,
    normalized: [hasSeconds ? parts[0] : null, ...FIELD_SPECS.map((spec) => parts[specs.indexOf(spec)])]
      .filter(Boolean)
      .join(' ')
  };
}

/* ── 取值集合的可读化 ─────────────────────────────────────── */

/** 把取值集合压缩成 a-b 或 a-b/步长 形式，便于界面展示与核对。 */
export function summarizeValues(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return '';

  const chunks = [];
  let start = sorted[0];
  let previous = sorted[0];
  let runStep = null;

  const flush = () => {
    if (start === previous) chunks.push(String(start));
    else if (runStep === null || runStep === 1) chunks.push(`${start}-${previous}`);
    else chunks.push(`${start}-${previous}/${runStep}`);
  };

  for (let i = 1; i < sorted.length; i += 1) {
    const current = sorted[i];
    const gap = current - previous;

    if (runStep === null) {
      runStep = gap;
      previous = current;
      continue;
    }
    if (gap === runStep) {
      previous = current;
      continue;
    }
    flush();
    start = current;
    previous = current;
    runStep = null;
  }
  flush();

  return chunks.join(',');
}

/* ── 自然语言描述 ─────────────────────────────────────────── */

function isWildcard(values, spec) {
  if (values.size !== spec.max - spec.min + 1) return false;
  for (let v = spec.min; v <= spec.max; v += 1) if (!values.has(v)) return false;
  return true;
}

/** 若集合是从最小值开始的等差数列，返回公差；否则返回 null。 */
function arithmeticStep(values, spec) {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length < 2) return null;
  if (sorted[0] !== spec.min) return null;
  const step = sorted[1] - sorted[0];
  for (let i = 2; i < sorted.length; i += 1) {
    if (sorted[i] - sorted[i - 1] !== step) return null;
  }
  return step;
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function describeList(values, formatter) {
  const sorted = [...values].sort((a, b) => a - b);
  const shown = sorted.slice(0, 6).map((value) => (formatter ? formatter(value) : String(value)));
  const suffix = sorted.length > shown.length ? ` 等 ${sorted.length} 个` : '';
  return `${shown.join('、')}${suffix}`;
}

/**
 * 生成中文描述。
 * @returns {{ok:true, text:string, detail:Array}|{ok:false, error:string}}
 */
export function describeCron(expression) {
  const parsed = parseCron(expression);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const { fields, hasSeconds } = parsed;
  const minuteSpec = FIELD_SPECS[0];
  const hourSpec = FIELD_SPECS[1];

  const minute = fields.minute;
  const hour = fields.hour;
  const dom = fields.dom;
  const month = fields.month;
  const dow = fields.dow;

  const minuteWild = isWildcard(minute, minuteSpec);
  const hourWild = isWildcard(hour, hourSpec);
  const restWild = fields.domWildcard && fields.monthWildcard && fields.dowWildcard;

  const minuteStep = arithmeticStep(minute, minuteSpec);
  const hourStep = arithmeticStep(hour, hourSpec);

  const timeText = () => {
    const hours = [...hour].sort((a, b) => a - b);
    const minutes = [...minute].sort((a, b) => a - b);
    if (hours.length === 1 && minutes.length === 1) return `${pad(hours[0])}:${pad(minutes[0])}`;
    if (minutes.length === 1) return `${describeList(hour, (v) => `${pad(v)} 点`)} 的第 ${pad(minutes[0])} 分钟`;
    return `${describeList(hour, (v) => `${pad(v)} 点`)} 的第 ${describeList(minute, pad)} 分钟`;
  };

  const dayText = () => {
    const parts = [];
    if (!fields.monthWildcard) parts.push(describeList(month, (v) => `${v} 月`));
    if (!fields.domWildcard && !fields.dowWildcard) {
      parts.push(`${describeList(dom, (v) => `${v} 日`)}或${describeList(dow, (v) => WEEKDAY_LABELS[v])}`);
    } else if (!fields.domWildcard) {
      parts.push(describeList(dom, (v) => `${v} 日`));
    } else if (!fields.dowWildcard) {
      parts.push(describeList(dow, (v) => WEEKDAY_LABELS[v]));
    }
    return parts.join(' ');
  };

  let baseText;

  if (minuteWild && hourWild && restWild) {
    baseText = '每分钟执行';
  } else if (minuteStep !== null && hourWild && restWild) {
    baseText = `每 ${minuteStep} 分钟执行`;
  } else if (minute.size === 1 && hourWild && restWild) {
    baseText = `每小时的第 ${[...minute][0]} 分钟执行`;
  } else if (minuteStep !== null && hour.size === 1 && restWild) {
    baseText = `每天 ${pad([...hour][0])} 点内每 ${minuteStep} 分钟执行`;
  } else if (minute.size === 1 && [...minute][0] === 0 && hourStep !== null && restWild) {
    baseText = `每 ${hourStep} 小时执行`;
  } else if (minuteWild && !hourWild && restWild) {
    baseText = `${describeList(hour, (v) => `${pad(v)} 点`)} 内的每分钟执行`;
  } else {
    const day = dayText();
    baseText = `${day ? day : '每天'} ${timeText()} 执行`;
  }

  const text = hasSeconds
    ? `第 ${fields.secondWildcard ? '任意' : describeList(fields.second)} 秒触发：${baseText}`
    : baseText;

  const detail = [
    { key: 'minute', label: '分钟', raw: fields.minuteWildcard ? '*' : summarizeValues(minute), resolved: [...minute].sort((a, b) => a - b) },
    { key: 'hour', label: '小时', raw: fields.hourWildcard ? '*' : summarizeValues(hour), resolved: [...hour].sort((a, b) => a - b) },
    { key: 'dom', label: '日', raw: fields.domWildcard ? '*' : summarizeValues(dom), resolved: [...dom].sort((a, b) => a - b) },
    { key: 'month', label: '月', raw: fields.monthWildcard ? '*' : summarizeValues(month), resolved: [...month].sort((a, b) => a - b) },
    { key: 'dow', label: '星期', raw: fields.dowWildcard ? '*' : summarizeValues(dow), resolved: [...dow].sort((a, b) => a - b) }
  ];

  return { ok: true, text, detail };
}

/* ── 下次触发时间 ─────────────────────────────────────────── */

function matchesDay(fields, date) {
  const domRestricted = !fields.domWildcard;
  const dowRestricted = !fields.dowWildcard;
  const domOk = fields.dom.has(date.getDate());
  const dowOk = fields.dow.has(date.getDay());

  // 两者都被限定时取「或」，这是 cron 的历史语义
  if (domRestricted && dowRestricted) return domOk || dowOk;
  if (domRestricted) return domOk;
  if (dowRestricted) return dowOk;
  return true;
}

/**
 * 计算接下来若干次触发时间（按本地时区）。
 * @returns {{ok:true, runs:Date[], truncated:boolean}|{ok:false, error:string}}
 */
export function nextRuns(text, { count = 5, from = new Date(), maxDays = 366 * 5 } = {}) {
  const parsed = parseCron(text);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const { fields, hasSeconds } = parsed;
  const runs = [];
  const cursor = new Date(from.getTime());
  cursor.setMilliseconds(0);

  if (!hasSeconds) {
    cursor.setSeconds(0, 0);
    cursor.setMinutes(cursor.getMinutes() + 1);
  } else {
    cursor.setSeconds(cursor.getSeconds() + 1);
  }

  const limit = new Date(from.getTime() + maxDays * 86400000);
  let guard = 0;

  while (runs.length < count && cursor <= limit && guard < 2_000_000) {
    guard += 1;

    if (!fields.month.has(cursor.getMonth() + 1)) {
      cursor.setMonth(cursor.getMonth() + 1, 1);
      cursor.setHours(0, 0, 0, 0);
      continue;
    }
    if (!matchesDay(fields, cursor)) {
      cursor.setDate(cursor.getDate() + 1);
      cursor.setHours(0, 0, 0, 0);
      continue;
    }
    if (!fields.hour.has(cursor.getHours())) {
      cursor.setHours(cursor.getHours() + 1, 0, 0, 0);
      continue;
    }
    if (!fields.minute.has(cursor.getMinutes())) {
      cursor.setMinutes(cursor.getMinutes() + 1, 0, 0);
      continue;
    }
    if (hasSeconds && !fields.second.has(cursor.getSeconds())) {
      cursor.setSeconds(cursor.getSeconds() + 1);
      continue;
    }

    runs.push(new Date(cursor.getTime()));
    if (hasSeconds) cursor.setSeconds(cursor.getSeconds() + 1);
    else cursor.setMinutes(cursor.getMinutes() + 1);
  }

  return { ok: true, runs, truncated: runs.length < count };
}

/* ── 常用表达式 ───────────────────────────────────────────── */

export const COMMON_EXPRESSIONS = [
  { expression: '*/5 * * * *', note: '每 5 分钟' },
  { expression: '0 * * * *', note: '每小时整点' },
  { expression: '0 3 * * *', note: '每天凌晨 3 点' },
  { expression: '30 9 * * 1-5', note: '工作日 9:30' },
  { expression: '0 0 * * 0', note: '每周日 0 点' },
  { expression: '0 0 1 * *', note: '每月 1 号 0 点' },
  { expression: '0 0 1 1 *', note: '每年 1 月 1 日' },
  { expression: '0 9,18 * * *', note: '每天 9 点与 18 点' },
  { expression: '*/15 9-17 * * 1-5', note: '工作日 9-17 点每 15 分钟' },
  { expression: '0 0 */2 * *', note: '每两天 0 点' },
  { expression: '0 22 * * 1-5', note: '工作日 22 点' },
  { expression: '15 2 * * *', note: '每天凌晨 2:15（备份常用）' }
];
