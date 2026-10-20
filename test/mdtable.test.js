import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_COLUMNS,
  normalizeTable,
  escapeCell,
  buildMarkdown,
  parseDelimited,
  detectDelimiter,
  parseTableText,
  toDelimited
} from '../src/tools/mdtable/logic.js';

const table = {
  hasHeader: true,
  headers: ['名称', '数量'],
  rows: [['苹果', '3'], ['香蕉', '5']],
  alignments: ['left', 'right']
};

test('生成标准 Markdown 表格', () => {
  assert.equal(
    buildMarkdown(table),
    ['| 名称 | 数量 |', '| :--- | ---: |', '| 苹果 | 3 |', '| 香蕉 | 5 |'].join('\n')
  );
});

test('对齐标记', () => {
  const markdown = buildMarkdown({
    headers: ['a', 'b', 'c', 'd'],
    rows: [['1', '2', '3', '4']],
    alignments: ['none', 'left', 'center', 'right']
  });
  assert.ok(markdown.split('\n')[1] === '| --- | :--- | :---: | ---: |');
});

test('管道符与换行被转义', () => {
  assert.equal(escapeCell('a|b'), 'a\\|b');
  assert.equal(escapeCell('a\nb'), 'a<br>b');
  const markdown = buildMarkdown({ headers: ['a|b'], rows: [['c\nd']] });
  assert.ok(markdown.includes('a\\|b'));
  assert.ok(markdown.includes('c<br>d'));
});

test('行长度不齐时补齐到最宽的一行', () => {
  const normalized = normalizeTable({ headers: ['a', 'b', 'c'], rows: [['1'], ['1', '2', '3', '4']] });
  assert.deepEqual(normalized.headers, ['a', 'b', 'c', '']);
  assert.deepEqual(normalized.rows, [['1', '', '', ''], ['1', '2', '3', '4']]);
  assert.deepEqual(normalized.alignments, ['none', 'none', 'none', 'none']);
});

test('列数上限', () => {
  const wide = normalizeTable({ headers: Array.from({ length: 40 }, (_, i) => String(i)), rows: [] });
  assert.equal(wide.headers.length, MAX_COLUMNS);
});

test('无表头时生成空表头行', () => {
  const markdown = buildMarkdown({ hasHeader: false, headers: ['a', 'b'], rows: [['1', '2']] });
  assert.equal(markdown.split('\n')[0], '|  |  |');
});

test('CSV 引号、逗号与换行解析', () => {
  const rows = parseDelimited('a,"b,c","d""e"\n1,"line\nbreak",3', ',');
  assert.deepEqual(rows, [['a', 'b,c', 'd"e'], ['1', 'line\nbreak', '3']]);
});

test('TSV 解析与分隔符检测', () => {
  assert.equal(detectDelimiter('a\tb\tc'), '\t');
  assert.equal(detectDelimiter('a,b,c'), ',');
  assert.equal(detectDelimiter('| a | b |'), '|');
  assert.deepEqual(parseDelimited('a\tb\n1\t2', '\t'), [['a', 'b'], ['1', '2']]);
});

test('解析 Markdown 表格并还原对齐', () => {
  const parsed = parseTableText('| 名称 | 数量 |\n| :--- | ---: |\n| 苹果 | 3 |');
  assert.deepEqual(parsed.headers, ['名称', '数量']);
  assert.deepEqual(parsed.rows, [['苹果', '3']]);
  assert.deepEqual(parsed.alignments, ['left', 'right']);
});

test('解析 CSV 时首行作为表头', () => {
  const parsed = parseTableText('a,b\n1,2');
  assert.deepEqual(parsed.headers, ['a', 'b']);
  assert.deepEqual(parsed.rows, [['1', '2']]);
  assert.deepEqual(parsed.alignments, ['none', 'none']);
});

test('导出 CSV 时按需加引号', () => {
  const csv = toDelimited({ headers: ['a,b', 'c'], rows: [['say "hi"', 'ok']] });
  assert.equal(csv, '"a,b",c\n"say ""hi""",ok');
});

test('空内容抛错', () => {
  assert.throws(() => parseTableText('   '), /没有可导入/);
});
