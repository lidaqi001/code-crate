/* XML 解析与序列化 —— 纯逻辑层，手写扫描器（不依赖 DOMParser，便于在 Node 下测试）。
 *
 * 映射约定（会在界面上说明）：
 * - 只有文本的元素 → 直接就是字符串（XML 无类型，保持字符串以免丢失前导零等信息）
 * - 含属性或子元素的元素 → 对象，属性写成 @name，纯文本写成 #text
 * - 同名子元素重复出现 → 数组
 * - 顶层保留根元素名，这样 XML → JSON → XML 可以无损往返
 *
 * 安全：不解析 DTD 内部子集，遇到 ENTITY 声明直接报错（防实体展开攻击）。
 */

const NAMED_ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

export function decodeEntities(text) {
  return String(text).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, entity) => {
    if (entity[0] === '#') {
      const isHex = entity[1] === 'x' || entity[1] === 'X';
      const code = Number.parseInt(isHex ? entity.slice(2) : entity.slice(1), isHex ? 16 : 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    const named = NAMED_ENTITIES[entity];
    return named === undefined ? match : named;
  });
}

export function escapeXmlText(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeXmlAttribute(value) {
  return escapeXmlText(value).replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function createFail(source) {
  return (message, index) => {
    const before = source.slice(0, Math.max(0, index));
    const line = before.split('\n').length;
    const column = index - before.lastIndexOf('\n');
    const error = new Error(`${message}（第 ${line} 行，第 ${column} 列）`);
    error.line = line;
    error.column = column;
    throw error;
  };
}

function parseStartTag(source, start, fail) {
  let i = start + 1;
  const nameMatch = /^[A-Za-z_:][\w.:-]*/.exec(source.slice(i));
  if (!nameMatch) fail('标签名不合法', i);
  const name = nameMatch[0];
  i += name.length;

  const attributes = [];

  for (;;) {
    while (i < source.length && /\s/.test(source[i])) i += 1;

    if (i >= source.length) fail(`标签 <${name}> 未闭合`, start);
    if (source[i] === '/' && source[i + 1] === '>') {
      return { name, attributes, selfClosing: true, end: i + 2 };
    }
    if (source[i] === '>') {
      return { name, attributes, selfClosing: false, end: i + 1 };
    }

    const attributeMatch = /^[A-Za-z_:][\w.:-]*/.exec(source.slice(i));
    if (!attributeMatch) fail('属性名不合法', i);
    const attributeName = attributeMatch[0];
    i += attributeName.length;

    while (i < source.length && /\s/.test(source[i])) i += 1;

    let value = '';
    if (source[i] === '=') {
      i += 1;
      while (i < source.length && /\s/.test(source[i])) i += 1;
      const quote = source[i];
      if (quote !== '"' && quote !== "'") fail('属性值必须用引号包裹', i);
      const end = source.indexOf(quote, i + 1);
      if (end < 0) fail('属性值未闭合', i);
      value = decodeEntities(source.slice(i + 1, end));
      i = end + 1;
    }

    attributes.push({ name: attributeName, value });
  }
}

/**
 * 解析 XML 文档。
 * @returns {{rootName:string, value:any}}
 */
export function parseXml(text) {
  const source = String(text ?? '');
  if (source.trim() === '') throw new Error('XML 内容为空');

  const fail = createFail(source);
  let index = 0;
  let root = null;
  const stack = [];

  const appendText = (chunk) => {
    if (!stack.length) return; // 根元素之外的空白忽略
    stack[stack.length - 1].rawText += chunk;
  };

  while (index < source.length) {
    const next = source.indexOf('<', index);

    if (next < 0) {
      appendText(decodeEntities(source.slice(index)));
      break;
    }
    if (next > index) {
      appendText(decodeEntities(source.slice(index, next)));
      index = next;
    }

    if (source.startsWith('<!--', index)) {
      const end = source.indexOf('-->', index + 4);
      if (end < 0) fail('注释未闭合', index);
      index = end + 3;
      continue;
    }

    if (source.startsWith('<![CDATA[', index)) {
      const end = source.indexOf(']]>', index + 9);
      if (end < 0) fail('CDATA 未闭合', index);
      appendText(source.slice(index + 9, end)); // CDATA 内不解析实体
      index = end + 3;
      continue;
    }

    if (source.startsWith('<?', index)) {
      const end = source.indexOf('?>', index + 2);
      if (end < 0) fail('处理指令未闭合', index);
      index = end + 2;
      continue;
    }

    if (/^<!doctype/i.test(source.slice(index, index + 9))) {
      const end = source.indexOf('>', index);
      if (end < 0) fail('DOCTYPE 未闭合', index);
      if (/<!entity/i.test(source.slice(index, end))) {
        fail('出于安全考虑，不支持 DTD 中的 ENTITY 声明', index);
      }
      index = end + 1;
      continue;
    }

    if (source.startsWith('</', index)) {
      const end = source.indexOf('>', index);
      if (end < 0) fail('结束标签未闭合', index);
      const name = source.slice(index + 2, end).trim();
      const open = stack.pop();
      if (!open) fail(`多余的结束标签 </${name}>`, index);
      if (open.name !== name) fail(`标签不匹配：<${open.name}> 与 </${name}>`, index);
      index = end + 1;
      continue;
    }

    const tag = parseStartTag(source, index, fail);
    const node = { name: tag.name, attributes: tag.attributes, children: [], rawText: '' };

    if (stack.length) stack[stack.length - 1].children.push(node);
    else if (root) fail('XML 只能有一个根元素', index);
    else root = node;

    if (!tag.selfClosing) stack.push(node);
    index = tag.end;
  }

  if (stack.length) fail(`标签 <${stack[stack.length - 1].name}> 未闭合`, source.length);
  if (!root) throw new Error('没有找到根元素');

  return { rootName: root.name, value: elementToValue(root) };
}

function elementToValue(node) {
  const text = node.rawText.trim();
  const hasAttributes = node.attributes.length > 0;
  const hasChildren = node.children.length > 0;

  if (!hasAttributes && !hasChildren) return text;

  const result = {};
  for (const attribute of node.attributes) result[`@${attribute.name}`] = attribute.value;
  if (text) result['#text'] = text;

  for (const child of node.children) {
    const childValue = elementToValue(child);
    if (Object.prototype.hasOwnProperty.call(result, child.name)) {
      if (Array.isArray(result[child.name])) result[child.name].push(childValue);
      else result[child.name] = [result[child.name], childValue];
    } else {
      result[child.name] = childValue;
    }
  }

  return result;
}

/** 把解析结果整理成可直接转 JSON 的形式：`{ 根元素名: 内容 }`。 */
export function parseXmlToValue(text) {
  const { rootName, value } = parseXml(text);
  return { [rootName]: value };
}

/* ── 序列化 ───────────────────────────────────────────────── */

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function emitElement(name, value, depth, options, lines) {
  const pad = ' '.repeat(depth * options.indent);

  if (Array.isArray(value)) {
    for (const item of value) emitElement(name, item, depth, options, lines);
    return;
  }

  if (value === null || value === undefined) {
    lines.push(`${pad}<${name}/>`);
    return;
  }

  if (!isPlainObject(value)) {
    lines.push(`${pad}<${name}>${escapeXmlText(String(value))}</${name}>`);
    return;
  }

  const attributeParts = [];
  const children = [];
  let text = null;

  for (const [key, child] of Object.entries(value)) {
    if (key.startsWith(options.attributePrefix) && key.length > options.attributePrefix.length) {
      attributeParts.push(` ${key.slice(options.attributePrefix.length)}="${escapeXmlAttribute(child)}"`);
    } else if (key === '#text') {
      text = child === null || child === undefined ? '' : String(child);
    } else {
      children.push([key, child]);
    }
  }

  const attributes = attributeParts.join('');

  if (!children.length) {
    if (text === null) {
      lines.push(`${pad}<${name}${attributes}/>`);
    } else {
      lines.push(`${pad}<${name}${attributes}>${escapeXmlText(text)}</${name}>`);
    }
    return;
  }

  lines.push(`${pad}<${name}${attributes}>`);
  if (text !== null && text !== '') {
    lines.push(`${' '.repeat((depth + 1) * options.indent)}${escapeXmlText(text)}`);
  }
  for (const [childName, childValue] of children) {
    emitElement(childName, childValue, depth + 1, options, lines);
  }
  lines.push(`${pad}</${name}>`);
}

/**
 * 序列化为 XML。
 * 若顶层对象只有一个键且不是属性/文本，就把它当作根元素名，否则使用 rootName。
 */
export function toXml(value, { rootName = 'root', indent = 2, declaration = false, attributePrefix = '@' } = {}) {
  const options = { indent: Math.max(0, Math.floor(indent)), attributePrefix };

  let name = rootName;
  let content = value;

  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 1 && !keys[0].startsWith(attributePrefix) && keys[0] !== '#text') {
      name = keys[0];
      content = value[keys[0]];
    }
  }

  if (name !== rootName && !/^[A-Za-z_:][\w.:-]*$/.test(name)) {
    throw new Error(`根元素名「${name}」不是合法的 XML 名称`);
  }
  if (!/^[A-Za-z_:][\w.:-]*$/.test(name)) {
    throw new Error(`根元素名「${name}」不是合法的 XML 名称`);
  }

  const lines = [];
  if (declaration) lines.push('<?xml version="1.0" encoding="UTF-8"?>');

  if (Array.isArray(content)) {
    // 顶层数组必须收敛到一个根元素里，否则输出不是合法 XML
    lines.push(`<${name}>`);
    for (const item of content) emitElement('item', item, 1, options, lines);
    lines.push(`</${name}>`);
  } else {
    emitElement(name, content, 0, options, lines);
  }
  return lines.join('\n');
}
