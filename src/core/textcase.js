/* 共享的命名风格 / 大小写转换工具。
   被编解码工具与文本工具共同使用，避免同一段逻辑在多个工具里各写一份。 */

export function splitWords(text) {
  return String(text)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
}

export function toSnakeCase(text) {
  return splitWords(text).map((word) => word.toLowerCase()).join('_');
}

export function toKebabCase(text) {
  return splitWords(text).map((word) => word.toLowerCase()).join('-');
}

export function toCamelCase(text) {
  return splitWords(text)
    .map((word, index) => (index === 0 ? word.toLowerCase() : word[0].toUpperCase() + word.slice(1).toLowerCase()))
    .join('');
}

export function toPascalCase(text) {
  return splitWords(text)
    .map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase())
    .join('');
}

export function toConstantCase(text) {
  return splitWords(text).map((word) => word.toUpperCase()).join('_');
}

/** 每个单词首字母大写，其余保持原样（适合标题）。 */
export function toTitleCase(text) {
  return String(text).replace(/\w\S*/g, (word) => word[0].toUpperCase() + word.slice(1));
}

/** 仅句首大写。 */
export function toSentenceCase(text) {
  const lower = String(text).toLowerCase();
  return lower.replace(/(^\s*[a-z\u4e00-\u9fa5])|([.!?。！？]\s*[a-z\u4e00-\u9fa5])/g, (match) => match.toUpperCase());
}

export function toAlternatingCase(text) {
  let index = 0;
  return [...String(text)]
    .map((char) => {
      if (!/[a-zA-Z]/.test(char)) return char;
      const result = index % 2 === 0 ? char.toLowerCase() : char.toUpperCase();
      index += 1;
      return result;
    })
    .join('');
}

export function invertCase(text) {
  return [...String(text)]
    .map((char) => (char === char.toLowerCase() ? char.toUpperCase() : char.toLowerCase()))
    .join('');
}
