import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseIPv4,
  parseIPv6,
  ipv4ToInt,
  intToIPv4,
  ipv4ToBinary,
  ipv4ToHex,
  ipv4Class,
  classifyIPv4,
  classifyIPv6,
  prefixToMask,
  maskToPrefix,
  subnetInfoV4,
  subnetInfoV6,
  formatIPv6,
  formatIPv6Full,
  ipv6ToBigInt,
  bigIntToIPv6,
  analyzeLine,
  analyze
} from '../src/tools/ip/logic.js';

/* ── IPv4 解析 ────────────────────────────────────────────── */

test('parseIPv4 接受合法地址', () => {
  const result = parseIPv4('192.168.1.1');
  assert.equal(result.ok, true);
  assert.deepEqual(result.octets, [192, 168, 1, 1]);
  assert.equal(parseIPv4('0.0.0.0').ok, true);
  assert.equal(parseIPv4('255.255.255.255').ok, true);
});

test('parseIPv4 拒绝非法输入并说明原因', () => {
  assert.equal(parseIPv4('192.168.1').ok, false);
  assert.match(parseIPv4('192.168.1').error, /4 段/);
  assert.equal(parseIPv4('192.168.1.256').ok, false);
  assert.match(parseIPv4('192.168.1.256').error, /255/);
  assert.equal(parseIPv4('192.168.1.01').ok, false);
  assert.match(parseIPv4('192.168.1.01').error, /前导零/);
  assert.equal(parseIPv4('a.b.c.d').ok, false);
  assert.equal(parseIPv4('').ok, false);
});

test('IPv4 <-> 整数互转', () => {
  assert.equal(ipv4ToInt([0, 0, 0, 0]), 0);
  assert.equal(ipv4ToInt([255, 255, 255, 255]), 4294967295);
  assert.equal(ipv4ToInt([192, 168, 1, 1]), 3232235777);
  assert.equal(intToIPv4(3232235777), '192.168.1.1');
  assert.equal(intToIPv4(0), '0.0.0.0');
  // 往返一致性
  for (const ip of ['10.0.0.1', '172.16.31.255', '203.0.113.9']) {
    assert.equal(intToIPv4(ipv4ToInt(parseIPv4(ip).octets)), ip);
  }
});

test('IPv4 二进制与十六进制表示', () => {
  assert.equal(ipv4ToBinary([192, 168, 1, 1]), '11000000.10101000.00000001.00000001');
  assert.equal(ipv4ToHex([192, 168, 1, 1]), 'c0.a8.01.01');
});

test('IPv4 类别判定', () => {
  assert.equal(ipv4Class([10, 0, 0, 1]), 'A');
  assert.equal(ipv4Class([172, 16, 0, 1]), 'B');
  assert.equal(ipv4Class([192, 168, 1, 1]), 'C');
  assert.match(ipv4Class([224, 0, 0, 1]), /D/);
  assert.match(ipv4Class([240, 0, 0, 1]), /E/);
});

/* ── IPv4 归属判定 ────────────────────────────────────────── */

test('私有地址段全部识别为私有', () => {
  for (const ip of ['10.0.0.1', '10.255.255.254', '172.16.0.1', '172.31.255.254', '192.168.0.1', '192.168.255.254']) {
    const result = classifyIPv4(parseIPv4(ip).octets);
    assert.equal(result.isPublic, false, ip);
    assert.ok(result.tags.some((tag) => tag.includes('私有')), ip);
  }
});

test('172.32 不再被误判为私有', () => {
  assert.equal(classifyIPv4(parseIPv4('172.32.0.1').octets).isPublic, true);
  assert.equal(classifyIPv4(parseIPv4('172.15.0.1').octets).isPublic, true);
});

test('特殊用途地址分类正确', () => {
  assert.match(classifyIPv4(parseIPv4('127.0.0.1').octets).tags[0], /环回/);
  assert.match(classifyIPv4(parseIPv4('169.254.1.1').octets).tags[0], /链路本地/);
  assert.match(classifyIPv4(parseIPv4('100.64.0.1').octets).tags[0], /NAT/);
  assert.match(classifyIPv4(parseIPv4('224.0.0.1').octets).tags[0], /组播/);
  assert.match(classifyIPv4(parseIPv4('255.255.255.255').octets).tags[0], /广播/);
  assert.match(classifyIPv4(parseIPv4('0.0.0.0').octets).tags[0], /未指定/);
  assert.match(classifyIPv4(parseIPv4('192.0.2.5').octets).tags[0], /文档/);
  assert.match(classifyIPv4(parseIPv4('8.8.8.8').octets).tags[0], /公网/);
});

/* ── IPv4 子网：可用地址数（旧版本的错误点） ─────────────── */

test('prefixToMask 与 maskToPrefix 互逆', () => {
  assert.equal(prefixToMask(24), 4294967040);
  assert.equal(prefixToMask(0), 0);
  assert.equal(prefixToMask(32), 4294967295);
  assert.equal(maskToPrefix(prefixToMask(24)), 24);
  assert.equal(maskToPrefix(prefixToMask(0)), 0);
  assert.equal(maskToPrefix(prefixToMask(32)), 32);
});

test('/24 的可用地址是 254 而不是 256', () => {
  const info = subnetInfoV4(parseIPv4('192.168.1.10').octets, 24);
  assert.equal(info.total, 256);
  // 旧实现写成 Math.max(total - 2, total)，这里会错误地得到 256
  assert.equal(info.usable, 254);
  assert.equal(info.networkText, '192.168.1.0');
  assert.equal(info.broadcastText, '192.168.1.255');
  assert.equal(info.firstHostText, '192.168.1.1');
  assert.equal(info.lastHostText, '192.168.1.254');
});

test('各前缀长度的可用地址数符合规范', () => {
  const octets = parseIPv4('192.168.1.10').octets;
  const cases = [
    [30, 4, 2],
    [29, 8, 6],
    [28, 16, 14],
    [25, 128, 126],
    [24, 256, 254],
    [23, 512, 510],
    [16, 65536, 65534],
    [8, 16777216, 16777214]
  ];
  for (const [prefix, total, usable] of cases) {
    const info = subnetInfoV4(octets, prefix);
    assert.equal(info.total, total, `/${prefix} 总数`);
    assert.equal(info.usable, usable, `/${prefix} 可用数`);
  }
});

test('/31 与 /32 按点对点与单主机规则处理', () => {
  const p31 = subnetInfoV4(parseIPv4('10.0.0.2').octets, 31);
  assert.equal(p31.total, 2);
  assert.equal(p31.usable, 2);
  assert.equal(p31.firstHostText, '10.0.0.2');
  assert.equal(p31.lastHostText, '10.0.0.3');

  const p32 = subnetInfoV4(parseIPv4('10.0.0.7').octets, 32);
  assert.equal(p32.total, 1);
  assert.equal(p32.usable, 1);
  assert.equal(p32.firstHostText, '10.0.0.7');
  assert.equal(p32.lastHostText, '10.0.0.7');
});

test('子网掩码与通配符掩码文本正确', () => {
  const info = subnetInfoV4(parseIPv4('172.16.5.9').octets, 20);
  assert.equal(info.maskText, '255.255.240.0');
  assert.equal(info.wildcardText, '0.0.15.255');
  assert.equal(info.networkText, '172.16.0.0');
  assert.equal(info.broadcastText, '172.16.15.255');
});

test('网络地址计算会规范化主机位', () => {
  assert.equal(subnetInfoV4(parseIPv4('192.168.1.200').octets, 26).networkText, '192.168.1.192');
  assert.equal(subnetInfoV4(parseIPv4('192.168.1.200').octets, 26).broadcastText, '192.168.1.255');
  assert.equal(subnetInfoV4(parseIPv4('192.168.1.200').octets, 26).usable, 62);
});

test('前缀长度越界抛出错误', () => {
  assert.throws(() => subnetInfoV4(parseIPv4('10.0.0.1').octets, 33), /0-32/);
  assert.throws(() => subnetInfoV4(parseIPv4('10.0.0.1').octets, -1), /0-32/);
});

/* ── IPv6 解析 ────────────────────────────────────────────── */

test('parseIPv6 处理完整形式与压缩形式', () => {
  const full = parseIPv6('2001:0db8:0000:0000:0000:0000:0000:0001');
  assert.equal(full.ok, true);
  assert.deepEqual(full.groups, [0x2001, 0x0db8, 0, 0, 0, 0, 0, 1]);

  const compressed = parseIPv6('2001:db8::1');
  assert.deepEqual(compressed.groups, full.groups);
});

test('parseIPv6 处理 :: 的边界情况', () => {
  assert.deepEqual(parseIPv6('::').groups, [0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(parseIPv6('::1').groups, [0, 0, 0, 0, 0, 0, 0, 1]);
  assert.deepEqual(parseIPv6('1::').groups, [1, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(parseIPv6('1:2:3:4:5:6:7:8').ok, true);
});

test('parseIPv6 处理内嵌 IPv4 与 zone id', () => {
  const mapped = parseIPv6('::ffff:192.168.1.1');
  assert.equal(mapped.ok, true);
  assert.deepEqual(mapped.groups, [0, 0, 0, 0, 0, 0xffff, 0xc0a8, 0x0101]);

  const zoned = parseIPv6('fe80::1%eth0');
  assert.equal(zoned.ok, true);
  assert.deepEqual(zoned.groups, [0xfe80, 0, 0, 0, 0, 0, 0, 1]);
});

test('parseIPv6 拒绝非法输入', () => {
  assert.equal(parseIPv6('').ok, false);
  assert.equal(parseIPv6('1:2:3:4:5:6:7').ok, false);
  assert.match(parseIPv6('1:2:3:4:5:6:7').error, /8 个分组/);
  assert.equal(parseIPv6('1:2:3:4:5:6:7:8:9').ok, false);
  assert.equal(parseIPv6('::1::2').ok, false);
  assert.match(parseIPv6('::1::2').error, /只能出现一次/);
  assert.equal(parseIPv6('gggg::1').ok, false);
  assert.equal(parseIPv6('1:2:3:4:5:6:7:8:9::').ok, false);
});

test('formatIPv6 按 RFC 5952 压缩', () => {
  assert.equal(formatIPv6([0x2001, 0x0db8, 0, 0, 0, 0, 0, 1]), '2001:db8::1');
  assert.equal(formatIPv6([0, 0, 0, 0, 0, 0, 0, 0]), '::');
  assert.equal(formatIPv6([0, 0, 0, 0, 0, 0, 0, 1]), '::1');
  assert.equal(formatIPv6([1, 0, 0, 0, 0, 0, 0, 0]), '1::');
  assert.equal(formatIPv6([0x2001, 0xdb8, 0, 1, 0, 0, 0, 1]), '2001:db8:0:1::1');
  assert.equal(formatIPv6([1, 2, 3, 4, 5, 6, 7, 8]), '1:2:3:4:5:6:7:8');
});

test('formatIPv6Full 输出 4 位补齐形式', () => {
  assert.equal(formatIPv6Full([0x2001, 0xdb8, 0, 0, 0, 0, 0, 1]), '2001:0db8:0000:0000:0000:0000:0000:0001');
});

test('IPv6 与 BigInt 互转', () => {
  const groups = [0x2001, 0xdb8, 0, 0, 0, 0, 0, 1];
  const value = ipv6ToBigInt(groups);
  assert.deepEqual(bigIntToIPv6(value), groups);
  assert.equal(value, (0x2001n << 112n) | (0x0db8n << 96n) | 1n);
});

/* ── IPv6 归属判定 ────────────────────────────────────────── */

test('ULA 用掩码判断，fd12::1 不再被误判为公网', () => {
  for (const ip of ['fc00::1', 'fd00::1', 'fd12::1', 'fdff:ffff::1']) {
    const result = classifyIPv6(parseIPv6(ip).groups);
    assert.equal(result.isPublic, false, ip);
    assert.ok(result.tags[0].includes('ULA'), ip);
  }
  // fe00 不属于 fc00::/7
  assert.equal(classifyIPv6(parseIPv6('fe00::1').groups).isPublic, true);
});

test('IPv6 特殊地址分类正确', () => {
  assert.match(classifyIPv6(parseIPv6('::').groups).tags[0], /未指定/);
  assert.match(classifyIPv6(parseIPv6('::1').groups).tags[0], /环回/);
  assert.match(classifyIPv6(parseIPv6('fe80::1').groups).tags[0], /链路本地/);
  assert.match(classifyIPv6(parseIPv6('febf::1').groups).tags[0], /链路本地/);
  assert.match(classifyIPv6(parseIPv6('ff02::1').groups).tags[0], /组播/);
  assert.match(classifyIPv6(parseIPv6('2001:db8::1').groups).tags[0], /文档/);
  assert.match(classifyIPv6(parseIPv6('::ffff:1.2.3.4').groups).tags[0], /IPv4 映射/);
  assert.match(classifyIPv6(parseIPv6('2400:3200::1').groups).tags[0], /公网/);
});

/* ── IPv6 子网 ────────────────────────────────────────────── */

test('IPv6 子网前缀计算', () => {
  const info = subnetInfoV6(parseIPv6('2001:db8:abcd:1234::1').groups, 64);
  assert.equal(info.networkText, '2001:db8:abcd:1234::');
  assert.equal(info.totalText, '18446744073709551616'); // 2^64
  assert.equal(info.lastText, '2001:db8:abcd:1234:ffff:ffff:ffff:ffff');
});

test('IPv6 /128 只有一个地址', () => {
  const info = subnetInfoV6(parseIPv6('2001:db8::1').groups, 128);
  assert.equal(info.networkText, '2001:db8::1');
  assert.equal(info.lastText, '2001:db8::1');
  assert.equal(info.totalText, '1');
});

test('IPv6 /0 覆盖整个空间', () => {
  const info = subnetInfoV6(parseIPv6('2001:db8::1').groups, 0);
  assert.equal(info.networkText, '::');
  assert.equal(info.lastText, 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff');
  assert.equal(info.totalText, '340282366920938463463374607431768211456'); // 2^128
});

test('IPv6 前缀越界抛出错误', () => {
  assert.throws(() => subnetInfoV6(parseIPv6('::1').groups, 129), /0-128/);
});

/* ── 统一入口 ─────────────────────────────────────────────── */

test('analyzeLine 自动识别四种输入类型', () => {
  assert.equal(analyzeLine('8.8.8.8').type, 'ipv4');
  assert.equal(analyzeLine('192.168.1.0/24').type, 'ipv4-cidr');
  assert.equal(analyzeLine('2001:db8::1').type, 'ipv6');
  assert.equal(analyzeLine('2001:db8::/48').type, 'ipv6-cidr');
});

test('analyzeLine 规范化地址表示', () => {
  assert.equal(analyzeLine('192.168.001.1').type, 'error');
  assert.equal(analyzeLine('2001:0DB8:0000::0001').address, '2001:db8::1');
  assert.equal(analyzeLine('::ffff:192.168.1.1').address, '::ffff:c0a8:101');
});

test('analyzeLine 对越界前缀给出错误而不是抛异常', () => {
  const result = analyzeLine('192.168.1.1/33');
  assert.equal(result.type, 'error');
  assert.match(result.error, /32/);

  const v6 = analyzeLine('2001:db8::1/200');
  assert.equal(v6.type, 'error');
  assert.match(v6.error, /128/);
});

test('analyzeLine 报错信息贴近真实原因', () => {
  assert.match(analyzeLine('192.168.1.300').error, /255/);
  assert.match(analyzeLine('192.168.1').error, /4 段/);
  assert.match(analyzeLine('2001:db8:::1').error, /分组|::/);
});

test('analyze 按行批量处理并忽略空行', () => {
  const results = analyze('8.8.8.8\n\n  192.168.1.0/24  \n\n2001:db8::1');
  assert.equal(results.length, 3);
  assert.deepEqual(results.map((r) => r.type), ['ipv4', 'ipv4-cidr', 'ipv6']);
});

test('analyze 对空输入返回空数组', () => {
  assert.deepEqual(analyze(''), []);
  assert.deepEqual(analyze('\n\n'), []);
});
