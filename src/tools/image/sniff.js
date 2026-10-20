/* 图像格式识别与尺寸读取 —— 纯逻辑层。
 *
 * 只读文件头的几十个字节就能得出格式与宽高，不需要解码整张图。
 * 用途：上传前先做校验、批量统计、确认文件是不是伪装了扩展名。
 *
 * 覆盖 PNG / JPEG / GIF / WebP / BMP / AVIF / HEIC；
 * AVIF 与 HEIC 只识别类型，尺寸需要解析 ISO BMFF 的 ispe 盒，这里不做（会明确说明）。
 */

/** 从字节流按魔数判断格式。 */
export function sniffImageType(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 4) return null;

  const ascii = (start, length) => {
    let text = '';
    for (let i = start; i < start + length && i < bytes.length; i += 1) text += String.fromCharCode(bytes[i]);
    return text;
  };

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return { mime: 'image/png', extension: 'png', label: 'PNG', lossy: false, alpha: true };
  }

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: 'image/jpeg', extension: 'jpg', label: 'JPEG', lossy: true, alpha: false };
  }

  // GIF: GIF87a / GIF89a
  if (ascii(0, 3) === 'GIF' && (ascii(3, 3) === '87a' || ascii(3, 3) === '89a')) {
    return { mime: 'image/gif', extension: 'gif', label: 'GIF', lossy: false, alpha: true };
  }

  // WebP: RIFF....WEBP
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    return { mime: 'image/webp', extension: 'webp', label: 'WebP', lossy: true, alpha: true };
  }

  // BMP: BM
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return { mime: 'image/bmp', extension: 'bmp', label: 'BMP', lossy: false, alpha: false };
  }

  // ISO BMFF：ftyp 盒 + 品牌
  if (ascii(4, 4) === 'ftyp') {
    const brand = ascii(8, 4);
    if (brand === 'avif' || brand === 'avis') {
      return { mime: 'image/avif', extension: 'avif', label: 'AVIF', lossy: true, alpha: true, sizeReadable: false };
    }
    if (['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand)) {
      return { mime: 'image/heic', extension: 'heic', label: 'HEIC', lossy: true, alpha: true, sizeReadable: false };
    }
  }

  return null;
}

function readUint16BE(bytes, offset) {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readUint32BE(bytes, offset) {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function readUint16LE(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint32LE(bytes, offset) {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

/* ── 各格式的尺寸解析 ─────────────────────────────────────── */

function parsePng(bytes) {
  if (bytes.length < 24) return null;
  // 第一个块必须是 IHDR
  if (String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR') return null;
  const width = readUint32BE(bytes, 16);
  const height = readUint32BE(bytes, 20);
  return { width, height, bitDepth: bytes[24], colorType: bytes[25] };
}

function parseJpeg(bytes) {
  let offset = 2;

  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];

    // 填充字节
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    // 无参数标记
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    // 图像数据开始，后面不再有尺寸信息
    if (marker === 0xda || marker === 0xd9) return null;

    const length = readUint16BE(bytes, offset + 2);
    if (length < 2) return null;

    // SOF0-SOF15，排除 DHT(C4) / JPG(C8) / DAC(CC)
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (offset + 9 > bytes.length) return null;
      return {
        width: readUint16BE(bytes, offset + 7),
        height: readUint16BE(bytes, offset + 5),
        components: bytes[offset + 9],
        progressive: marker === 0xc2 || marker === 0xc6 || marker === 0xca
      };
    }

    offset += 2 + length;
  }

  return null;
}

function parseGif(bytes) {
  if (bytes.length < 10) return null;
  return { width: readUint16LE(bytes, 6), height: readUint16LE(bytes, 8) };
}

function parseWebp(bytes) {
  if (bytes.length < 16) return null;
  const chunk = String.fromCharCode(...bytes.subarray(12, 16));

  if (chunk === 'VP8X') {
    if (bytes.length < 30) return null;
    // 24 位小端存的是「宽-1」「高-1」
    const width = (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)) + 1;
    const height = (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) + 1;
    return { width, height, variant: 'extended' };
  }

  if (chunk === 'VP8 ') {
    // 帧头 3 字节 + 起始码 9D 01 2A，之后是 14 位宽与 14 位高
    const start = 20;
    if (bytes.length < start + 7) return null;
    if (!(bytes[start + 3] === 0x9d && bytes[start + 4] === 0x01 && bytes[start + 5] === 0x2a)) return null;
    const width = readUint16LE(bytes, start + 6) & 0x3fff;
    const height = readUint16LE(bytes, start + 8) & 0x3fff;
    return { width, height, variant: 'lossy' };
  }

  if (chunk === 'VP8L') {
    if (bytes.length < 25) return null;
    if (bytes[20] !== 0x2f) return null;
    // 14 位宽 + 14 位高，各自存的是「值-1」，紧接在签名字节之后
    const bits = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >>> 14) & 0x3fff) + 1,
      variant: 'lossless'
    };
  }

  return null;
}

function parseBmp(bytes) {
  if (bytes.length < 26) return null;
  const headerSize = readUint32LE(bytes, 14);
  if (headerSize < 12) return null;

  if (headerSize === 12) {
    // BITMAPCOREHEADER：16 位宽高
    return { width: readUint16LE(bytes, 18), height: readUint16LE(bytes, 20), variant: 'core' };
  }

  // 高度可能为负，表示自上而下存储
  const width = readUint32LE(bytes, 18);
  const rawHeight = readUint32LE(bytes, 22);
  const height = rawHeight > 0x7fffffff ? 0x100000000 - rawHeight : rawHeight;
  return { width, height, topDown: rawHeight > 0x7fffffff };
}

/* ── 对外入口 ─────────────────────────────────────────────── */

/**
 * 读取图像尺寸与格式。
 * @returns {{ok:true, type:object, width:number, height:number, details:object}|{ok:false, reason:string, type:object|null}}
 */
export function parseImageInfo(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
    return { ok: false, reason: '内容为空', type: null };
  }

  const type = sniffImageType(bytes);
  if (!type) return { ok: false, reason: '无法识别的图像格式（支持的头部：PNG / JPEG / GIF / WebP / BMP / AVIF / HEIC）', type: null };

  if (type.sizeReadable === false) {
    return { ok: false, reason: `${type.label} 的尺寸需要解析 ISO BMFF 盒结构，本工具暂不支持`, type };
  }

  let parsed = null;
  try {
    if (type.mime === 'image/png') parsed = parsePng(bytes);
    else if (type.mime === 'image/jpeg') parsed = parseJpeg(bytes);
    else if (type.mime === 'image/gif') parsed = parseGif(bytes);
    else if (type.mime === 'image/webp') parsed = parseWebp(bytes);
    else if (type.mime === 'image/bmp') parsed = parseBmp(bytes);
  } catch {
    return { ok: false, reason: '文件头损坏，读取尺寸时出错', type };
  }

  if (!parsed || !parsed.width || !parsed.height) {
    return { ok: false, reason: '文件头不完整，读不到尺寸（可能是被截断的文件）', type };
  }

  return {
    ok: true,
    type,
    width: parsed.width,
    height: parsed.height,
    details: parsed
  };
}

/** 扩展名与 MIME 的互查，供界面与文件名生成使用。 */
export const MIME_BY_EXTENSION = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  avif: 'image/avif',
  heic: 'image/heic'
};

/** 浏览器 canvas 能导出的格式（比能识别的格式少）。 */
export const EXPORT_FORMATS = [
  { mime: 'image/png', label: 'PNG', extension: 'png', lossy: false, alpha: true, note: '无损、支持透明，体积最大' },
  { mime: 'image/jpeg', label: 'JPEG', extension: 'jpg', lossy: true, alpha: false, note: '有损、不支持透明，照片首选' },
  { mime: 'image/webp', label: 'WebP', extension: 'webp', lossy: true, alpha: true, note: '同样画质下通常比 JPEG 更小' }
];

export function mimeForExtension(extension) {
  return MIME_BY_EXTENSION[String(extension ?? '').toLowerCase().replace(/^\./, '')] || null;
}

export function extensionForMime(mime) {
  const found = Object.entries(MIME_BY_EXTENSION).find(([, value]) => value === mime);
  return found ? found[0] : null;
}
