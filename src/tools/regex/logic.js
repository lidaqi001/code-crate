/* 正则工具 —— 纯逻辑层。
   刻意处理两个易被忽略的正确性问题：
   1. 零宽匹配（如 /a*​/g）必须手动推进 lastIndex，否则死循环
   2. 灾难性回溯没有运行时解药，只能提前识别并明确警告用户 */

const SUPPORTS_INDICES = (() => {
  try {
    new RegExp('a', 'd');
    return true;
  } catch {
    return false;
  }
})();

export const FLAG_INFO = [
  { flag: 'i', label: '忽略大小写' },
  { flag: 'm', label: '多行（^ $ 匹配每行）' },
  { flag: 's', label: '点号匹配换行' },
  { flag: 'u', label: 'Unicode 模式' }
];

/**
 * 编译正则。始终补上 g（便于遍历），并在支持时补上 d（便于取分组位置）。
 * @returns {{ok:true, regex:RegExp, flags:string}|{ok:false, error:string}}
 */
export function compileRegex(pattern, flags = '') {
  const source = String(pattern ?? '');
  if (!source) return { ok: false, error: '正则表达式为空' };

  let effective = String(flags || '').replace(/[gy]/g, '');
  effective += 'g';
  if (SUPPORTS_INDICES) effective += 'd';
  effective = [...new Set(effective)].join('');

  try {
    return { ok: true, regex: new RegExp(source, effective), flags: effective };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

/**
 * 找出全部匹配，含分组与分组位置。
 * @returns {Array<{index:number,end:number,value:string,groups:Array,named:object|null}>}
 */
/** 零宽匹配后前进一个码点（u 模式下的代理对占两个码元）。 */
function advanceAfterZeroWidth(regex, source) {
  const code = source.codePointAt(regex.lastIndex);
  regex.lastIndex += regex.unicode && code !== undefined && code > 0xffff ? 2 : 1;
}

export function findMatches(regex, text, { limit = 5000 } = {}) {
  const source = String(text ?? '');
  const matches = [];
  regex.lastIndex = 0;

  let match;
  while ((match = regex.exec(source)) !== null) {
    const groups = [];
    for (let i = 1; i < match.length; i += 1) {
      const range = match.indices && match.indices[i] ? match.indices[i] : null;
      groups.push({
        index: i,
        value: match[i] === undefined ? null : match[i],
        start: range ? range[0] : null,
        end: range ? range[1] : null
      });
    }

    matches.push({
      index: match.index,
      end: match.index + match[0].length,
      value: match[0],
      groups,
      named: match.groups ? { ...match.groups } : null
    });

    if (matches.length >= limit) break;
    // 零宽匹配：手动推进，避免无限循环；u 模式下按码点而不是码元推进
    if (match[0] === '') advanceAfterZeroWidth(regex, source);
  }

  return matches;
}

/** 替换并返回替换次数。替换串支持 $1、$<name>、$& 等原生语义。 */
export function replaceWith(regex, text, replacement) {
  const source = String(text ?? '');
  const counter = new RegExp(regex.source, regex.flags);
  let count = 0;
  let match;
  while ((match = counter.exec(source)) !== null) {
    count += 1;
    if (match[0] === '') advanceAfterZeroWidth(counter, source);
    if (count > 100000) break;
  }

  const result = source.replace(new RegExp(regex.source, regex.flags), String(replacement ?? ''));
  return { result, count };
}

export function splitBy(regex, text, limit = 1000) {
  return String(text ?? '').split(regex, limit);
}

/* ── 风险识别 ─────────────────────────────────────────────── */

/**
 * 灾难性回溯无法在运行时中断，所以只能静态提示。
 * @returns {{risky:boolean, reasons:string[]}}
 */
export function detectRisk(pattern) {
  const src = String(pattern ?? '');
  const reasons = [];

  if (/\([^()]*[+*][^()]*\)\s*[+*]/.test(src)) {
    reasons.push('分组内部已有 + 或 *，分组外又叠加量词，输入稍长就可能指数级回溯');
  }
  if (/\([^()]*\|[^()]*\)\s*[+*]/.test(src)) {
    reasons.push('分组内是「或」结构且被量词修饰，可能触发灾难性回溯');
  }
  if (/(\.\*){2,}/.test(src) || /(\.\+){2,}/.test(src)) {
    reasons.push('连续多个 .* 或 .+ 会互相竞争，建议改为更具体的字符类');
  }

  return { risky: reasons.length > 0, reasons };
}

/* ── 表达式解释 ───────────────────────────────────────────── */

const SHORTHAND = {
  d: '任意数字 0-9',
  D: '任意非数字字符',
  w: '单词字符（字母、数字、下划线）',
  W: '任意非单词字符',
  s: '任意空白字符（空格、Tab、换行）',
  S: '任意非空白字符',
  b: '单词边界',
  B: '非单词边界',
  n: '换行符',
  r: '回车符',
  t: '制表符',
  f: '换页符',
  v: '垂直制表符',
  0: '空字符 NUL'
};

const QUANTIFIER_TEXT = {
  '*': '重复 0 次或多次',
  '+': '重复 1 次或多次',
  '?': '出现 0 次或 1 次'
};

/**
 * 把正则拆成可读的片段说明，帮助理解别人写的（或自己写的）复杂表达式。
 * @returns {Array<{token:string, description:string}>}
 */
export function explainPattern(pattern) {
  const src = String(pattern ?? '');
  const tokens = [];
  let i = 0;

  const push = (token, description) => tokens.push({ token, description });
  const appendQuantifier = (token, description) => {
    const previous = tokens[tokens.length - 1];
    if (previous && previous.literalRun) {
      previous.token += token;
      previous.description = `${previous.description}；${description}`;
      return;
    }
    if (previous) {
      previous.token += token;
      previous.description = `${previous.description}；${description}`;
      return;
    }
    push(token, description);
  };

  while (i < src.length) {
    const char = src[i];

    if (char === '\\') {
      const next = src[i + 1];
      if (next === undefined) {
        push('\\', '孤立的反斜杠（表达式不完整）');
        i += 1;
        continue;
      }
      if (next === 'k' && src[i + 2] === '<') {
        const end = src.indexOf('>', i + 3);
        if (end > 0) {
          push(src.slice(i, end + 1), `反向引用命名分组 ${src.slice(i + 3, end)}`);
          i = end + 1;
          continue;
        }
      }
      if (next === 'u' && src[i + 2] === '{') {
        const end = src.indexOf('}', i + 3);
        if (end > 0) {
          push(src.slice(i, end + 1), `Unicode 码点 U+${src.slice(i + 3, end)}`);
          i = end + 1;
          continue;
        }
      }
      if (next === 'u' || next === 'x') {
        const size = next === 'u' ? 6 : 4;
        push(src.slice(i, i + size), `字符编码转义`);
        i += size;
        continue;
      }
      if (SHORTHAND[next] !== undefined) {
        push(src.slice(i, i + 2), SHORTHAND[next]);
      } else if (/[1-9]/.test(next)) {
        push(src.slice(i, i + 2), `反向引用第 ${next} 个捕获组`);
      } else if (next === 'p' || next === 'P') {
        const end = src.indexOf('}', i);
        push(end > 0 ? src.slice(i, end + 1) : src.slice(i, i + 2), 'Unicode 属性匹配');
        i = end > 0 ? end + 1 : i + 2;
        continue;
      } else {
        push(src.slice(i, i + 2), `转义字符「${next}」`);
      }
      i += 2;
      continue;
    }

    if (char === '[') {
      let end = i + 1;
      if (src[end] === '^') end += 1;
      if (src[end] === ']') end += 1;
      while (end < src.length && src[end] !== ']') {
        if (src[end] === '\\') end += 1;
        end += 1;
      }
      const token = src.slice(i, Math.min(end + 1, src.length));
      const negated = token.startsWith('[^');
      const body = token.slice(negated ? 2 : 1, -1);
      push(token, `字符类：${negated ? '不在' : '属于'} [${body}] 中的任意一个字符`);
      i = end + 1;
      continue;
    }

    if (char === '(') {
      let description = '捕获分组';
      let prefixLength = 1;
      if (src.startsWith('(?:', i)) {
        description = '非捕获分组（只分组，不单独捕获）';
        prefixLength = 3;
      } else if (src.startsWith('(?=', i)) {
        description = '先行断言：后面必须匹配';
        prefixLength = 3;
      } else if (src.startsWith('(?!', i)) {
        description = '否定先行断言：后面不能匹配';
        prefixLength = 3;
      } else if (src.startsWith('(?<=', i)) {
        description = '后行断言：前面必须匹配';
        prefixLength = 4;
      } else if (src.startsWith('(?<!', i)) {
        description = '否定后行断言：前面不能匹配';
        prefixLength = 4;
      } else if (src.startsWith('(?<', i)) {
        const end = src.indexOf('>', i);
        const name = end > 0 ? src.slice(i + 3, end) : '';
        description = `命名捕获分组「${name}」`;
        prefixLength = end > 0 ? end - i + 1 : 3;
      }
      push(src.slice(i, i + prefixLength), description);
      i += prefixLength;
      continue;
    }

    if (char === ')' || char === '|') {
      push(char, char === ')' ? '分组结束' : '或：两侧任选其一');
      i += 1;
      continue;
    }

    if (char === '^') {
      push('^', '行首（多行模式下为每行行首）');
      i += 1;
      continue;
    }
    if (char === '$') {
      push('$', '行尾（多行模式下为每行行尾）');
      i += 1;
      continue;
    }
    if (char === '.') {
      push('.', '任意字符（默认不含换行）');
      i += 1;
      continue;
    }

    if (QUANTIFIER_TEXT[char] !== undefined) {
      let token = char;
      let description = QUANTIFIER_TEXT[char];
      if (src[i + 1] === '?') {
        token += '?';
        description += '，懒惰匹配（尽可能少）';
        i += 1;
      }
      appendQuantifier(token, description);
      i += 1;
      continue;
    }

    if (char === '{') {
      const end = src.indexOf('}', i);
      if (end > 0 && /^\d+(,\d*)?$/.test(src.slice(i + 1, end))) {
        let token = src.slice(i, end + 1);
        let description = `重复 ${src.slice(i + 1, end).replace(',', ' 到 ')} 次`;
        if (src[end + 1] === '?') {
          token += '?';
          description += '，懒惰匹配';
          end += 1;
        }
        appendQuantifier(token, description);
        i = end + 1;
        continue;
      }
    }

    // 合并连续的普通字面量，避免逐字刷屏
    let run = char;
    let j = i + 1;
    while (j < src.length && !/[\\[\](){}^$.|*+?]/.test(src[j])) {
      run += src[j];
      j += 1;
    }
    push(run, `字面量「${run}」`);
    tokens[tokens.length - 1].literalRun = true;
    i = j;
  }

  return tokens;
}

/* ── 常用表达式速查 ───────────────────────────────────────── */

export const COMMON_PATTERNS = [
  { name: '邮箱', pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$', sample: 'dev@example.com', note: '宽松校验，覆盖绝大多数真实邮箱' },
  { name: 'URL', pattern: '^https?://[^\\s/$.?#][^\\s]*$', sample: 'https://example.com/a?b=1', note: '仅接受 http/https' },
  {
    name: 'IPv4',
    pattern: '^((25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)\\.){3}(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)$',
    sample: '192.168.1.1',
    note: '每段 0-255，不接受前导零'
  },
  { name: '中国手机号', pattern: '^1[3-9]\\d{9}$', sample: '13800138000', note: '11 位，1 开头，第二位 3-9' },
  { name: '身份证号', pattern: '^\\d{17}[\\dXx]$', sample: '11010519491231002X', note: '18 位，末位可为 X' },
  { name: '日期 YYYY-MM-DD', pattern: '^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])$', sample: '2026-05-20', note: '不校验每月天数与闰年' },
  { name: '时间 HH:mm:ss', pattern: '^([01]\\d|2[0-3]):[0-5]\\d(:[0-5]\\d)?$', sample: '23:59:59', note: '秒可选' },
  { name: '中文字符', pattern: '[\\u4e00-\\u9fa5]+', sample: '你好世界', note: '基本汉字区' },
  { name: '十六进制颜色', pattern: '^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$', sample: '#5b8cff', note: '支持 3/6/8 位' },
  {
    name: 'UUID',
    pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
    sample: '550e8400-e29b-41d4-a716-446655440000',
    note: '仅校验结构'
  },
  { name: '强密码', pattern: '^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d).{8,}$', sample: 'Abc12345', note: '至少 8 位且含大小写与数字' },
  { name: 'HTML 标签', pattern: '<\\/?[a-zA-Z][^>]*>', sample: '<div class="a">', note: '匹配开闭标签' },
  { name: '行尾空白', pattern: '[ \\t]+$', sample: 'let a = 1;   ', note: '多行模式下逐行清理' },
  { name: 'URL 查询参数', pattern: '[?&]([^=&#]+)=([^&#]*)', sample: '?page=2&size=10', note: '分组 1 为键，分组 2 为值' }
];
