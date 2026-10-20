/* EXIF 元数据解析 —— 纯逻辑层。
 *
 * 路径：JPEG 的 APP1 段 → "Exif\0\0" → TIFF 头（字节序 + IFD 偏移）→ IFD 条目。
 * 同时支持小端（II）与大端（MM）两种字节序 —— 很多手机拍出来的照片是大端的。
 *
 * 只读取需要的标签，遇到不认识的标签跳过；任何越界都会安全返回，
 * 因为真实照片里的 EXIF 经常是被截断或被编辑软件写坏的。
 */

/* ── 标签名表 ─────────────────────────────────────────────── */

const TAG_NAMES = {
  // IFD0
  0x0100: '图像宽度',
  0x0101: '图像高度',
  0x010e: '图像描述',
  0x010f: '制造商',
  0x0110: '机型',
  0x0112: '方向',
  0x011a: '水平分辨率',
  0x011b: '垂直分辨率',
  0x0128: '分辨率单位',
  0x0131: '软件',
  0x0132: '修改时间',
  0x013b: '作者',
  0x013e: '白点',
  0x013f: '主色',
  0x0213: 'YCbCr 排列',
  0x8298: '版权',
  0x8769: 'Exif 子目录',
  0x8825: 'GPS 子目录',
  // Exif 子目录
  0x829a: '曝光时间',
  0x829d: '光圈值',
  0x8822: '曝光程序',
  0x8827: 'ISO',
  0x8830: '感光度类型',
  0x9000: 'Exif 版本',
  0x9003: '拍摄时间',
  0x9004: '数字化时间',
  0x9101: '分量配置',
  0x9201: '快门速度',
  0x9202: '光圈',
  0x9204: '曝光补偿',
  0x9205: '最大光圈',
  0x9207: '测光模式',
  0x9208: '光源',
  0x9209: '闪光灯',
  0x920a: '焦距',
  0x927c: '制造商注释',
  0x9286: '用户注释',
  0x9290: '秒以下时间',
  0x9291: '原始秒以下时间',
  0x9292: '数字化秒以下时间',
  0xa000: 'FlashPix 版本',
  0xa001: '色彩空间',
  0xa002: '像素宽度',
  0xa003: '像素高度',
  0xa20e: '焦平面水平分辨率',
  0xa20f: '焦平面垂直分辨率',
  0xa210: '焦平面分辨率单位',
  0xa217: '感光方式',
  0xa300: '文件来源',
  0xa301: '场景类型',
  0xa401: '自定义渲染',
  0xa402: '曝光模式',
  0xa403: '白平衡',
  0xa404: '数字变焦',
  0xa405: '等效 35mm 焦距',
  0xa406: '场景拍摄类型',
  0xa407: '增益控制',
  0xa408: '对比度',
  0xa409: '饱和度',
  0xa40a: '锐度',
  0xa430: '相机所有者',
  0xa431: '机身序列号',
  0xa432: '镜头规格',
  0xa433: '镜头制造商',
  0xa434: '镜头型号',
  0xa435: '镜头序列号'
};

const GPS_TAG_NAMES = {
  0x0000: 'GPS 版本',
  0x0001: '北纬/南纬',
  0x0002: '纬度',
  0x0003: '东经/西经',
  0x0004: '经度',
  0x0005: '海拔基准',
  0x0006: '海拔',
  0x0007: '时间（UTC）',
  0x001d: '日期',
  0x0010: '拍摄方向',
  0x0011: '拍摄方向基准',
  0x0012: '地图基准',
  0x001d: 'GPS 日期'
};

export const ORIENTATION_LABELS = {
  1: '正常',
  2: '水平镜像',
  3: '旋转 180°',
  4: '垂直镜像',
  5: '顺时针 90° 后镜像',
  6: '顺时针 90°',
  7: '逆时针 90° 后镜像',
  8: '逆时针 90°'
};

export const COLOR_SPACE_LABELS = { 1: 'sRGB', 65535: '未校准' };

export const EXPOSURE_PROGRAM_LABELS = {
  0: '未定义', 1: '手动', 2: '程序自动', 3: '光圈优先', 4: '快门优先',
  5: '创意模式', 6: '动作模式', 7: '人像模式', 8: '风景模式'
};

export const FLASH_LABELS = {
  0x0: '未闪光', 0x1: '闪光', 0x5: '闪光但未检测到反射光', 0x7: '闪光并检测到反射光',
  0x9: '强制闪光', 0xd: '强制闪光但未检测到反射光', 0xf: '强制闪光并检测到反射光',
  0x10: '关闭闪光', 0x18: '自动、未闪光', 0x19: '自动、闪光',
  0x1d: '自动、闪光但未检测到反射光', 0x1f: '自动、闪光并检测到反射光',
  0x20: '无闪光功能'
};

export const WHITE_BALANCE_LABELS = { 0: '自动', 1: '手动' };
export const METERING_LABELS = {
  0: '未知', 1: '平均', 2: '中央重点平均', 3: '点测光', 4: '多点测光', 5: '评价测光', 6: '局部测光', 255: '其它'
};

/* ── TIFF 读取器 ──────────────────────────────────────────── */

const TYPE_SIZES = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };

class TiffReader {
  constructor(bytes, littleEndian) {
    this.bytes = bytes;
    this.little = littleEndian;
  }

  inRange(offset, length) {
    return offset >= 0 && offset + length <= this.bytes.length;
  }

  uint16(offset) {
    if (!this.inRange(offset, 2)) return null;
    const a = this.bytes[offset];
    const b = this.bytes[offset + 1];
    return this.little ? a | (b << 8) : (a << 8) | b;
  }

  uint32(offset) {
    if (!this.inRange(offset, 4)) return null;
    const b = this.bytes;
    if (this.little) {
      return (b[offset] | (b[offset + 1] << 8) | (b[offset + 2] << 16) | (b[offset + 3] << 24)) >>> 0;
    }
    return ((b[offset] << 24) | (b[offset + 1] << 16) | (b[offset + 2] << 8) | b[offset + 3]) >>> 0;
  }

  int32(offset) {
    const value = this.uint32(offset);
    if (value === null) return null;
    return value > 0x7fffffff ? value - 0x100000000 : value;
  }

  /** 读取一个 IFD 条目的值。返回数字数组或字符串。 */
  readValues(type, count, valueOffset) {
    const size = TYPE_SIZES[type];
    if (!size || count <= 0 || count > 100000) return null;

    const total = size * count;
    // 总长度不超过 4 字节时值直接内联在条目里
    const offset = total <= 4 ? valueOffset : this.uint32(valueOffset);
    if (offset === null || !this.inRange(offset, total)) return null;

    if (type === 2) {
      let text = '';
      for (let i = 0; i < count; i += 1) {
        const code = this.bytes[offset + i];
        if (code === 0) break;
        text += String.fromCharCode(code);
      }
      return text.trim();
    }

    const values = [];
    for (let i = 0; i < count; i += 1) {
      const at = offset + i * size;
      if (type === 1 || type === 7) values.push(this.bytes[at]);
      else if (type === 3) values.push(this.uint16(at));
      else if (type === 4) values.push(this.uint32(at));
      else if (type === 6) values.push((this.bytes[at] << 24) >> 24);
      else if (type === 8) {
        const raw = this.uint16(at);
        values.push(raw > 0x7fff ? raw - 0x10000 : raw);
      } else if (type === 9) values.push(this.int32(at));
      else if (type === 5 || type === 10) {
        const numerator = type === 5 ? this.uint32(at) : this.int32(at);
        const denominator = type === 5 ? this.uint32(at + 4) : this.int32(at + 4);
        values.push(denominator === 0 ? null : numerator / denominator);
      } else return null;
    }
    // 只有一个值时返回标量。返回数组会让 Number.isFinite([x]) 变成 false，
    // 曝光时间、海拔这类单值 RATIONAL 就会被静默丢掉。
    return count === 1 ? values[0] : values;
  }

  /** 遍历一个 IFD，回调每条的 (tag, type, count, valueOrOffset)。 */
  walkIfd(ifdOffset, visit, depth = 0) {
    if (depth > 3) return;
    const count = this.uint16(ifdOffset);
    if (count === null || count > 512) return;

    for (let i = 0; i < count; i += 1) {
      const entry = ifdOffset + 2 + i * 12;
      if (!this.inRange(entry, 12)) return;
      const tag = this.uint16(entry);
      const type = this.uint16(entry + 2);
      const valueCount = this.uint32(entry + 4);
      if (tag === null || type === null || valueCount === null) return;
      visit(tag, type, valueCount, entry + 8, depth);
    }
  }
}

/* ── 定位 Exif 段 ─────────────────────────────────────────── */

/** 从 JPEG 字节流里找出 Exif 的 TIFF 块（跳过 "Exif\0\0"）。 */
export function findExifBlock(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 4) return null;
  if (!(bytes[0] === 0xff && bytes[1] === 0xd8)) return null;

  let offset = 2;
  while (offset + 2 < bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1];
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) break;

    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2) break;

    // APP1 且以 "Exif\0\0" 开头
    if (marker === 0xe1 && offset + 10 < bytes.length) {
      const signature = String.fromCharCode(...bytes.subarray(offset + 4, offset + 10));
      if (signature === 'Exif\0\0') {
        return bytes.subarray(offset + 10, offset + 2 + length);
      }
    }
    // APP1 之外的段里也可能有 Exif，但只有 APP1 是标准位置
    if (marker === 0xe1 && offset + 4 + length > bytes.length) break;

    offset += 2 + length;
  }

  return null;
}

/* ── 主解析 ───────────────────────────────────────────────── */

function formatRational(value, { decimals = 2 } = {}) {
  if (value === null || !Number.isFinite(value)) return null;
  if (value !== 0 && Math.abs(value) < 0.01) return `1/${Math.round(1 / value)}`;
  return Number(value.toFixed(decimals));
}

/** 把 EXIF 的度分秒表示换算成十进制度数。 */
export function dmsToDecimal(dms, ref) {
  if (!Array.isArray(dms) || dms.length < 3) return null;
  const [degrees, minutes, seconds] = dms;
  if (![degrees, minutes, seconds].every((value) => typeof value === 'number' && Number.isFinite(value))) return null;
  let decimal = degrees + minutes / 60 + seconds / 3600;
  const upper = String(ref ?? '').toUpperCase();
  if (upper === 'S' || upper === 'W') decimal = -decimal;
  return Number(decimal.toFixed(6));
}

/**
 * 解析 JPEG 的 EXIF。
 * @returns {{ok:boolean, found:boolean, reason?:string, tags:Array, gps?:object}}
 */
export function parseExif(bytes) {
  const block = findExifBlock(bytes);
  if (!block) {
    return { ok: true, found: false, reason: '这张图里没有 EXIF 信息（PNG/GIF/WebP 通常就没有，或被导出时被清除了）', tags: [] };
  }

  if (block.length < 8) return { ok: false, found: false, reason: 'EXIF 数据不完整', tags: [] };

  const order = String.fromCharCode(block[0], block[1]);
  if (order !== 'II' && order !== 'MM') {
    return { ok: false, found: false, reason: `EXIF 字节序标记异常：${JSON.stringify(order)}`, tags: [] };
  }

  const reader = new TiffReader(block, order === 'II');
  if (reader.uint16(2) !== 42) {
    return { ok: false, found: false, reason: 'EXIF 的 TIFF 头校验失败（魔数不是 42）', tags: [] };
  }

  const ifd0 = reader.uint32(4);
  if (ifd0 === null || !reader.inRange(ifd0, 2)) {
    return { ok: false, found: false, reason: 'EXIF 的 IFD 偏移越界（数据已损坏）', tags: [] };
  }

  const entries = new Map();
  const gpsEntries = new Map();
  let exifIfdOffset = null;
  let gpsIfdOffset = null;

  // IFD0
  reader.walkIfd(ifd0, (tag, type, count, valueOffset) => {
    if (tag === 0x8769) {
      exifIfdOffset = reader.uint32(valueOffset);
      return;
    }
    if (tag === 0x8825) {
      gpsIfdOffset = reader.uint32(valueOffset);
      return;
    }
    const value = reader.readValues(type, count, valueOffset);
    if (value !== null) entries.set(tag, { type, count, value });
  });

  // Exif 子目录（拍摄参数都在这里）
  if (exifIfdOffset) {
    reader.walkIfd(exifIfdOffset, (tag, type, count, valueOffset) => {
      const value = reader.readValues(type, count, valueOffset);
      if (value !== null) entries.set(tag, { type, count, value });
    }, 1);
  }

  // GPS 子目录
  if (gpsIfdOffset) {
    reader.walkIfd(gpsIfdOffset, (tag, type, count, valueOffset) => {
      const value = reader.readValues(type, count, valueOffset);
      if (value !== null) gpsEntries.set(tag, value);
    }, 1);
  }

  const pick = (tag) => {
    const entry = entries.get(tag);
    return entry === undefined ? null : entry.value;
  };

  const tags = [];
  const push = (tag, label, value, hint) => {
    if (value === null || value === undefined || value === '') return;
    tags.push({ tag, label, value: String(value), hint: hint || '' });
  };

  push(0x010f, '制造商', pick(0x010f));
  push(0x0110, '机型', pick(0x0110));
  push(0x0131, '软件', pick(0x0131));

  const orientation = entries.get(0x0112)?.value;
  push(0x0112, '方向', orientation, ORIENTATION_LABELS[orientation] || '');

  const dateTime = pick(0x9003) || pick(0x0132);
  push(0x9003, '拍摄时间', dateTime);

  const exposure = entries.get(0x829a)?.value;
  push(0x829a, '曝光时间', formatRational(exposure, { decimals: 4 }), exposure !== null && exposure < 1 ? `${formatRational(exposure)} 秒` : '');

  const fNumber = entries.get(0x829d)?.value;
  push(0x829d, '光圈', fNumber === null ? null : `f/${Number(fNumber).toFixed(1)}`);

  const iso = pick(0x8827);
  push(0x8827, 'ISO', Array.isArray(iso) ? iso.join(', ') : iso);

  const focal = entries.get(0x920a)?.value;
  push(0x920a, '焦距', focal === null ? null : `${Number(focal).toFixed(1)} mm`);

  const focal35 = entries.get(0xa405)?.value;
  push(0xa405, '等效 35mm 焦距', focal35 === null ? null : `${focal35} mm`);

  const flash = entries.get(0x9209)?.value;
  push(0x9209, '闪光灯', flash, FLASH_LABELS[flash] || '');

  const program = entries.get(0x8822)?.value;
  push(0x8822, '曝光程序', program, EXPOSURE_PROGRAM_LABELS[program] || '');

  const metering = entries.get(0x9207)?.value;
  push(0x9207, '测光模式', metering, METERING_LABELS[metering] || '');

  const whiteBalance = entries.get(0xa403)?.value;
  push(0xa403, '白平衡', whiteBalance, WHITE_BALANCE_LABELS[whiteBalance] || '');

  const colorSpace = entries.get(0xa001)?.value;
  push(0xa001, '色彩空间', colorSpace, COLOR_SPACE_LABELS[colorSpace] || '');

  const exposureBias = entries.get(0x9204)?.value;
  push(0x9204, '曝光补偿', exposureBias === null ? null : `${exposureBias > 0 ? '+' : ''}${exposureBias} EV`);

  push(0xa434, '镜头型号', pick(0xa434));
  push(0xa433, '镜头制造商', pick(0xa433));
  push(0xa431, '机身序列号', pick(0xa431));
  push(0x013b, '作者', pick(0x013b));
  push(0x8298, '版权', pick(0x8298));

  // GPS
  let gps = null;
  if (gpsEntries.size) {
    const latitude = dmsToDecimal(gpsEntries.get(0x0002), gpsEntries.get(0x0001));
    const longitude = dmsToDecimal(gpsEntries.get(0x0004), gpsEntries.get(0x0003));
    const altitude = gpsEntries.get(0x0006);
    if (latitude !== null && longitude !== null) {
      gps = {
        latitude,
        longitude,
        altitude: typeof altitude === 'number' ? Number(altitude.toFixed(2)) : null,
        mapsUrl: `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=16/${latitude}/${longitude}`
      };
    } else {
      gps = { latitude: null, longitude: null, altitude: null, mapsUrl: '' };
    }
  }

  return {
    ok: true,
    found: tags.length > 0 || gps !== null,
    tags,
    gps,
    reason: tags.length || gps ? '' : '有 EXIF 段，但没有本工具关注的字段',
    byteOrder: order === 'II' ? '小端（II）' : '大端（MM）',
    exifTagCount: entries.size,
    gpsTagCount: gpsEntries.size,
    tagNames: TAG_NAMES,
    gpsTagNames: GPS_TAG_NAMES
  };
}

/** 把字节按 AI 可能识别出的文字做一次粗略提取，用于「文件里还有什么」的排查。 */
export function listUnknownTags(bytes, knownTags) {
  const block = findExifBlock(bytes);
  if (!block || block.length < 8) return [];
  const order = String.fromCharCode(block[0], block[1]);
  if (order !== 'II' && order !== 'MM') return [];

  const reader = new TiffReader(block, order === 'II');
  const ifd0 = reader.uint32(4);
  if (ifd0 === null) return [];

  const known = new Set(knownTags);
  const unknown = new Set();
  reader.walkIfd(ifd0, (tag) => {
    if (!known.has(tag)) unknown.add(tag);
  });
  return [...unknown].map((tag) => `0x${tag.toString(16).padStart(4, '0')}`);
}
