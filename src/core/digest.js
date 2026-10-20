/* 非加密摘要的共享实现：MD5 与 CRC32。
   WebCrypto 不提供 MD5，而文件校验、接口签名等场景又确实需要，因此自行实现。
   输入接受 Uint8Array 或字符串；字符串按 UTF-8 编码，和浏览器/命令行结果一致。 */

const encoder = new TextEncoder();

function toBytes(input) {
  return input instanceof Uint8Array ? input : encoder.encode(String(input));
}

const MD5_SHIFTS = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
];

const MD5_K = (() => {
  const table = new Uint32Array(64);
  for (let i = 0; i < 64; i += 1) table[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);
  return table;
})();

/** MD5，返回小写十六进制。 */
export function md5Bytes(input) {
  const bytes = toBytes(input);
  const paddedLength = ((bytes.length + 8) >> 6 << 6) + 64;
  const buffer = new Uint8Array(paddedLength);
  buffer.set(bytes);
  buffer[bytes.length] = 0x80;

  const view = new DataView(buffer.buffer);
  const bitLength = bytes.length * 8;
  view.setUint32(paddedLength - 8, bitLength >>> 0, true);
  view.setUint32(paddedLength - 4, Math.floor(bitLength / 4294967296), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  const words = new Uint32Array(16);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i += 1) words[i] = view.getUint32(offset + i * 4, true);
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;

    for (let i = 0; i < 64; i += 1) {
      let f;
      let g;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      f = (f + a + MD5_K[i] + words[g]) >>> 0;
      a = d;
      d = c;
      c = b;
      const shift = MD5_SHIFTS[i];
      b = (b + ((f << shift) | (f >>> (32 - shift)))) >>> 0;
    }

    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  const out = new Uint8Array(16);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, a0, true);
  outView.setUint32(4, b0, true);
  outView.setUint32(8, c0, true);
  outView.setUint32(12, d0, true);
  return [...out].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

/** CRC32，返回 8 位小写十六进制。 */
export function crc32Bytes(input) {
  const bytes = toBytes(input);
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0');
}
