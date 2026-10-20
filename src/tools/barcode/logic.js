/* Code 128-B 条码 —— 纯逻辑层。
   标准符号表 0–106（106 为 Stop），数据字符取 ASCII 32–126，value = code - 32。
   校验位：104 + Σ(value_i × 位置_i) mod 103，位置从 1 开始。 */

export const CODE128_PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312',
  '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222',
  '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131',
  '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321',
  '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121',
  '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321',
  '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224',
  '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114',
  '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112',
  '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113',
  '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412',
  '211214', '211232', '2331112'
];

export const START_B = 104;
export const STOP = 106;
export const MIN_ASCII = 32;
export const MAX_ASCII = 126;
export const MAX_TEXT_LENGTH = 120;

/** 单个字符 → Code 128-B value。 */
export function charValue(char) {
  const code = char.codePointAt(0);
  if (!Number.isFinite(code) || code < MIN_ASCII || code > MAX_ASCII) {
    throw new Error(`字符 ${JSON.stringify(char)} 不在 Code 128-B 支持范围（ASCII 32–126）`);
  }
  return code - MIN_ASCII;
}

export function checksum(values) {
  let sum = START_B;
  values.forEach((value, index) => {
    sum += value * (index + 1);
  });
  return sum % 103;
}

/** 把符号宽度序列展开为每模块 1/0（1 = 黑条）。 */
export function toModules(values) {
  const modules = [];
  for (const value of values) {
    const pattern = CODE128_PATTERNS[value];
    if (!pattern) throw new Error(`未知的 Code 128 符号：${value}`);
    let bar = true;
    for (const char of pattern) {
      const width = Number(char);
      for (let i = 0; i < width; i += 1) modules.push(bar ? 1 : 0);
      bar = !bar;
    }
  }
  return modules;
}

/**
 * 编码文本。
 * @returns {{text:string, values:number[], value:number[], checksum:number, modules:number[], moduleCount:number}}
 */
export function encodeCode128B(text) {
  const source = String(text ?? '');
  if (!source) throw new Error('请输入要编码的内容');
  if (source.length > MAX_TEXT_LENGTH) {
    throw new Error(`内容过长（最多 ${MAX_TEXT_LENGTH} 个字符）`);
  }
  for (const char of source) {
    if (!/^[\x20-\x7E]$/.test(char)) {
      throw new Error(`字符 ${JSON.stringify(char)} 不在 Code 128-B 支持范围（ASCII 32–126）`);
    }
  }

  const data = [...source].map(charValue);
  const check = checksum(data);
  const values = [START_B, ...data, check, STOP];
  const modules = toModules(values);

  return {
    text: source,
    values,
    data,
    checksum: check,
    modules,
    moduleCount: modules.length
  };
}

/** 连续黑条的区间，供渲染复用。 */
export function barRuns(modules) {
  const runs = [];
  for (let index = 0; index < modules.length; index += 1) {
    if (!modules[index]) continue;
    const start = index;
    while (index + 1 < modules.length && modules[index + 1]) index += 1;
    runs.push({ start, length: index - start + 1 });
  }
  return runs;
}

export function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * 生成 SVG。所有尺寸都按模块数计算，不含浮点误差。
 * @param {string} text
 * @param {{moduleWidth?:number,height?:number,quietZone?:number,showText?:boolean}} options
 */
export function toSvg(text, options = {}) {
  const moduleWidth = Math.min(8, Math.max(1, Math.trunc(options.moduleWidth) || 2));
  const height = Math.min(300, Math.max(30, Math.trunc(options.height) || 90));
  const quietZone = Math.min(40, Math.max(0, Math.trunc(options.quietZone)))
  const showText = options.showText !== false;

  const { modules, moduleCount } = encodeCode128B(text);
  const totalModules = moduleCount + quietZone * 2;
  const width = totalModules * moduleWidth;
  const barHeight = showText ? Math.max(10, height - 16) : height;

  const rects = barRuns(modules)
    .map((run) => `<rect x="${(quietZone + run.start) * moduleWidth}" y="0" width="${run.length * moduleWidth}" height="${barHeight}"/>`)
    .join('');

  const label = showText
    ? `<text x="${width / 2}" y="${height - 4}" text-anchor="middle" font-family="monospace" font-size="12" fill="#000">${escapeXml(text)}</text>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(text)}"><rect width="100%" height="100%" fill="#fff"/><g fill="#000">${rects}</g>${label}</svg>`;
}
