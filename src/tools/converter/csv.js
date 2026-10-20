/* CSV / TSV 解析与序列化 —— 纯逻辑层，遵循 RFC 4180。
 *
 * 关键点：
 * - 只有出现在字段开头的引号才表示「带引号字段」，字段中间的引号是普通字符
 * - 引号内的分隔符与换行都属于字段内容
 * - 连续两个引号表示一个字面引号
 */

const CANDIDATE_DELIMITERS = [',', '\t', ';', '|'];

/**
 * 从文本前若干行推断分隔符：优先选择各行出现次数最一致的候选。
 * @returns {string} 分隔符
 */
export function detectDelimiter(text) {
  const lines = String(text ?? '')
    .split(/\r\n?|\n/)
    .filter((line) => line.trim() !== '')
    .slice(0, 10);

  if (!lines.length) return ',';

  let best = ',';
  let bestScore = -1;

  for (const delimiter of CANDIDATE_DELIMITERS) {
    const counts = lines.map((line) => countOutsideQuotes(line, delimiter));
    const first = counts[0];
    if (first === 0) continue;
    // 每行数量一致说明很可能就是它；不一致则扣分
    const consistent = counts.filter((count) => count === first).length;
    const score = consistent * 100 + first;
    if (score > bestScore) {
      bestScore = score;
      best = delimiter;
    }
  }

  return best;
}

function countOutsideQuotes(line, delimiter) {
  let count = 0;
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
    } else if (!inQuotes && char === delimiter) {
      count += 1;
    }
  }
  return count;
}

/**
 * 解析 CSV。
 * @param {string} text
 * @param {{delimiter?:string, header?:boolean}} options
 * @returns {Array<object>|Array<Array<string>>} header 为 true 时返回对象数组
 */
export function parseCsv(text, { delimiter = ',', header = true } = {}) {
  const source = String(text ?? '').replace(/^\uFEFF/, '');
  if (source.trim() === '') return [];

  const rows = [];
  let row = [];
  let field = '';
  let fieldStarted = false;
  let inQuotes = false;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = '';
    fieldStarted = false;
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < source.length) {
    const char = source[i];

    if (inQuotes) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"' && !fieldStarted) {
      inQuotes = true;
      fieldStarted = true;
      i += 1;
      continue;
    }

    if (char === delimiter) {
      endField();
      i += 1;
      continue;
    }

    if (char === '\r') {
      if (source[i + 1] === '\n') i += 1;
      endRow();
      i += 1;
      continue;
    }

    if (char === '\n') {
      endRow();
      i += 1;
      continue;
    }

    field += char;
    fieldStarted = true;
    i += 1;
  }

  if (fieldStarted || field !== '' || row.length) endRow();

  // 去掉文件末尾换行产生的空行
  while (rows.length && rows[rows.length - 1].every((cell) => cell === '')) rows.pop();

  if (!header) return rows;
  if (!rows.length) return [];

  const keys = rows[0];
  return rows.slice(1).map((cells) => {
    const record = {};
    keys.forEach((key, index) => {
      record[key] = cells[index] === undefined ? '' : cells[index];
    });
    return record;
  });
}

/** 收集所有记录的键，按首次出现顺序排列。 */
export function collectKeys(records) {
  const keys = [];
  const seen = new Set();
  for (const record of records) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) continue;
    for (const key of Object.keys(record)) {
      if (!seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    }
  }
  return keys;
}

function needsQuoting(value, delimiter) {
  return value.includes(delimiter) || /["\r\n]/.test(value);
}

function toCsvCell(value, delimiter) {
  if (value === null || value === undefined) return '';
  let text;
  if (typeof value === 'string') text = value;
  else if (typeof value === 'object') text = JSON.stringify(value);
  else text = String(value);
  return needsQuoting(text, delimiter) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * 序列化为 CSV。
 * 支持「对象数组」（首行为表头）与「二维数组」（直接输出）。
 */
export function toCsv(value, { delimiter = ',', newline = '\n' } = {}) {
  if (!Array.isArray(value)) {
    throw new Error('CSV 需要一个数组；对象数组会生成表头，二维数组会直接输出');
  }
  if (!value.length) return '';

  const first = value[0];
  const lines = [];

  if (Array.isArray(first)) {
    for (const row of value) {
      if (!Array.isArray(row)) throw new Error('数组元素类型不一致：不能混合数组与对象');
      lines.push(row.map((cell) => toCsvCell(cell, delimiter)).join(delimiter));
    }
    return lines.join(newline);
  }

  if (first && typeof first === 'object') {
    const keys = collectKeys(value);
    if (!keys.length) {
      // 全是空对象：输出一个空表头行，避免产生无效 CSV
      return '';
    }
    lines.push(keys.map((key) => toCsvCell(key, delimiter)).join(delimiter));
    for (const record of value) {
      if (Array.isArray(record)) throw new Error('数组元素类型不一致：不能混合数组与对象');
      lines.push(keys.map((key) => toCsvCell(record ? record[key] : '', delimiter)).join(delimiter));
    }
    return lines.join(newline);
  }

  // 一维数组：当作单列表格
  return value.map((cell) => toCsvCell(cell, delimiter)).join(newline);
}
