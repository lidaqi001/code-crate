/* IP / 子网计算 —— 纯逻辑层。
 *
 * 这里修正了旧实现的两个算法错误：
 * 1. 可用地址数写成 Math.max(total - 2, total)，导致 /24 显示 256 而不是 254
 * 2. ULA 只判断 fc00 / fd00 两个前缀，fd12::1 被误判为公网
 */

/* ── IPv4 解析与换算 ──────────────────────────────────────── */

export function parseIPv4(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return { ok: false, error: '地址为空' };
  const parts = raw.split('.');
  if (parts.length !== 4) return { ok: false, error: 'IPv4 需要 4 段' };

  const octets = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return { ok: false, error: `「${part}」不是合法的十进制段` };
    if (part.length > 1 && part[0] === '0') return { ok: false, error: `「${part}」含有前导零` };
    const value = Number(part);
    if (value > 255) return { ok: false, error: `「${part}」超出 0-255` };
    octets.push(value);
  }
  return { ok: true, octets };
}

export function ipv4ToInt(octets) {
  return ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
}

export function intToIPv4(value) {
  const n = Number(value) >>> 0;
  return `${(n >>> 24) & 255}.${(n >>> 16) & 255}.${(n >>> 8) & 255}.${n & 255}`;
}

export function ipv4ToBinary(octets) {
  return octets.map((octet) => octet.toString(2).padStart(8, '0')).join('.');
}

export function ipv4ToHex(octets) {
  return octets.map((octet) => octet.toString(16).padStart(2, '0')).join('.');
}

export function ipv4Class(octets) {
  const first = octets[0];
  if (first < 128) return 'A';
  if (first < 192) return 'B';
  if (first < 224) return 'C';
  if (first < 240) return 'D（组播）';
  return 'E（保留）';
}

/**
 * 判断 IPv4 的归属。
 * @returns {{isPublic:boolean, tags:string[]}}
 */
export function classifyIPv4(octets) {
  const [a, b, c, d] = octets;

  if (a === 255 && b === 255 && c === 255 && d === 255) return { isPublic: false, tags: ['受限广播'] };
  if (a === 0 && b === 0 && c === 0 && d === 0) return { isPublic: false, tags: ['未指定地址'] };
  if (a === 127) return { isPublic: false, tags: ['环回'] };
  if (a === 10) return { isPublic: false, tags: ['私有（10.0.0.0/8）'] };
  if (a === 172 && b >= 16 && b <= 31) return { isPublic: false, tags: ['私有（172.16.0.0/12）'] };
  if (a === 192 && b === 168) return { isPublic: false, tags: ['私有（192.168.0.0/16）'] };
  if (a === 169 && b === 254) return { isPublic: false, tags: ['链路本地（APIPA）'] };
  if (a === 100 && b >= 64 && b <= 127) return { isPublic: false, tags: ['运营商级 NAT（100.64.0.0/10）'] };
  if (a === 192 && b === 0 && c === 2) return { isPublic: false, tags: ['文档示例（TEST-NET-1）'] };
  if (a === 198 && b === 51 && c === 100) return { isPublic: false, tags: ['文档示例（TEST-NET-2）'] };
  if (a === 203 && b === 0 && c === 113) return { isPublic: false, tags: ['文档示例（TEST-NET-3）'] };
  if (a === 198 && (b === 18 || b === 19)) return { isPublic: false, tags: ['基准测试（198.18.0.0/15）'] };
  if (a >= 224 && a <= 239) return { isPublic: false, tags: ['组播'] };
  if (a >= 240) return { isPublic: false, tags: ['保留（240.0.0.0/4）'] };
  if (a === 192 && b === 0 && c === 0) return { isPublic: false, tags: ['IETF 协议分配'] };
  if (a === 198 && b === 51 && c === 100) return { isPublic: false, tags: ['文档示例'] };

  return { isPublic: true, tags: ['公网可路由'] };
}

/* ── IPv4 子网 ────────────────────────────────────────────── */

/** 前缀长度对应的子网掩码。 */
export function prefixToMask(prefix) {
  if (prefix === 0) return 0;
  return (0xffffffff << (32 - prefix)) >>> 0;
}

export function maskToPrefix(mask) {
  const value = mask >>> 0;
  let prefix = 0;
  for (let i = 31; i >= 0; i -= 1) {
    if ((value >>> i) & 1) prefix += 1;
    else break;
  }
  return prefix;
}

/**
 * IPv4 子网信息。
 *
 * 可用（可分配）地址数规则：
 *   /32 → 1（单主机）
 *   /31 → 2（RFC 3021 点对点链路，两端都可用）
 *   其他 → 总数 - 2（扣除网络号与广播地址）
 */
export function subnetInfoV4(octets, prefix) {
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    throw new Error('IPv4 前缀长度需在 0-32 之间');
  }

  const ipInt = ipv4ToInt(octets);
  const mask = prefixToMask(prefix);
  const wildcard = (~mask) >>> 0;
  const network = (ipInt & mask) >>> 0;
  const broadcast = (network | wildcard) >>> 0;
  const total = 2 ** (32 - prefix);

  let usable;
  let firstHost = null;
  let lastHost = null;

  if (prefix === 32) {
    usable = 1;
    firstHost = network;
    lastHost = network;
  } else if (prefix === 31) {
    usable = 2;
    firstHost = network;
    lastHost = broadcast;
  } else {
    usable = Math.max(total - 2, 0);
    firstHost = (network + 1) >>> 0;
    lastHost = (broadcast - 1) >>> 0;
  }

  return {
    version: 4,
    prefix,
    mask,
    wildcard,
    network,
    broadcast,
    total,
    usable,
    firstHost,
    lastHost,
    maskText: intToIPv4(mask),
    wildcardText: intToIPv4(wildcard),
    networkText: intToIPv4(network),
    broadcastText: intToIPv4(broadcast),
    firstHostText: firstHost === null ? null : intToIPv4(firstHost),
    lastHostText: lastHost === null ? null : intToIPv4(lastHost),
    rangeText: `${intToIPv4(network)} - ${intToIPv4(broadcast)}`
  };
}

/* ── IPv6 解析与换算 ──────────────────────────────────────── */

export function parseIPv6(text) {
  let source = String(text ?? '').trim();
  if (!source) return { ok: false, error: '地址为空' };

  const zone = source.indexOf('%');
  if (zone >= 0) source = source.slice(0, zone);

  // 末尾的内嵌 IPv4（如 ::ffff:192.168.1.1）
  if (source.includes('.')) {
    const lastColon = source.lastIndexOf(':');
    if (lastColon < 0) return { ok: false, error: '不是合法的 IPv6 地址' };
    const v4 = parseIPv4(source.slice(lastColon + 1));
    if (!v4.ok) return { ok: false, error: `内嵌 IPv4 非法：${v4.error}` };
    const high = ((v4.octets[0] << 8) | v4.octets[1]).toString(16);
    const low = ((v4.octets[2] << 8) | v4.octets[3]).toString(16);
    source = `${source.slice(0, lastColon + 1)}${high}:${low}`;
  }

  const doubleColon = source.indexOf('::');
  let headText = source;
  let tailText = null;

  if (doubleColon >= 0) {
    if (source.indexOf('::', doubleColon + 1) >= 0) return { ok: false, error: '「::」只能出现一次' };
    headText = source.slice(0, doubleColon);
    tailText = source.slice(doubleColon + 2);
  }

  const toGroups = (text) => {
    if (text === '') return { ok: true, values: [] };
    const values = [];
    for (const part of text.split(':')) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(part)) return { ok: false, error: `分组「${part}」不是 1-4 位十六进制` };
      values.push(Number.parseInt(part, 16));
    }
    return { ok: true, values };
  };

  const head = toGroups(headText);
  if (!head.ok) return head;

  if (tailText === null) {
    if (head.values.length !== 8) return { ok: false, error: `IPv6 需要 8 个分组，当前 ${head.values.length} 个` };
    return { ok: true, groups: head.values };
  }

  const tail = toGroups(tailText);
  if (!tail.ok) return tail;

  const missing = 8 - head.values.length - tail.values.length;
  if (missing < 1) return { ok: false, error: '「::」展开后超过 8 个分组' };

  return { ok: true, groups: [...head.values, ...new Array(missing).fill(0), ...tail.values] };
}

/** 按 RFC 5952 压缩：小写、去前导零、最长零段折叠为 ::。 */
export function formatIPv6(groups) {
  let bestStart = -1;
  let bestLength = 0;
  let currentStart = -1;
  let currentLength = 0;

  for (let i = 0; i < groups.length; i += 1) {
    if (groups[i] === 0) {
      if (currentStart < 0) {
        currentStart = i;
        currentLength = 0;
      }
      currentLength += 1;
      if (currentLength > bestLength) {
        bestLength = currentLength;
        bestStart = currentStart;
      }
    } else {
      currentStart = -1;
      currentLength = 0;
    }
  }

  const parts = groups.map((group) => group.toString(16));
  if (bestLength >= 2) {
    const before = parts.slice(0, bestStart).join(':');
    const after = parts.slice(bestStart + bestLength).join(':');
    return `${before}::${after}`;
  }
  return parts.join(':');
}

export function formatIPv6Full(groups) {
  return groups.map((group) => group.toString(16).padStart(4, '0')).join(':');
}

export function ipv6ToBigInt(groups) {
  let value = 0n;
  for (const group of groups) value = (value << 16n) | BigInt(group);
  return value;
}

export function bigIntToIPv6(value) {
  const groups = [];
  let rest = BigInt(value);
  for (let i = 0; i < 8; i += 1) {
    groups.unshift(Number(rest & 0xffffn));
    rest >>= 16n;
  }
  return groups;
}

export function classifyIPv6(groups) {
  const allZero = groups.every((group) => group === 0);
  if (allZero) return { isPublic: false, tags: ['未指定地址（::）'] };

  const loopback = groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1;
  if (loopback) return { isPublic: false, tags: ['环回（::1）'] };

  const isV4Mapped = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
  if (isV4Mapped) return { isPublic: false, tags: ['IPv4 映射地址'] };

  const isV4Compatible = groups.slice(0, 6).every((group) => group === 0);
  if (isV4Compatible) return { isPublic: false, tags: ['IPv4 兼容（已废弃）'] };

  const first = groups[0];
  // fe80::/10 —— 用掩码判断，而不是只匹配 fe80
  if ((first & 0xffc0) === 0xfe80) return { isPublic: false, tags: ['链路本地（fe80::/10）'] };
  // fc00::/7 —— ULA，覆盖 fc00-fdff，旧实现只判断 fc00/fd00 会漏掉 fd12::
  if ((first & 0xfe00) === 0xfc00) return { isPublic: false, tags: ['唯一本地地址 ULA（fc00::/7）'] };
  if ((first & 0xff00) === 0xff00) return { isPublic: false, tags: ['组播（ff00::/8）'] };
  if (first === 0x2001 && groups[1] === 0x0db8) return { isPublic: false, tags: ['文档示例（2001:db8::/32）'] };
  if (first === 0x2001 && groups[1] === 0x0000) return { isPublic: false, tags: ['Teredo 隧道'] };
  if (first === 0x0064 && groups[1] === 0xff9b) return { isPublic: false, tags: ['NAT64 转换（64:ff9b::/96）'] };

  return { isPublic: true, tags: ['公网可路由（2000::/3 范围内）'] };
}

/** 展开的完整形式（去掉前导零的 4 位一组）。 */
export function subnetInfoV6(groups, prefix) {
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 128) {
    throw new Error('IPv6 前缀长度需在 0-128 之间');
  }

  const value = ipv6ToBigInt(groups);
  const hostBits = 128n - BigInt(prefix);
  const mask = hostBits === 128n ? 0n : ((1n << BigInt(prefix)) - 1n) << hostBits;
  const network = value & mask;
  const last = network | ((1n << hostBits) - 1n);
  const total = 1n << hostBits;

  return {
    version: 6,
    prefix,
    network,
    last,
    total,
    networkText: formatIPv6(bigIntToIPv6(network)),
    lastText: formatIPv6(bigIntToIPv6(last)),
    totalText: total.toString(),
    rangeText: `${formatIPv6(bigIntToIPv6(network))} - ${formatIPv6(bigIntToIPv6(last))}`
  };
}

/* ── 统一入口 ─────────────────────────────────────────────── */

/**
 * 分析单行输入，自动识别 IPv4 / IPv6 / CIDR。
 * @returns {object} 带 type 字段的结果对象
 */
export function analyzeLine(rawLine) {
  const raw = String(rawLine ?? '').trim();
  if (!raw) return { type: 'empty', raw };

  const slash = raw.indexOf('/');
  const addressPart = slash >= 0 ? raw.slice(0, slash).trim() : raw;
  const prefixPart = slash >= 0 ? raw.slice(slash + 1).trim() : null;

  const v4 = parseIPv4(addressPart);
  if (v4.ok) {
    const classification = classifyIPv4(v4.octets);
    const base = {
      type: prefixPart === null ? 'ipv4' : 'ipv4-cidr',
      raw,
      address: intToIPv4(ipv4ToInt(v4.octets)),
      octets: v4.octets,
      integer: ipv4ToInt(v4.octets),
      binary: ipv4ToBinary(v4.octets),
      hex: ipv4ToHex(v4.octets),
      addressClass: ipv4Class(v4.octets),
      isPublic: classification.isPublic,
      tags: classification.tags,
      version: 4
    };

    if (prefixPart === null) return base;

    if (!/^\d{1,2}$/.test(prefixPart)) {
      return { type: 'error', raw, error: `前缀「${prefixPart}」不是合法数字` };
    }
    const prefix = Number(prefixPart);
    if (prefix > 32) return { type: 'error', raw, error: 'IPv4 前缀长度不能超过 32' };

    try {
      return { ...base, subnet: subnetInfoV4(v4.octets, prefix) };
    } catch (error) {
      return { type: 'error', raw, error: error.message };
    }
  }

  const v6 = parseIPv6(addressPart);
  if (v6.ok) {
    const classification = classifyIPv6(v6.groups);
    const base = {
      type: prefixPart === null ? 'ipv6' : 'ipv6-cidr',
      raw,
      address: formatIPv6(v6.groups),
      expanded: formatIPv6Full(v6.groups),
      groups: v6.groups,
      isPublic: classification.isPublic,
      tags: classification.tags,
      version: 6
    };

    if (prefixPart === null) return base;

    if (!/^\d{1,3}$/.test(prefixPart)) {
      return { type: 'error', raw, error: `前缀「${prefixPart}」不是合法数字` };
    }
    const prefix = Number(prefixPart);
    if (prefix > 128) return { type: 'error', raw, error: 'IPv6 前缀长度不能超过 128' };

    try {
      return { ...base, subnet: subnetInfoV6(v6.groups, prefix) };
    } catch (error) {
      return { type: 'error', raw, error: error.message };
    }
  }

  // 给出更有用的报错：如果像 IPv4 就报 IPv4 的原因，否则报 IPv6 的
  if (/^[\d.]+$/.test(addressPart)) return { type: 'error', raw, error: v4.error };
  return { type: 'error', raw, error: v6.error };
}

export function analyze(text) {
  return String(text ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map(analyzeLine);
}
