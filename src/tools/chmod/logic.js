/* 文件权限计算 —— 纯逻辑层。
 *
 * 覆盖 POSIX 权限的三种表示：八进制、符号（rwxr-xr-x）、以及 chmod 的增量写法（u+x、go-w）。
 * 特殊位（setuid / setgid / sticky）按 ls -l 的惯例显示为 s/S 与 t/T。
 */

const SHIFTS = { u: 6, g: 3, o: 0 };
const SPECIAL_MASKS = { u: 0o4000, g: 0o2000, o: 0o1000 };
const SPECIAL_CHARS = { u: ['s', 'S'], g: ['s', 'S'], o: ['t', 'T'] };

export const SPECIAL_BITS = [
  { id: 'setuid', mask: 0o4000, label: 'setuid', note: '执行时以文件所有者身份运行' },
  { id: 'setgid', mask: 0o2000, label: 'setgid', note: '执行时以文件所属组身份运行；对目录表示新建文件继承该组' },
  { id: 'sticky', mask: 0o1000, label: 'sticky', note: '目录下只有文件所有者能删除自己的文件（如 /tmp）' }
];

export const COMMON_MODES = [
  { mode: 0o644, label: 'rw-r--r--', note: '普通文件默认' },
  { mode: 0o600, label: 'rw-------', note: '仅所有者可读写（私钥常用）' },
  { mode: 0o400, label: 'r--------', note: '只读（公钥、证书常用）' },
  { mode: 0o755, label: 'rwxr-xr-x', note: '可执行文件 / 目录默认' },
  { mode: 0o700, label: 'rwx------', note: '仅所有者可访问（~/.ssh）' },
  { mode: 0o750, label: 'rwxr-x---', note: '同组可读可执行' },
  { mode: 0o775, label: 'rwxrwxr-x', note: '同组可写' },
  { mode: 0o777, label: 'rwxrwxrwx', note: '所有人完全权限（慎用）' },
  { mode: 0o664, label: 'rw-rw-r--', note: '同组可写文件' },
  { mode: 0o1777, label: 'rwxrwxrwt', note: '共享目录（如 /tmp）' },
  { mode: 0o4755, label: 'rwsr-xr-x', note: 'setuid 可执行文件' },
  { mode: 0o2755, label: 'rwxr-sr-x', note: 'setgid 可执行文件' }
];

export const FILE_TYPES = [
  { id: '-', label: '普通文件' },
  { id: 'd', label: '目录' },
  { id: 'l', label: '符号链接' },
  { id: 'c', label: '字符设备' },
  { id: 'b', label: '块设备' },
  { id: 'p', label: '命名管道' },
  { id: 's', label: '套接字' }
];

export function isValidMode(mode) {
  return Number.isInteger(mode) && mode >= 0 && mode <= 0o7777;
}

/** 解析八进制权限：接受 755 / 0755 / 4755 / 0o755。 */
export function parseOctal(text) {
  const source = String(text ?? '').trim().replace(/^0o/i, '');
  if (source === '') throw new Error('权限为空');
  if (!/^[0-7]{3,4}$/.test(source)) {
    throw new Error('八进制权限需要 3 位或 4 位数字（每位 0-7），例如 755 或 0644');
  }
  return Number.parseInt(source, 8);
}

export function toOctal(mode, { pad = 3 } = {}) {
  if (!isValidMode(mode)) throw new Error('权限值超出范围');
  const text = mode.toString(8);
  return text.padStart(mode > 0o777 ? 4 : pad, '0');
}

function renderTriple(bits, specialChar) {
  const read = bits & 4 ? 'r' : '-';
  const write = bits & 2 ? 'w' : '-';
  let execute = bits & 1 ? 'x' : '-';
  if (specialChar) execute = bits & 1 ? specialChar[0] : specialChar[1];
  return `${read}${write}${execute}`;
}

/**
 * 转成符号表示。
 * @returns {string} 9 个字符（如 rwxr-xr-x），withType 时会带 1 个文件类型字符
 */
export function toSymbolic(mode, { withType = false, type = '-' } = {}) {
  if (!isValidMode(mode)) throw new Error('权限值超出范围');

  const owner = (mode >> 6) & 7;
  const group = (mode >> 3) & 7;
  const other = mode & 7;

  const text = [
    renderTriple(owner, mode & 0o4000 ? SPECIAL_CHARS.u : null),
    renderTriple(group, mode & 0o2000 ? SPECIAL_CHARS.g : null),
    renderTriple(other, mode & 0o1000 ? SPECIAL_CHARS.o : null)
  ].join('');

  if (!withType) return text;
  const known = FILE_TYPES.some((entry) => entry.id === type);
  return `${known ? type : '-'}${text}`;
}

/** 解析符号权限（可带 ls -l 的文件类型前缀）。 */
export function parseSymbolic(text) {
  let source = String(text ?? '').trim();
  if (source === '') throw new Error('权限为空');

  let type = '-';
  if (source.length === 10) {
    if (!FILE_TYPES.some((entry) => entry.id === source[0])) {
      throw new Error(`未知的文件类型字符：${source[0]}`);
    }
    type = source[0];
    source = source.slice(1);
  }

  if (source.length !== 9) {
    throw new Error('符号权限需要 9 个字符，例如 rwxr-xr-x（也可以带 ls -l 的类型前缀）');
  }

  const triples = [source.slice(0, 3), source.slice(3, 6), source.slice(6, 9)];
  const groups = ['u', 'g', 'o'];
  let mode = 0;

  triples.forEach((triple, index) => {
    const group = groups[index];
    const [read, write, execute] = triple;

    if (read !== 'r' && read !== '-') throw new Error(`${group} 组的读位应为 r 或 -，当前是「${read}」`);
    if (write !== 'w' && write !== '-') throw new Error(`${group} 组的写位应为 w 或 -，当前是「${write}」`);

    let bits = 0;
    if (read === 'r') bits |= 4;
    if (write === 'w') bits |= 2;

    const [upper, lower] = SPECIAL_CHARS[group];
    if (execute === 'x') {
      bits |= 1;
    } else if (execute === upper) {
      bits |= 1;
      mode |= SPECIAL_MASKS[group];
    } else if (execute === lower) {
      mode |= SPECIAL_MASKS[group];
    } else if (execute !== '-') {
      throw new Error(`${group} 组的执行位应为 x、${upper}、${lower} 或 -，当前是「${execute}」`);
    }

    mode |= bits << SHIFTS[group];
  });

  return { mode, type };
}

/**
 * 应用 chmod 的增量写法，支持逗号分隔的多条（如 u+x,go-w）。
 * 未写 who 时按 'a' 处理（不套用 umask，避免结果难以预测）。
 */
export function applySymbolicChange(mode, change) {
  if (!isValidMode(mode)) throw new Error('权限值超出范围');

  const text = String(change ?? '').trim();
  if (text === '') throw new Error('权限改动为空');

  let result = mode;

  for (const clause of text.split(',').map((part) => part.trim()).filter(Boolean)) {
    const match = /^([ugoa]*)([+\-=])([rwxXst]*)$/.exec(clause);
    if (!match) throw new Error(`无法解析权限改动「${clause}」，正确写法如 u+x、go-w、a=rw`);
    if (match[3] === '' && match[2] !== '=') {
      throw new Error(`权限改动「${clause}」没有指定权限字母`);
    }

    let who = match[1];
    const operator = match[2];
    const permissions = match[3];
    if (who === '') who = 'a';

    const targets = who.includes('a') ? ['u', 'g', 'o'] : [...new Set(who.split(''))];

    for (const target of targets) {
      const shift = SHIFTS[target];
      const specialMask = SPECIAL_MASKS[target];
      const current = (result >> shift) & 7;

      let permissionBits = 0;
      let specialSet = false;

      for (const permission of permissions) {
        if (permission === 'r') permissionBits |= 4;
        else if (permission === 'w') permissionBits |= 2;
        else if (permission === 'x') permissionBits |= 1;
        else if (permission === 'X') {
          // X：仅当已是目录或已有任一执行位时才加执行
          if ((mode & 0o111) !== 0 || (current & 1) !== 0) permissionBits |= 1;
        } else if (permission === 's') {
          if (target === 'u' || target === 'g') specialSet = true;
        } else if (permission === 't') {
          if (target === 'o') specialSet = true;
        }
      }

      if (operator === '+') {
        result = (result & ~(7 << shift)) | ((current | permissionBits) << shift);
        if (specialSet && specialMask) result |= specialMask;
      } else if (operator === '-') {
        result = (result & ~(7 << shift)) | ((current & ~permissionBits) << shift);
        if (specialSet && specialMask) result &= ~specialMask;
      } else {
        result = (result & ~(7 << shift)) | (permissionBits << shift);
        if (specialMask) {
          if (specialSet) result |= specialMask;
          else result &= ~specialMask;
        }
      }
    }
  }

  return result;
}

/** 逐组说明权限含义。 */
export function describeMode(mode) {
  if (!isValidMode(mode)) throw new Error('权限值超出范围');

  const groups = [
    { id: 'u', label: '所有者', shift: 6 },
    { id: 'g', label: '所属组', shift: 3 },
    { id: 'o', label: '其他人', shift: 0 }
  ];

  return groups.map((group) => {
    const bits = (mode >> group.shift) & 7;
    const labels = [];
    if (bits & 4) labels.push('读');
    if (bits & 2) labels.push('写');
    if (bits & 1) labels.push('执行');
    return {
      ...group,
      bits,
      octal: String(bits),
      text: renderTriple(bits, null),
      labels: labels.length ? labels : ['无权限']
    };
  });
}

/** 汇总一位权限在数字与字母上的全部信息。 */
export function summarize(mode) {
  if (!isValidMode(mode)) throw new Error('权限值超出范围');

  const specials = SPECIAL_BITS.filter((entry) => (mode & entry.mask) !== 0).map((entry) => entry.label);

  return {
    mode,
    octal: toOctal(mode),
    octalWithSpecial: mode.toString(8).padStart(4, '0'),
    symbolic: toSymbolic(mode),
    lsStyle: toSymbolic(mode, { withType: true }),
    specials,
    groups: describeMode(mode)
  };
}

/** 数值变大还是变小：用于给出「放宽 / 收紧」提示。 */
export function compareModes(from, to) {
  if (from === to) return 'same';
  // 逐位比较：目标包含源的所有位 → 放宽；反之 → 收紧
  const fromBits = from & 0o7777;
  const toBits = to & 0o7777;
  if ((toBits | fromBits) === toBits) return 'wider';
  if ((toBits | fromBits) === fromBits) return 'narrower';
  return 'changed';
}
