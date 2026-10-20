/* 键盘事件速查 —— 纯逻辑层。
 *
 * 收录开发者常查的按键，同时给出三个字段：
 *   key     —— KeyboardEvent.key（受修饰键与键盘布局影响）
 *   code    —— KeyboardEvent.code（物理按键位置，推荐用它做快捷键）
 *   keyCode —— 已废弃但老代码里仍常见的数字码
 */

const LETTERS = Array.from({ length: 26 }, (_, index) => {
  const upper = String.fromCharCode(65 + index);
  return {
    key: upper.toLowerCase(),
    code: `Key${upper}`,
    keyCode: 65 + index,
    category: '字母',
    note: `${upper} 键`
  };
});

const DIGITS = Array.from({ length: 10 }, (_, index) => ({
  key: String(index),
  code: `Digit${index}`,
  keyCode: 48 + index,
  category: '数字',
  note: `主键盘数字 ${index}`
}));

const NUMPAD = [
  ...Array.from({ length: 10 }, (_, index) => ({
    key: String(index),
    code: `Numpad${index}`,
    keyCode: 96 + index,
    category: '小键盘',
    note: `小键盘 ${index}`
  })),
  { key: '+', code: 'NumpadAdd', keyCode: 107, category: '小键盘', note: '小键盘加号' },
  { key: '-', code: 'NumpadSubtract', keyCode: 109, category: '小键盘', note: '小键盘减号' },
  { key: '*', code: 'NumpadMultiply', keyCode: 106, category: '小键盘', note: '小键盘乘号' },
  { key: '/', code: 'NumpadDivide', keyCode: 111, category: '小键盘', note: '小键盘除号' },
  { key: '.', code: 'NumpadDecimal', keyCode: 110, category: '小键盘', note: '小键盘小数点' },
  { key: 'Enter', code: 'NumpadEnter', keyCode: 13, category: '小键盘', note: '小键盘回车' }
];

const SPECIAL = [
  { key: ' ', code: 'Space', keyCode: 32, category: '编辑', note: '空格' },
  { key: 'Enter', code: 'Enter', keyCode: 13, category: '编辑', note: '回车' },
  { key: 'Escape', code: 'Escape', keyCode: 27, category: '编辑', note: 'Esc' },
  { key: 'Backspace', code: 'Backspace', keyCode: 8, category: '编辑', note: '退格' },
  { key: 'Tab', code: 'Tab', keyCode: 9, category: '编辑', note: '制表符（会切换焦点）' },
  { key: 'Delete', code: 'Delete', keyCode: 46, category: '编辑', note: '删除' },
  { key: 'Insert', code: 'Insert', keyCode: 45, category: '编辑', note: '插入' },
  { key: 'CapsLock', code: 'CapsLock', keyCode: 20, category: '编辑', note: '大写锁定' },
  { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38, category: '导航', note: '方向上' },
  { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, category: '导航', note: '方向下' },
  { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37, category: '导航', note: '方向左' },
  { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, category: '导航', note: '方向右' },
  { key: 'Home', code: 'Home', keyCode: 36, category: '导航', note: '行首' },
  { key: 'End', code: 'End', keyCode: 35, category: '导航', note: '行尾' },
  { key: 'PageUp', code: 'PageUp', keyCode: 33, category: '导航', note: '向上翻页' },
  { key: 'PageDown', code: 'PageDown', keyCode: 34, category: '导航', note: '向下翻页' },
  { key: 'Shift', code: 'ShiftLeft', keyCode: 16, category: '修饰', note: '左 Shift' },
  { key: 'Shift', code: 'ShiftRight', keyCode: 16, category: '修饰', note: '右 Shift' },
  { key: 'Control', code: 'ControlLeft', keyCode: 17, category: '修饰', note: '左 Ctrl' },
  { key: 'Control', code: 'ControlRight', keyCode: 17, category: '修饰', note: '右 Ctrl' },
  { key: 'Alt', code: 'AltLeft', keyCode: 18, category: '修饰', note: '左 Alt' },
  { key: 'Alt', code: 'AltRight', keyCode: 18, category: '修饰', note: '右 Alt' },
  { key: 'Meta', code: 'MetaLeft', keyCode: 91, category: '修饰', note: '左 Meta（⌘ / Win）' },
  { key: 'Meta', code: 'MetaRight', keyCode: 93, category: '修饰', note: '右 Meta' },
  { key: '-', code: 'Minus', keyCode: 189, category: '符号', note: '减号 / 下划线' },
  { key: '=', code: 'Equal', keyCode: 187, category: '符号', note: '等号 / 加号' },
  { key: '[', code: 'BracketLeft', keyCode: 219, category: '符号', note: '左方括号' },
  { key: ']', code: 'BracketRight', keyCode: 221, category: '符号', note: '右方括号' },
  { key: '\\', code: 'Backslash', keyCode: 220, category: '符号', note: '反斜杠' },
  { key: ';', code: 'Semicolon', keyCode: 186, category: '符号', note: '分号' },
  { key: "'", code: 'Quote', keyCode: 222, category: '符号', note: '单引号' },
  { key: '`', code: 'Backquote', keyCode: 192, category: '符号', note: '反引号' },
  { key: ',', code: 'Comma', keyCode: 188, category: '符号', note: '逗号' },
  { key: '.', code: 'Period', keyCode: 190, category: '符号', note: '句点' },
  { key: '/', code: 'Slash', keyCode: 191, category: '符号', note: '斜杠' },
  ...Array.from({ length: 12 }, (_, index) => ({
    key: `F${index + 1}`,
    code: `F${index + 1}`,
    keyCode: 112 + index,
    category: '功能键',
    note: `F${index + 1}`
  })),
  { key: 'PrintScreen', code: 'PrintScreen', keyCode: 44, category: '功能键', note: '截屏' },
  { key: 'ScrollLock', code: 'ScrollLock', keyCode: 145, category: '功能键', note: '滚动锁定' },
  { key: 'Pause', code: 'Pause', keyCode: 19, category: '功能键', note: '暂停' },
  { key: 'ContextMenu', code: 'ContextMenu', keyCode: 93, category: '功能键', note: '右键菜单键' }
];

export const KEY_ENTRIES = [...LETTERS, ...DIGITS, ...NUMPAD, ...SPECIAL];

export const KEY_CATEGORIES = ['字母', '数字', '小键盘', '编辑', '导航', '修饰', '符号', '功能键'];

/** 按关键字搜索：匹配 key / code / keyCode / 说明 / 分类。 */
export function searchKeys(query, { category = '', limit = 200 } = {}) {
  const needle = String(query ?? '').trim().toLowerCase();
  const pool = category ? KEY_ENTRIES.filter((entry) => entry.category === category) : KEY_ENTRIES;
  if (!needle) return pool.slice(0, limit);

  const matched = pool.filter((entry) =>
    entry.key.toLowerCase().includes(needle) ||
    entry.code.toLowerCase().includes(needle) ||
    String(entry.keyCode).includes(needle) ||
    entry.note.toLowerCase().includes(needle) ||
    entry.category.includes(needle)
  );

  // keyCode 完全相等或 code 完全相等时排前面，便于精确查找
  return matched
    .sort((a, b) => score(b, needle) - score(a, needle))
    .slice(0, limit);
}

function score(entry, needle) {
  let value = 0;
  if (entry.code.toLowerCase() === needle) value += 100;
  if (entry.key.toLowerCase() === needle) value += 80;
  if (String(entry.keyCode) === needle) value += 90;
  if (entry.code.toLowerCase().startsWith(needle)) value += 20;
  if (entry.key.toLowerCase().startsWith(needle)) value += 10;
  return value;
}

export function findByCode(code) {
  const source = String(code ?? '');
  return KEY_ENTRIES.find((entry) => entry.code === source) || null;
}

/**
 * 把一次按键事件整理成可读信息。
 * @param {{key:string, code:string, keyCode?:number, ctrlKey?:boolean, shiftKey?:boolean, altKey?:boolean, metaKey?:boolean, repeat?:boolean, location?:number}} event
 */
export function describeKeyPress(event = {}) {
  const modifiers = [];
  if (event.ctrlKey) modifiers.push('Ctrl');
  if (event.altKey) modifiers.push('Alt');
  if (event.shiftKey) modifiers.push('Shift');
  if (event.metaKey) modifiers.push('Meta');

  const rawKey = event.key === undefined ? '' : String(event.key);
  const displayKey = rawKey === ' ' ? 'Space' : rawKey;
  const combo = [...modifiers, displayKey].filter(Boolean).join(' + ');

  const entry = findByCode(event.code);

  return {
    combo,
    key: displayKey,
    code: String(event.code ?? ''),
    keyCode: Number.isFinite(event.keyCode) ? event.keyCode : null,
    category: entry ? entry.category : '未收录',
    note: entry ? entry.note : '这个按键不在速查表里',
    repeat: Boolean(event.repeat)
  };
}

/** 生成用于代码里的判定片段。 */
export function suggestHandler(input) {
  const info = describeKeyPress(input);
  if (!info.code) return '';
  const modifiers = [];
  if (input.ctrlKey || input.metaKey) modifiers.push('(event.ctrlKey || event.metaKey)');
  if (input.shiftKey) modifiers.push('event.shiftKey');
  if (input.altKey) modifiers.push('event.altKey');
  const conditions = [`event.code === '${info.code}'`, ...modifiers];
  return `if (${conditions.join(' && ')}) {\n  event.preventDefault();\n  // 你的处理逻辑\n}`;
}
