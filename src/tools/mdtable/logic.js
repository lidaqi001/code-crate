/* Markdown 表格生成器 —— 纯逻辑层。
   - buildMarkdown：结构化表格 → Markdown
   - parseTableText：CSV / TSV / 已有 Markdown 表格 → 结构化表格
   - toDelimited：结构化表格 → CSV / TSV */

export const MAX_COLUMNS = 12;
export const MAX_ROWS = 100;

export const ALIGNMENTS = [
  { id: 'none', label: '默认' },
  { id: 'left', label: '左对齐' },
  { id: 'center', label: '居中' },
  { id: 'right', label: '右对齐' }
];

export const DEFAULT_TABLE = {
  hasHeader: true,
  headers: ['列 1', '列 2', '列 3'],
  rows: [
    ['值 1', '值 2', '值 3'],
    ['', '', '']
  ],
  alignments: ['none', 'none', 'none']
};

const ALIGNMENT_IDS = new Set(ALIGNMENTS.map((entry) => entry.id));

export function normalizeTable(table = {}) {
  const headers = Array.isArray(table.headers) ? table.headers : [];
  const rawRows = Array.isArray(table.rows) ? table.rows : [];
  const alignments = Array.isArray(table.alignments) ? table.alignments : [];

  const columns = Math.min(
    MAX_COLUMNS,
    Math.max(1, headers.length, ...rawRows.map((row) => (Array.isArray(row) ? row.length : 0)))
  );

  const cell = (value) => String(value ?? '');
  const fill = (list) => Array.from({ length: columns }, (_, index) => cell(list[index]));
  const rows = rawRows.slice(0, MAX_ROWS).map((row) => fill(Array.isArray(row) ? row : []));

  return {
    hasHeader: table.hasHeader !== false,
    headers: fill(headers),
    rows,
    alignments: Array.from({ length: columns }, (_, index) => {
      const value = alignments[index];
      return ALIGNMENT_IDS.has(value) ? value : 'none';
    })
  };
}

/** 单元格转义：管道符与换行在 Markdown 表格里有特殊含义。 */
export function escapeCell(value) {
  return String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, '<br>')
    .trim();
}

function alignmentMarker(alignment) {
  if (alignment === 'left') return ':---';
  if (alignment === 'center') return ':---:';
  if (alignment === 'right') return '---:';
  return '---';
}

export function buildMarkdown(table = {}) {
  const { hasHeader, headers, rows, alignments } = normalizeTable(table);
  const line = (cells) => `| ${cells.join(' | ')} |`;

  const headRow = hasHeader ? headers : headers.map(() => '');
  const lines = [
    line(headRow.map(escapeCell)),
    line(alignments.map(alignmentMarker)),
    ...rows.map((row) => line(row.map(escapeCell)))
  ];
  return lines.join('\n');
}

/* ── 解析 ─────────────────────────────────────────────────── */

/** 逐字符解析带引号的分隔文本；支持 "" 转义与引号内换行。 */
export function parseDelimited(text, delimiter = ',') {
  const source = String(text ?? '').replace(/\r\n?/g, '\n');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];

    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((entry) => entry.some((cell) => String(cell).trim() !== ''));
}

export function detectDelimiter(text) {
  const firstLine = String(text ?? '').split(/\r?\n/).find((line) => line.trim() !== '') || '';
  if (firstLine.trim().startsWith('|')) return '|';
  const counts = [
    { delimiter: '\t', count: (firstLine.match(/\t/g) || []).length },
    { delimiter: ';', count: (firstLine.match(/;/g) || []).length },
    { delimiter: ',', count: (firstLine.match(/,/g) || []).length }
  ].sort((a, b) => b.count - a.count);
  return counts[0].count > 0 ? counts[0].delimiter : ',';
}

function isSeparatorRow(cells) {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(String(cell).trim()));
}

function alignmentOf(cell) {
  const value = String(cell).trim();
  const left = value.startsWith(':');
  const right = value.endsWith(':');
  if (left && right) return 'center';
  if (left) return 'left';
  if (right) return 'right';
  return 'none';
}

/** CSV / TSV / Markdown 表格 → { hasHeader, headers, rows, alignments }。 */
export function parseTableText(text) {
  const source = String(text ?? '').trim();
  if (!source) throw new Error('没有可导入的内容');

  const delimiter = detectDelimiter(source);
  let matrix;

  if (delimiter === '|') {
    matrix = source
      .split(/\r?\n/)
      .filter((line) => line.trim() !== '')
      .map((line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim()));
    matrix = matrix.filter((cells) => !isSeparatorRow(cells));
  } else {
    matrix = parseDelimited(source, delimiter);
  }

  if (!matrix.length) throw new Error('没有解析出任何表格行');

  const [headers, ...rows] = matrix;
  const alignments = Array.from({ length: headers.length }, () => 'none');

  // Markdown 表格的第二行是分隔行，用来还原对齐方式
  if (delimiter === '|') {
    const separator = source
      .split(/\r?\n/)
      .filter((line) => line.trim() !== '')
      .map((line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim()))
      .find((cells) => isSeparatorRow(cells));
    if (separator) separator.forEach((cell, index) => { alignments[index] = alignmentOf(cell); });
  }

  return normalizeTable({ hasHeader: true, headers, rows, alignments });
}

/** 结构化表格 → CSV / TSV，含必要引号。 */
export function toDelimited(table = {}, delimiter = ',') {
  const { hasHeader, headers, rows } = normalizeTable(table);
  const quote = (value) => {
    const text = String(value ?? '');
    return text.includes(delimiter) || text.includes('"') || /[\r\n]/.test(text)
      ? `"${text.replace(/"/g, '""')}"`
      : text;
  };
  const lines = [];
  if (hasHeader) lines.push(headers.map(quote).join(delimiter));
  for (const row of rows) lines.push(row.map(quote).join(delimiter));
  return lines.join('\n');
}
