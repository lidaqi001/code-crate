import test from 'node:test';
import assert from 'node:assert/strict';

import { parseCsv, toCsv, detectDelimiter, collectKeys } from '../src/tools/converter/csv.js';
import { parseXml, parseXmlToValue, toXml, decodeEntities, escapeXmlText } from '../src/tools/converter/xml.js';
import { parseYaml, toYaml, resolveScalar, stripComment, isPlainSafe, parseQuotedScalar } from '../src/tools/converter/yaml.js';
import { parseToml, toToml, resolveTomlScalar, stripTomlComment } from '../src/tools/converter/toml.js';
import { convert, detectFormat, serialize, parse, FORMATS, FORMAT_HINTS, formatById, describe } from '../src/tools/converter/logic.js';

/* ══════════════════ CSV ══════════════════ */

test('CSV：带表头解析为对象数组', () => {
  const rows = parseCsv('name,age\nAda,36\nLinus,54');
  assert.deepEqual(rows, [
    { name: 'Ada', age: '36' },
    { name: 'Linus', age: '54' }
  ]);
});

test('CSV：不带表头时返回二维数组', () => {
  assert.deepEqual(parseCsv('a,b\nc,d', { header: false }), [['a', 'b'], ['c', 'd']]);
});

test('CSV：引号内的分隔符与换行属于字段内容', () => {
  const rows = parseCsv('a,b\n"x,y","line1\nline2"');
  assert.equal(rows[0].a, 'x,y');
  assert.equal(rows[0].b, 'line1\nline2');
});

test('CSV：连续两个引号表示字面引号', () => {
  const rows = parseCsv('quote\n"say ""hi"""');
  assert.equal(rows[0].quote, 'say "hi"');
});

test('CSV：字段中间的引号是普通字符', () => {
  const rows = parseCsv('a\n5" screen');
  assert.equal(rows[0].a, '5" screen');
});

test('CSV：CRLF、BOM 与结尾换行都能处理', () => {
  const rows = parseCsv('\uFEFFa,b\r\n1,2\r\n');
  assert.deepEqual(rows, [{ a: '1', b: '2' }]);
});

test('CSV：缺列与多列不会串位', () => {
  const rows = parseCsv('a,b,c\n1\n1,2,3,4');
  assert.deepEqual(rows[0], { a: '1', b: '', c: '' });
  assert.deepEqual(rows[1], { a: '1', b: '2', c: '3' });
});

test('CSV：空输入与纯空白', () => {
  assert.deepEqual(parseCsv(''), []);
  assert.deepEqual(parseCsv('   \n  '), []);
});

test('CSV：序列化对象数组会生成表头并按键并集补齐', () => {
  const text = toCsv([{ a: 1, b: 2 }, { a: 3, c: 4 }]);
  assert.equal(text, 'a,b,c\n1,2,\n3,,4');
});

test('CSV：序列化时按需加引号', () => {
  const text = toCsv([{ a: 'x,y', b: 'say "hi"', c: 'line\nbreak' }]);
  assert.equal(text, 'a,b,c\n"x,y","say ""hi""","line\nbreak"');
});

test('CSV：二维数组直接输出', () => {
  assert.equal(toCsv([['a', 'b'], [1, 2]]), 'a,b\n1,2');
});

test('CSV：一维数组当作单列', () => {
  assert.equal(toCsv(['x', 'y']), 'x\ny');
});

test('CSV：对象字段中的嵌套值序列化为 JSON', () => {
  assert.equal(toCsv([{ a: [1, 2] }]), 'a\n"[1,2]"');
});

test('CSV：序列化与解析可往返', () => {
  const value = [{ name: 'a,b', note: 'he said "hi"' }, { name: 'c', note: '' }];
  const parsed = parseCsv(toCsv(value));
  assert.deepEqual(parsed, value);
});

test('CSV：非法输入给出明确错误', () => {
  assert.throws(() => toCsv({ a: 1 }), /需要一个数组/);
  // 真正的「混用」是数组里既有数组又有对象
  assert.throws(() => toCsv([['a'], { b: 1 }]), /类型不一致/);
});

test('CSV：空数组与全空对象', () => {
  assert.equal(toCsv([]), '');
  assert.equal(toCsv([{}, {}]), '');
});

test('CSV：推断分隔符', () => {
  assert.equal(detectDelimiter('a,b\n1,2'), ',');
  assert.equal(detectDelimiter('a\tb\n1\t2'), '\t');
  assert.equal(detectDelimiter('a;b\n1;2'), ';');
  assert.equal(detectDelimiter('single'), ',');
});

test('CSV：collectKeys 按首次出现顺序去重', () => {
  assert.deepEqual(collectKeys([{ b: 1, a: 2 }, { c: 3, a: 4 }]), ['b', 'a', 'c']);
});

test('CSV：引号内的分隔符不参与分隔符推断', () => {
  assert.equal(detectDelimiter('"a,b";c\n"x,y";z'), ';');
});

/* ══════════════════ XML ══════════════════ */

test('XML：纯文本元素直接变成字符串', () => {
  assert.deepEqual(parseXmlToValue('<name>Ada</name>'), { name: 'Ada' });
});

test('XML：属性写成 @name', () => {
  assert.deepEqual(parseXmlToValue('<user id="1" role="admin">Ada</user>'), {
    user: { '@id': '1', '@role': 'admin', '#text': 'Ada' }
  });
});

test('XML：同名子元素重复出现变成数组', () => {
  assert.deepEqual(parseXmlToValue('<list><item>a</item><item>b</item></list>'), {
    list: { item: ['a', 'b'] }
  });
});

test('XML：多个不同子元素', () => {
  assert.deepEqual(parseXmlToValue('<p><a>1</a><b>2</b></p>'), { p: { a: '1', b: '2' } });
});

test('XML：自闭合标签', () => {
  assert.deepEqual(parseXmlToValue('<root><empty/></root>'), { root: { empty: '' } });
});

test('XML：忽略声明、注释与 DOCTYPE', () => {
  const xml = '<?xml version="1.0"?>\n<!-- 注释 -->\n<!DOCTYPE root>\n<root><a>1</a></root>';
  assert.deepEqual(parseXmlToValue(xml), { root: { a: '1' } });
});

test('XML：CDATA 内容原样保留，不解析实体', () => {
  assert.deepEqual(parseXmlToValue('<code><![CDATA[if (a < b && c > d)]]></code>'), {
    code: 'if (a < b && c > d)'
  });
});

test('XML：实体解码', () => {
  assert.equal(decodeEntities('&lt;a&gt; &amp; &quot;x&quot; &#65; &#x4e2d;'), '<a> & "x" A 中');
  assert.deepEqual(parseXmlToValue('<t>a &amp; b</t>'), { t: 'a & b' });
});

test('XML：嵌套结构', () => {
  assert.deepEqual(parseXmlToValue('<r><user><name>a</name><tags><t>x</t></tags></user></r>'), {
    r: { user: { name: 'a', tags: { t: 'x' } } }
  });
});

test('XML：属性与文本同时存在时保留 #text', () => {
  assert.deepEqual(parseXmlToValue('<a href="x">链接</a>'), { a: { '@href': 'x', '#text': '链接' } });
});

test('XML：只保留有内容的文本，空白被裁掉', () => {
  assert.deepEqual(parseXmlToValue('<r>\n  <a>1</a>\n</r>'), { r: { a: '1' } });
});

test('XML：语法错误给出带行列号的提示', () => {
  assert.throws(() => parseXml('<a>'), /未闭合/);
  assert.throws(() => parseXml('<a></b>'), /标签不匹配/);
  assert.throws(() => parseXml('<a/><b/>'), /只能有一个根元素/);
  assert.throws(() => parseXml('</a>'), /多余的结束标签/);
  assert.throws(() => parseXml(''), /为空/);
  try {
    parseXml('<a>\n<b>\n</a>');
    assert.fail('应当报错');
  } catch (error) {
    assert.match(error.message, /第 3 行|标签不匹配/);
  }
});

test('XML：拒绝 DTD 中的 ENTITY 声明', () => {
  assert.throws(() => parseXml('<!DOCTYPE r [<!ENTITY x "y">]><r/>'), /ENTITY/);
});

test('XML：序列化对象（含属性与子元素）', () => {
  const xml = toXml({ user: { '@id': '1', name: 'Ada', tags: { t: ['x', 'y'] } } });
  assert.equal(
    xml,
    ['<user id="1">', '  <name>Ada</name>', '  <tags>', '    <t>x</t>', '    <t>y</t>', '  </tags>', '</user>'].join('\n')
  );
});

test('XML：序列化时转义文本与属性', () => {
  const xml = toXml({ a: { '@t': 'x"y<z>', '#text': '5 < 6 & 7 > 4' } });
  assert.equal(xml, '<a t="x&quot;y&lt;z&gt;">5 &lt; 6 &amp; 7 &gt; 4</a>');
});

test('XML：空值与空对象序列化为自闭合标签', () => {
  assert.equal(toXml({ a: null }), '<a/>');
  assert.equal(toXml({ a: {} }), '<a/>');
});

test('XML：顶层多键时使用给定根名', () => {
  assert.equal(toXml({ a: '1', b: '2' }, { rootName: 'root', indent: 0 }), '<root>\n<a>1</a>\n<b>2</b>\n</root>');
});

test('XML：可输出声明行', () => {
  assert.match(toXml({ a: '1' }, { declaration: true }), /^<\?xml version="1.0"/);
});

test('XML：非法根名报错，顶层数组报错', () => {
  // 单键对象会用自己的键当根名，因此用多键对象来验证 rootName 校验
  assert.throws(() => toXml({ a: '1', b: '2' }, { rootName: '1bad' }), /合法的 XML 名称/);
  assert.equal(toXml([{ a: 1 }], { indent: 0 }), '<root>\n<item>\n<a>1</a>\n</item>\n</root>');
});

test('XML：解析与序列化可往返', () => {
  const source = '<root><user id="1"><name>Ada</name><tag>x</tag><tag>y</tag></user></root>';
  const value = parseXmlToValue(source);
  const again = toXml(value, { indent: 0 });
  assert.deepEqual(parseXmlToValue(again), value);
});

test('XSS：XML 文本不会被当作标签解析', () => {
  assert.deepEqual(parseXmlToValue('<t>&lt;script&gt;alert(1)&lt;/script&gt;</t>'), {
    t: '<script>alert(1)</script>'
  });
  const xml = toXml({ t: '<script>alert(1)</script>' });
  assert.equal(xml.includes('<script>'), false);
  assert.match(xml, /&lt;script&gt;/);
});

/* ══════════════════ YAML ══════════════════ */

test('YAML：标量类型解析（1.2 core schema）', () => {
  assert.equal(resolveScalar('42'), 42);
  assert.equal(resolveScalar('-7'), -7);
  assert.equal(resolveScalar('3.14'), 3.14);
  assert.equal(resolveScalar('1e3'), 1000);
  assert.equal(resolveScalar('0x1f'), 31);
  assert.equal(resolveScalar('true'), true);
  assert.equal(resolveScalar('false'), false);
  assert.equal(resolveScalar('null'), null);
  assert.equal(resolveScalar('~'), null);
  assert.equal(resolveScalar(''), null);
  assert.equal(resolveScalar('hello'), 'hello');
});

test('YAML：yes/no 与 on/off 是字符串，不是布尔（避免 Norway 问题）', () => {
  assert.equal(resolveScalar('yes'), 'yes');
  assert.equal(resolveScalar('no'), 'no');
  assert.equal(resolveScalar('on'), 'on');
  assert.equal(resolveScalar('off'), 'off');
  assert.equal(resolveScalar('NO'), 'NO');
  assert.deepEqual(parseYaml('country: NO'), { country: 'NO' });
});

test('YAML：保留前导零的数字当字符串', () => {
  assert.deepEqual(parseYaml('zip: 007'), { zip: 7 });
  // 想保留前导零需要引号
  assert.deepEqual(parseYaml('zip: "007"'), { zip: '007' });
});

test('YAML：块映射与嵌套', () => {
  assert.deepEqual(parseYaml('a: 1\nb:\n  c: 2\n  d: 3'), { a: 1, b: { c: 2, d: 3 } });
});

test('YAML：序列', () => {
  assert.deepEqual(parseYaml('- a\n- b\n- c'), ['a', 'b', 'c']);
  assert.deepEqual(parseYaml('- 1\n- 2'), [1, 2]);
});

test('YAML：序列中的映射', () => {
  assert.deepEqual(parseYaml('- name: a\n  age: 1\n- name: b\n  age: 2'), [
    { name: 'a', age: 1 },
    { name: 'b', age: 2 }
  ]);
});

test('YAML：映射中的序列', () => {
  assert.deepEqual(parseYaml('tags:\n  - x\n  - y'), { tags: ['x', 'y'] });
});

test('YAML：嵌套序列', () => {
  assert.deepEqual(parseYaml('- - 1\n  - 2\n- - 3'), [[1, 2], [3]]);
});

test('YAML：映射中的空值', () => {
  assert.deepEqual(parseYaml('a:\nb: 1'), { a: null, b: 1 });
});

test('YAML：流式数组与对象', () => {
  assert.deepEqual(parseYaml('a: [1, 2, 3]'), { a: [1, 2, 3] });
  assert.deepEqual(parseYaml('a: {x: 1, y: 2}'), { a: { x: 1, y: 2 } });
  assert.deepEqual(parseYaml('a: [[1, 2], [3]]'), { a: [[1, 2], [3]] });
  assert.deepEqual(parseYaml('a: {b: {c: 1}}'), { a: { b: { c: 1 } } });
});

test('YAML：跨行的流式集合', () => {
  assert.deepEqual(parseYaml('a: [1,\n  2,\n  3]'), { a: [1, 2, 3] });
});

test('YAML：带引号的字符串', () => {
  assert.deepEqual(parseYaml("a: 'it''s'"), { a: "it's" });
  assert.deepEqual(parseYaml('a: "line\\nbreak"'), { a: 'line\nbreak' });
  assert.deepEqual(parseYaml('a: "tab\\there"'), { a: 'tab\there' });
  assert.deepEqual(parseYaml('"key with space": 1'), { 'key with space': 1 });
  // 引号内不会被当作注释或类型
  assert.deepEqual(parseYaml('a: "# not comment"'), { a: '# not comment' });
  assert.deepEqual(parseYaml('a: "123"'), { a: '123' });
});

test('YAML：注释被忽略', () => {
  const value = parseYaml('# 头部注释\na: 1 # 行尾注释\n# 中间注释\nb: 2');
  assert.deepEqual(value, { a: 1, b: 2 });
});

test('YAML：井号在引号内或词中不算注释', () => {
  assert.equal(stripComment('a: 1 # c'), 'a: 1 ');
  assert.equal(stripComment('a: "x # y"'), 'a: "x # y"');
  assert.equal(stripComment('a: x#y'), 'a: x#y');
});

test('YAML：字面块 | 保留换行', () => {
  assert.deepEqual(parseYaml('text: |\n  line1\n  line2'), { text: 'line1\nline2\n' });
});

test('YAML：折叠块 > 把换行折叠为空格', () => {
  assert.deepEqual(parseYaml('text: >\n  line1\n  line2'), { text: 'line1 line2\n' });
});

test('YAML：块标量的 chomping 指示符', () => {
  assert.deepEqual(parseYaml('t: |-\n  a\n  b'), { t: 'a\nb' });
  assert.deepEqual(parseYaml('t: |\n  a\n  b'), { t: 'a\nb\n' });
  assert.deepEqual(parseYaml('t: |+\n  a\n\n'), { t: 'a\n\n' });
});

test('YAML：块标量后的后续键仍能解析', () => {
  assert.deepEqual(parseYaml('t: |\n  a\n  b\nn: 1'), { t: 'a\nb\n', n: 1 });
});

test('YAML：文档起始标记 --- 被接受', () => {
  assert.deepEqual(parseYaml('---\na: 1'), { a: 1 });
});

test('YAML：不支持的特性给出明确报错', () => {
  assert.throws(() => parseYaml('a: &anchor 1'), /锚点/);
  assert.throws(() => parseYaml('a: *alias'), /别名|锚点/);
  assert.throws(() => parseYaml('a: !!str 1'), /标签/);
  assert.throws(() => parseYaml('\ta: 1'), /制表符/);
  assert.throws(() => parseYaml('? complex\n: 1'), /复杂键/);
  assert.throws(() => parseYaml('a: 1\n...\nb: 2'), /多文档|期望/);
});

test('YAML：空输入返回 null', () => {
  assert.equal(parseYaml(''), null);
  assert.equal(parseYaml('   \n  '), null);
  assert.equal(parseYaml('# 只有注释'), null);
});

test('YAML：顶层的字符串与数字', () => {
  assert.equal(parseYaml('hello'), 'hello');
  assert.equal(parseYaml('42'), 42);
});

test('YAML：序列化基本类型与嵌套', () => {
  assert.equal(toYaml({ a: 1, b: 'x' }), 'a: 1\nb: x\n');
  assert.equal(toYaml({ a: { b: 1 } }), 'a:\n  b: 1\n');
  assert.equal(toYaml({ list: [1, 2] }), 'list:\n  - 1\n  - 2\n');
});

test('YAML：序列化对象数组使用紧凑写法', () => {
  assert.equal(toYaml([{ name: 'a', age: 1 }]), '- name: a\n  age: 1\n');
});

test('YAML：序列化空集合', () => {
  assert.equal(toYaml({ a: [], b: {} }), 'a: []\nb: {}\n');
});

test('YAML：序列化时给有歧义的字符串加引号', () => {
  assert.equal(toYaml({ a: 'true' }), 'a: "true"\n');
  assert.equal(toYaml({ a: '123' }), 'a: "123"\n');
  assert.equal(toYaml({ a: 'null' }), 'a: "null"\n');
  assert.equal(toYaml({ a: 'x: y' }), 'a: "x: y"\n');
  assert.equal(toYaml({ a: '- dash' }), 'a: "- dash"\n');
  assert.equal(toYaml({ a: '# hash' }), 'a: "# hash"\n');
  assert.equal(toYaml({ a: 'yes' }), 'a: yes\n'); // 1.2 core 里 yes 是普通字符串
});

test('YAML：序列化多行字符串使用字面块', () => {
  assert.equal(toYaml({ a: 'line1\nline2' }), 'a: |-\n  line1\n  line2\n');
});

test('YAML：isPlainSafe 判断', () => {
  assert.equal(isPlainSafe('hello'), true);
  assert.equal(isPlainSafe('hello world'), true);
  assert.equal(isPlainSafe(''), false);
  assert.equal(isPlainSafe(' leading'), false);
  assert.equal(isPlainSafe('trailing '), false);
  assert.equal(isPlainSafe('a: b'), false);
  assert.equal(isPlainSafe('true'), false);
});

test('YAML：解析与序列化可往返', () => {
  const value = {
    name: 'codecrate',
    version: 2,
    enabled: true,
    nothing: null,
    tags: ['a', 'b'],
    nested: { deep: { level: 3 } },
    list: [{ id: 1, label: 'x' }, { id: 2, label: 'y' }],
    tricky: ['true', '123', 'a: b', '- dash']
  };
  assert.deepEqual(parseYaml(toYaml(value)), value);
});

test('YAML：parseQuotedScalar 处理转义', () => {
  assert.equal(parseQuotedScalar('"a\\nb"', 0), 'a\nb');
  assert.equal(parseQuotedScalar("'a''b'", 0), "a'b");
  assert.equal(parseQuotedScalar('"\\u4e2d"', 0), '中');
  assert.throws(() => parseQuotedScalar('"unclosed', 0), /未闭合/);
});

/* ══════════════════ TOML ══════════════════ */

test('TOML：基本键值与类型', () => {
  const value = parseToml([
    'title = "TOML 示例"',
    'count = 42',
    'negative = -7',
    'big = 1_000_000',
    'hex = 0xFF',
    'oct = 0o755',
    'bin = 0b1010',
    'pi = 3.14',
    'exp = 5e2',
    'enabled = true',
    'disabled = false'
  ].join('\n'));
  assert.deepEqual(value, {
    title: 'TOML 示例',
    count: 42,
    negative: -7,
    big: 1000000,
    hex: 255,
    oct: 493,
    bin: 10,
    pi: 3.14,
    exp: 500,
    enabled: true,
    disabled: false
  });
});

test('TOML：字符串的四种写法', () => {
  const value = parseToml([
    'basic = "a\\nb"',
    "literal = 'C:\\path'",
    'multi = """',
    'line1',
    'line2"""',
    "multiLiteral = '''",
    'raw \\n here',
    "'''"
  ].join('\n'));
  assert.equal(value.basic, 'a\nb');
  assert.equal(value.literal, 'C:\\path');
  assert.equal(value.multi, 'line1\nline2');
  // 结束定界符独占一行时，它前面的那个换行属于内容
  assert.equal(value.multiLiteral, 'raw \\n here\n');
});

test('TOML：日期时间按字符串返回', () => {
  const value = parseToml('d = 1979-05-27\nt = 07:32:00\ndt = 1979-05-27T07:32:00Z');
  assert.equal(value.d, '1979-05-27');
  assert.equal(value.t, '07:32:00');
  assert.equal(value.dt, '1979-05-27T07:32:00Z');
});

test('TOML：数组与嵌套数组', () => {
  assert.deepEqual(parseToml('a = [1, 2, 3]'), { a: [1, 2, 3] });
  assert.deepEqual(parseToml('a = [[1, 2], [3]]'), { a: [[1, 2], [3]] });
  assert.deepEqual(parseToml('a = ["x", "y"]'), { a: ['x', 'y'] });
});

test('TOML：可跨行的数组与尾随逗号', () => {
  assert.deepEqual(parseToml('a = [\n  1,\n  2,\n]'), { a: [1, 2] });
});

test('TOML：内联表', () => {
  assert.deepEqual(parseToml('p = { x = 1, y = "z" }'), { p: { x: 1, y: 'z' } });
  assert.deepEqual(parseToml('p = { a = { b = 1 } }'), { p: { a: { b: 1 } } });
});

test('TOML：表与嵌套表', () => {
  const value = parseToml('[server]\nhost = "a"\n\n[server.tls]\nenabled = true');
  assert.deepEqual(value, { server: { host: 'a', tls: { enabled: true } } });
});

test('TOML：数组表', () => {
  const value = parseToml('[[item]]\nname = "a"\n\n[[item]]\nname = "b"');
  assert.deepEqual(value, { item: [{ name: 'a' }, { name: 'b' }] });
});

test('TOML：点分键与带引号的键', () => {
  assert.deepEqual(parseToml('a.b.c = 1'), { a: { b: { c: 1 } } });
  assert.deepEqual(parseToml('"key with space" = 1'), { 'key with space': 1 });
  assert.deepEqual(parseToml('"a.b" = 1'), { 'a.b': 1 });
});

test('TOML：注释被忽略', () => {
  const value = parseToml('# 头部\nkey = 1 # 行尾\n# 中间\nother = 2');
  assert.deepEqual(value, { key: 1, other: 2 });
});

test('TOML：字符串里的井号不是注释', () => {
  assert.deepEqual(parseToml('a = "x # y"'), { a: 'x # y' });
});

test('TOML：空文档返回空对象', () => {
  assert.deepEqual(parseToml(''), {});
  assert.deepEqual(parseToml('# 只有注释\n\n'), {});
});

test('TOML：语法错误给出带行号的提示', () => {
  assert.throws(() => parseToml('a'), /期望 key = value/);
  assert.throws(() => parseToml('a = 1\na = 2'), /重复定义/);
  assert.throws(() => parseToml('a = "unclosed'), /未闭合/);
  assert.throws(() => parseToml('a = [1, 2'), /未闭合/);
  assert.throws(() => parseToml('[a\nb = 1'), /表头未闭合/);
  assert.throws(() => parseToml('a = @bad'), /无法识别的值/);
  assert.throws(() => parseToml('a = 1\na.b = 2'), /已经被占用/);
});

test('TOML：序列化标量', () => {
  assert.equal(toToml({ a: 1, b: 'x', c: true }), 'a = 1\nb = "x"\nc = true\n');
});

test('TOML：序列化把子表放在标量之后', () => {
  const text = toToml({ name: 'x', table: { a: 1 } });
  assert.equal(text, 'name = "x"\n\n[table]\na = 1\n');
});

test('TOML：序列化嵌套表与数组表', () => {
  const text = toToml({ server: { tls: { on: true } }, item: [{ n: 1 }, { n: 2 }] });
  assert.match(text, /\[server\.tls\]/);
  assert.match(text, /\[\[item\]\]/);
  assert.equal((text.match(/\[\[item\]\]/g) || []).length, 2);
});

test('TOML：序列化数组与内联表', () => {
  assert.equal(toToml({ a: [1, 2] }), 'a = [1, 2]\n');
  assert.equal(toToml({ a: { b: [1, 2] } }), '[a]\nb = [1, 2]\n');
});

test('TOML：序列化多行字符串', () => {
  assert.equal(toToml({ a: 'line1\nline2' }), 'a = """\nline1\nline2"""\n');
  assert.deepEqual(parseToml(toToml({ a: 'line1\nline2' })), { a: 'line1\nline2' });
});

test('TOML：序列化带引号的键', () => {
  assert.equal(toToml({ 'a b': 1 }), '"a b" = 1\n');
});

test('TOML：null 会明确报错并指出位置', () => {
  assert.throws(() => toToml({ a: null }), /不支持 null.*a/);
  assert.throws(() => toToml({ t: { a: null } }), /不支持 null.*t\.a/);
});

test('TOML：顶层必须是对象', () => {
  assert.throws(() => toToml([1, 2]), /顶层必须是一个对象/);
  assert.throws(() => toToml('x'), /顶层必须是一个对象/);
});

test('TOML：解析与序列化可往返', () => {
  const value = {
    title: 'demo',
    count: 3,
    ratio: 0.5,
    enabled: true,
    tags: ['a', 'b'],
    server: { host: 'localhost', port: 8080, tls: { on: false } },
    items: [{ id: 1, name: 'x' }, { id: 2, name: 'y' }],
    inline: { nested: { deep: 1 } }
  };
  assert.deepEqual(parseToml(toToml(value)), value);
});

test('TOML：非有限数字', () => {
  assert.equal(resolveTomlScalar('inf', 0, () => {}), Infinity);
  assert.equal(resolveTomlScalar('-inf', 0, () => {}), -Infinity);
  assert.ok(Number.isNaN(resolveTomlScalar('nan', 0, () => {})));
});

/* ══════════════════ 编排层：识别与互转 ══════════════════ */

test('识别：JSON', () => {
  assert.equal(detectFormat('{"a": 1}'), 'json');
  assert.equal(detectFormat('[1, 2, 3]'), 'json');
  assert.equal(detectFormat('  {\n  "a": 1\n}'), 'json');
});

test('识别：XML', () => {
  assert.equal(detectFormat('<root><a>1</a></root>'), 'xml');
  assert.equal(detectFormat('<?xml version="1.0"?>\n<r/>'), 'xml');
});

test('识别：TOML', () => {
  assert.equal(detectFormat('[server]\nhost = "a"'), 'toml');
  assert.equal(detectFormat('a = 1\nb = 2'), 'toml');
  assert.equal(detectFormat('[[item]]\nname = "a"'), 'toml');
});

test('识别：YAML', () => {
  assert.equal(detectFormat('a: 1\nb: 2'), 'yaml');
  assert.equal(detectFormat('- a\n- b'), 'yaml');
  assert.equal(detectFormat('a:\n  b: 1'), 'yaml');
});

test('识别：CSV 与 TSV', () => {
  assert.equal(detectFormat('a,b,c\n1,2,3\n4,5,6'), 'csv');
  assert.equal(detectFormat('a\tb\n1\t2\n3\t4'), 'tsv');
});

test('识别：空输入默认 JSON', () => {
  assert.equal(detectFormat(''), 'json');
});

test('互转：JSON → YAML → JSON', () => {
  const source = '{"name":"x","tags":["a","b"],"nested":{"k":1}}';
  const yaml = convert(source, 'json', 'yaml');
  assert.equal(yaml.ok, true);
  const back = convert(yaml.output, 'yaml', 'json');
  assert.equal(back.ok, true);
  assert.deepEqual(JSON.parse(back.output), JSON.parse(source));
});

test('互转：JSON → TOML → JSON', () => {
  const source = JSON.stringify({ title: 'x', server: { host: 'a', port: 80 }, items: [{ id: 1 }] });
  const toml = convert(source, 'json', 'toml');
  assert.equal(toml.ok, true);
  const back = convert(toml.output, 'toml', 'json');
  assert.deepEqual(JSON.parse(back.output), JSON.parse(source));
});

test('互转：JSON → XML → JSON', () => {
  const source = '{"user":{"@id":"1","name":"Ada","tag":["x","y"]}}';
  const xml = convert(source, 'json', 'xml');
  assert.equal(xml.ok, true);
  assert.match(xml.output, /<user id="1">/);
  const back = convert(xml.output, 'xml', 'json');
  assert.deepEqual(JSON.parse(back.output), JSON.parse(source));
});

test('互转：CSV → JSON → CSV', () => {
  const source = 'name,note\n"a,b","say ""hi"""';
  const asJson = convert(source, 'csv', 'json');
  assert.equal(asJson.ok, true);
  assert.deepEqual(JSON.parse(asJson.output), [{ name: 'a,b', note: 'say "hi"' }]);
  const back = convert(asJson.output, 'json', 'csv');
  assert.equal(back.output, source);
});

test('互转：YAML → CSV（对象数组）', () => {
  const source = '- name: a\n  age: 1\n- name: b\n  age: 2';
  const csv = convert(source, 'yaml', 'csv');
  assert.equal(csv.ok, true);
  assert.equal(csv.output, 'name,age\na,1\nb,2');
});

test('互转：数组转 XML 收敛到单一根元素', () => {
  const result = convert('[{"id":1},{"id":2}]', 'json', 'xml', { rootName: 'rows' });
  assert.equal(result.ok, true);
  assert.ok(result.output.startsWith('<rows>'));
  assert.equal((result.output.match(/<item>/g) || []).length, 2);
  // 输出必须能被自己解析回来（此前是多根，直接报错）
  const back = convert(result.output, 'xml', 'json');
  assert.equal(back.ok, true, back.error);
});

test('CSV：自动识别分号与竖线分隔符', () => {
  assert.deepEqual(JSON.parse(convert('a;b\n1;2', 'csv', 'json', { autoDetect: true }).output), [{ a: '1', b: '2' }]);
  assert.deepEqual(JSON.parse(convert('a|b\n1|2', 'csv', 'json', { autoDetect: true }).output), [{ a: '1', b: '2' }]);
});

test('YAML：解析无缩进的块序列', () => {
  assert.deepEqual(parseYaml('key:\n- a\n- b'), { key: ['a', 'b'] });
  assert.deepEqual(parseYaml('list:\n- x\n- y\nother: 1'), { list: ['x', 'y'], other: 1 });
});

test('YAML：首行以空格开头的块标量可往返', () => {
  const value = { a: ' line1\nline2' };
  assert.deepEqual(parseYaml(toYaml(value)), value);
  const seq = { list: [' one\ntwo'] };
  assert.deepEqual(parseYaml(toYaml(seq)), seq);
});

test('TOML：多行字符串保留 # 且可往返', () => {
  const parsed = parseToml('msg = """\nline one # text\nline two\n"""');
  assert.equal(parsed.msg, 'line one # text\nline two\n');
  assert.deepEqual(parseToml(toToml({ s: 'line1\nline2' })), { s: 'line1\nline2' });
});

test('互转：同格式会按当前缩进重新格式化', () => {
  const result = convert('{"a":1}', 'json', 'json');
  assert.equal(result.ok, true);
  assert.equal(result.output, '{\n  "a": 1\n}');

  const compact = convert('{\n  "a": 1\n}', 'json', 'json', { indent: 0 });
  assert.equal(compact.output, '{"a":1}');
});

test('互转：同格式遇到非法内容仍然报错', () => {
  const result = convert('{bad}', 'json', 'json');
  assert.equal(result.ok, false);
  assert.match(result.error, /解析 JSON 失败/);
});

test('互转：空输入报错', () => {
  const result = convert('   ', 'json', 'yaml');
  assert.equal(result.ok, false);
  assert.match(result.error, /输入为空/);
});

test('互转：错误信息带上具体格式名与原因', () => {
  const bad = convert('{bad json}', 'json', 'yaml');
  assert.equal(bad.ok, false);
  assert.match(bad.error, /解析 JSON 失败/);

  const tomlFail = convert('{"a":null}', 'json', 'toml');
  assert.equal(tomlFail.ok, false);
  assert.match(tomlFail.error, /生成 TOML 失败/);
  assert.match(tomlFail.error, /null/);

  const csvFail = convert('{"a":1}', 'json', 'csv');
  assert.equal(csvFail.ok, false);
  assert.match(csvFail.error, /生成 CSV 失败/);
});

test('互转：JSON 拒绝 YAML 里的 .inf', () => {
  const result = convert('a: .inf', 'yaml', 'json');
  assert.equal(result.ok, false);
  assert.match(result.error, /JSON/);
});

test('互转：缩进选项生效', () => {
  const four = convert('{"a":{"b":1}}', 'json', 'json', { indent: 4 });
  // 第二层是 8 个空格，直接与标准序列化结果对比
  assert.equal(four.output, JSON.stringify({ a: { b: 1 } }, null, 4));

  // indent 传 0 表示压缩输出
  const compact = convert('{\n  "a": 1\n}', 'json', 'json', { indent: 0 });
  assert.equal(compact.output, '{"a":1}');

  // 不传 indent 时默认 2 空格美化
  const pretty = convert('{"a":1}', 'json', 'json');
  assert.equal(pretty.output, '{\n  "a": 1\n}');
});

test('互转：XML 根元素名与声明选项', () => {
  const result = convert('{"a":1,"b":2}', 'json', 'xml', { rootName: 'config', declaration: true, indent: 2 });
  assert.match(result.output, /^<\?xml version="1\.0"/);
  assert.match(result.output, /<config>/);
});

test('互转：CSV 分隔符选项', () => {
  const result = convert('[{"a":1,"b":2}]', 'json', 'csv', { delimiter: ';' });
  assert.equal(result.output, 'a;b\n1;2');
});

test('FORMATS 与 FORMAT_HINTS 覆盖一致', () => {
  assert.equal(FORMATS.length, 6);
  for (const format of FORMATS) {
    assert.ok(FORMAT_HINTS[format.id], format.id);
    assert.ok(format.extension);
  }
  assert.equal(formatById('yaml').label, 'YAML');
  assert.equal(formatById('nope'), null);
});

test('describe 统计行数与字符数', () => {
  assert.deepEqual(describe('a\nb\nc'), { lines: 3, characters: 5 });
  assert.deepEqual(describe(''), { lines: 0, characters: 0 });
});

test('拒绝原型污染键名', () => {
  for (const source of [
    '__proto__.polluted = 1',
    '[__proto__.polluted]\nvalue = 1',
    'constructor.prototype.x = 1',
    'safe = { prototype = 1 }'
  ]) {
    assert.throws(() => parseToml(source), /不允许的键名/, source);
  }
  assert.equal({}.polluted, undefined);
});
