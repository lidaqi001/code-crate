/* 文本 / JSON 差异比较 —— 纯逻辑层。
   使用 LCS（最长公共子序列）动态规划，因此「插入一行」只会产生一处差异，
   而不会像逐行对位比较那样把后面所有行都判为改动。
   为控制内存，先裁剪公共前后缀，再对中间部分做 DP，并设有规模上限。 */

export function splitLines(text) {
  const source = String(text ?? '');
  if (source === '') return [];
  return source.replace(/\r\n?/g, '\n').split('\n');
}

const MAX_CELLS_DEFAULT = 4_000_000;

/** 根据选项生成比较函数。 */
export function buildComparator({ ignoreCase = false, ignoreWhitespace = false } = {}) {
  if (!ignoreCase && !ignoreWhitespace) return (a, b) => a === b;
  return (a, b) => normalize(a, ignoreCase, ignoreWhitespace) === normalize(b, ignoreCase, ignoreWhitespace);
}

function normalize(text, ignoreCase, ignoreWhitespace) {
  let out = text;
  if (ignoreWhitespace) out = out.replace(/\s+/g, ' ').trim();
  if (ignoreCase) out = out.toLowerCase();
  return out;
}

/** 对两段序列做 LCS 差异。 */
function sequenceOps(a, b, equals, maxCells) {
  const n = a.length;
  const m = b.length;
  const ops = [];

  if (n === 0 || m === 0) {
    for (let i = 0; i < n; i += 1) ops.push({ type: 'delete', text: a[i], leftIndex: i, rightIndex: null });
    for (let j = 0; j < m; j += 1) ops.push({ type: 'insert', text: b[j], leftIndex: null, rightIndex: j });
    return { ops, truncated: false };
  }

  if ((n + 1) * (m + 1) > maxCells) {
    for (let i = 0; i < n; i += 1) ops.push({ type: 'delete', text: a[i], leftIndex: i, rightIndex: null });
    for (let j = 0; j < m; j += 1) ops.push({ type: 'insert', text: b[j], leftIndex: null, rightIndex: j });
    return { ops, truncated: true };
  }

  const width = m + 1;
  const dp = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i -= 1) {
    const row = i * width;
    const nextRow = (i + 1) * width;
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[row + j] = equals(a[i], b[j])
        ? dp[nextRow + j + 1] + 1
        : Math.max(dp[nextRow + j], dp[row + j + 1]);
    }
  }

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (equals(a[i], b[j])) {
      ops.push({ type: 'equal', text: a[i], leftIndex: i, rightIndex: j });
      i += 1;
      j += 1;
    } else if (dp[(i + 1) * width + j] >= dp[i * width + j + 1]) {
      ops.push({ type: 'delete', text: a[i], leftIndex: i, rightIndex: null });
      i += 1;
    } else {
      ops.push({ type: 'insert', text: b[j], leftIndex: null, rightIndex: j });
      j += 1;
    }
  }
  while (i < n) {
    ops.push({ type: 'delete', text: a[i], leftIndex: i, rightIndex: null });
    i += 1;
  }
  while (j < m) {
    ops.push({ type: 'insert', text: b[j], leftIndex: null, rightIndex: j });
    j += 1;
  }

  return { ops, truncated: false };
}

export function diffStats(ops) {
  let added = 0;
  let removed = 0;
  let unchanged = 0;
  for (const op of ops) {
    if (op.type === 'insert') added += 1;
    else if (op.type === 'delete') removed += 1;
    else unchanged += 1;
  }
  const total = unchanged * 2 + added + removed;
  return {
    added,
    removed,
    unchanged,
    changed: added + removed,
    similarity: total === 0 ? 1 : (unchanged * 2) / total
  };
}

/**
 * 行级差异。相同的首尾行会被裁掉，只对真正的差异区间做 DP。
 * @returns {{ops:Array, stats:object, truncated:boolean, leftLines:number, rightLines:number}}
 */
export function diffLines(leftText, rightText, options = {}) {
  const { ignoreCase = false, ignoreWhitespace = false, maxCells = MAX_CELLS_DEFAULT } = options;
  const equals = buildComparator({ ignoreCase, ignoreWhitespace });

  const a = splitLines(leftText);
  const b = splitLines(rightText);

  let prefix = 0;
  while (prefix < a.length && prefix < b.length && equals(a[prefix], b[prefix])) prefix += 1;

  let endA = a.length;
  let endB = b.length;
  while (endA > prefix && endB > prefix && equals(a[endA - 1], b[endB - 1])) {
    endA -= 1;
    endB -= 1;
  }

  const ops = [];
  for (let k = 0; k < prefix; k += 1) {
    ops.push({ type: 'equal', text: a[k], leftIndex: k, rightIndex: k });
  }

  const middle = sequenceOps(a.slice(prefix, endA), b.slice(prefix, endB), equals, maxCells);
  for (const op of middle.ops) {
    ops.push({
      ...op,
      leftIndex: op.leftIndex === null ? null : op.leftIndex + prefix,
      rightIndex: op.rightIndex === null ? null : op.rightIndex + prefix
    });
  }

  for (let k = 0; k < a.length - endA; k += 1) {
    ops.push({ type: 'equal', text: a[endA + k], leftIndex: endA + k, rightIndex: endB + k });
  }

  return {
    ops,
    stats: diffStats(ops),
    truncated: middle.truncated,
    leftLines: a.length,
    rightLines: b.length,
    prefixEqual: prefix
  };
}

/* ── 词级差异（用于单行内部的精细对比） ───────────────────── */

export function tokenizeWords(text) {
  return String(text ?? '').match(/\s+|[^\s]+/g) || [];
}

export function diffWords(leftText, rightText, options = {}) {
  const { ignoreCase = false, ignoreWhitespace = false, maxCells = 400000 } = options;
  const equals = buildComparator({ ignoreCase, ignoreWhitespace });
  const a = tokenizeWords(leftText);
  const b = tokenizeWords(rightText);
  const result = sequenceOps(a, b, equals, maxCells);
  return { ops: result.ops, stats: diffStats(result.ops), truncated: result.truncated };
}

/**
 * 为「一行被改动」的一对文本生成带标记的片段，供界面做行内高亮。
 * @returns {Array<{type:'equal'|'insert'|'delete', text:string}>}
 */
export function inlineSegments(leftText, rightText, options = {}) {
  const { ops } = diffWords(leftText, rightText, options);
  return ops.map((op) => ({ type: op.type, text: op.text }));
}

/* ── 统一 diff 文本（可直接当补丁阅读） ───────────────────── */

function computeKeep(ops, context) {
  const keep = new Array(ops.length).fill(false);
  ops.forEach((op, index) => {
    if (op.type === 'equal') return;
    const from = Math.max(0, index - context);
    const to = Math.min(ops.length - 1, index + context);
    for (let k = from; k <= to; k += 1) keep[k] = true;
  });
  return keep;
}

export function unifiedDiff(result, { context = 3, fileA = '原内容', fileB = '新内容' } = {}) {
  const { ops } = result;
  const keep = computeKeep(ops, context);

  let oldLine = 1;
  let newLine = 1;
  const numbered = ops.map((op) => {
    const entry = {
      ...op,
      oldLine: op.type === 'insert' ? null : oldLine,
      newLine: op.type === 'delete' ? null : newLine
    };
    if (op.type !== 'insert') oldLine += 1;
    if (op.type !== 'delete') newLine += 1;
    return entry;
  });

  const out = [`--- ${fileA}`, `+++ ${fileB}`];
  let index = 0;

  while (index < numbered.length) {
    if (!keep[index]) {
      index += 1;
      continue;
    }
    let end = index;
    while (end + 1 < numbered.length && keep[end + 1]) end += 1;

    const slice = numbered.slice(index, end + 1);
    const oldCount = slice.filter((entry) => entry.oldLine !== null).length;
    const newCount = slice.filter((entry) => entry.newLine !== null).length;
    const first = slice[0];
    const previous = index > 0 ? numbered[index - 1] : null;

    // 没有前一行时：非空一侧从第 1 行开始；纯插入/纯删除的空一侧用 0（unified diff 约定）
    const oldStart = first.oldLine !== null
      ? first.oldLine
      : previous && previous.oldLine !== null ? previous.oldLine + 1 : oldCount === 0 ? 0 : 1;
    const newStart = first.newLine !== null
      ? first.newLine
      : previous && previous.newLine !== null ? previous.newLine + 1 : newCount === 0 ? 0 : 1;

    out.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    for (const entry of slice) {
      const marker = entry.type === 'insert' ? '+' : entry.type === 'delete' ? '-' : ' ';
      out.push(`${marker}${entry.text}`);
    }
    index = end + 1;
  }

  return out.join('\n');
}

/* ── JSON 结构差异 ────────────────────────────────────────── */

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function pathJoin(base, key) {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `${base}.${key}` : `${base}[${JSON.stringify(key)}]`;
}

function compareValues(left, right, path, out) {
  if (Object.is(left, right)) return;

  const leftType = typeOf(left);
  const rightType = typeOf(right);

  if (leftType !== rightType) {
    out.push({ type: 'changed', path, left, right, reason: `类型由 ${leftType} 变为 ${rightType}` });
    return;
  }

  if (leftType === 'array') {
    const max = Math.max(left.length, right.length);
    for (let i = 0; i < max; i += 1) {
      if (i >= left.length) out.push({ type: 'added', path: `${path}[${i}]`, right: right[i] });
      else if (i >= right.length) out.push({ type: 'removed', path: `${path}[${i}]`, left: left[i] });
      else compareValues(left[i], right[i], `${path}[${i}]`, out);
    }
    return;
  }

  if (leftType === 'object') {
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])];
    for (const key of keys) {
      // 用 hasOwnProperty 判断，避免原型链上的键（如 toString）被误判
      const inLeft = Object.prototype.hasOwnProperty.call(left, key);
      const inRight = Object.prototype.hasOwnProperty.call(right, key);
      const next = pathJoin(path, key);
      if (!inLeft) out.push({ type: 'added', path: next, right: right[key] });
      else if (!inRight) out.push({ type: 'removed', path: next, left: left[key] });
      else compareValues(left[key], right[key], next, out);
    }
    return;
  }

  out.push({ type: 'changed', path, left, right });
}

/**
 * 递归比较两个 JSON 值。
 * @returns {{ok:true, changes:Array}|{ok:false, error:string}}
 */
export function diffJson(leftText, rightText) {
  let left;
  let right;
  try {
    left = JSON.parse(leftText);
  } catch (error) {
    return { ok: false, error: `左侧 JSON 解析失败：${error.message}` };
  }
  try {
    right = JSON.parse(rightText);
  } catch (error) {
    return { ok: false, error: `右侧 JSON 解析失败：${error.message}` };
  }

  const changes = [];
  compareValues(left, right, '$', changes);
  return { ok: true, changes };
}
