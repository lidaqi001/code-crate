/* 压缩与解压 —— 纯逻辑层，基于浏览器原生 CompressionStream / DecompressionStream。
 *
 * 支持三种格式：
 *   gzip        带 10 字节头部与 CRC，最常用于 .gz 与 HTTP Content-Encoding
 *   deflate     zlib 包装（带 2 字节头 + Adler-32 校验），即 zlib 格式
 *   deflate-raw 裸 deflate 流，没有头部也没有校验
 *
 * 解压时会先看魔数猜格式；猜不准就三种依次尝试，全失败才报错，
 * 因此从别人那里拿到一段 base64 数据时不需要自己判断格式。
 */

import {
  bytesToHex,
  bytesToBase64,
  base64ToBytes,
  hexToBytes,
  textToBytes,
  bytesToText,
  concatBytes
} from '../../core/bytes.js';

export const FORMATS = [
  { id: 'gzip', label: 'GZIP', stream: 'gzip', header: '1f 8b', note: '.gz 文件、HTTP Content-Encoding: gzip' },
  { id: 'deflate', label: 'ZLIB (deflate)', stream: 'deflate', header: '78 xx', note: 'zlib 格式，带 Adler-32 校验' },
  { id: 'deflate-raw', label: '原始 DEFLATE', stream: 'deflate-raw', header: '无', note: '裸 deflate 流，无头部无校验' }
];

export const INPUT_FORMATS = [
  { id: 'text', label: '文本' },
  { id: 'base64', label: 'Base64' },
  { id: 'hex', label: '十六进制' }
];

export const OUTPUT_FORMATS = [
  { id: 'base64', label: 'Base64' },
  { id: 'hex', label: '十六进制' }
];

export function getFormat(id) {
  return FORMATS.find((entry) => entry.id === id) || null;
}

/* ── 流式处理 ─────────────────────────────────────────────── */

async function pipe(bytes, stream) {
  const writer = stream.writable.getWriter();

  // 立刻挂上 catch：数据非法时读取端与写入端都会失败，
  // 如果只 await 读取端，写入端的 rejection 会变成未处理的 Promise 拒绝（Node 会因此崩溃）。
  let writeError = null;
  const writing = writer
    .write(bytes)
    .then(() => writer.close())
    .catch((error) => {
      writeError = error;
    });

  const reader = stream.readable.getReader();
  const chunks = [];
  let readError = null;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
  } catch (error) {
    readError = error;
  }

  await writing;

  if (readError) throw readError;
  if (writeError) throw writeError;

  return concatBytes(...chunks);
}

function streamFor(formatId, direction) {
  const format = getFormat(formatId);
  if (!format) throw new Error(`未知的压缩格式：${formatId}`);
  const Ctor = direction === 'compress' ? CompressionStream : DecompressionStream;
  try {
    return new Ctor(format.stream);
  } catch {
    throw new Error(`当前环境不支持 ${format.label}`);
  }
}

async function compressBytes(formatId, bytes) {
  if (!(bytes instanceof Uint8Array)) throw new Error('输入需要是字节');
  return pipe(bytes, streamFor(formatId, 'compress'));
}

async function decompressBytes(formatId, bytes) {
  if (!(bytes instanceof Uint8Array)) throw new Error('输入需要是字节');
  if (bytes.length === 0) throw new Error('输入为空，无法解压');
  try {
    return await pipe(bytes, streamFor(formatId, 'decompress'));
  } catch {
    const format = getFormat(formatId);
    throw new Error(`无法按 ${format ? format.label : formatId} 解压：数据损坏或格式不匹配`);
  }
}

export { compressBytes, decompressBytes };

/* ── 格式识别 ─────────────────────────────────────────────── */

/**
 * 根据魔数猜压缩格式。
 * zlib 的头部两个字节满足：(CMF << 8 | FLG) % 31 === 0 且低 4 位是 8（deflate 方法）。
 */
export function detectFormat(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
    return { id: null, label: '空输入', confident: false };
  }

  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    return { id: 'gzip', label: 'GZIP', confident: true };
  }

  if (bytes.length >= 2 && (bytes[0] & 0x0f) === 8 && ((bytes[0] << 8) | bytes[1]) % 31 === 0) {
    return { id: 'deflate', label: 'ZLIB (deflate)', confident: true };
  }

  return { id: 'deflate-raw', label: '可能是原始 DEFLATE', confident: false };
}

/**
 * 依次尝试三种格式解压，返回第一个成功的。
 * @returns {Promise<{ok:true, format:string, data:Uint8Array, guessed:boolean}|{ok:false, error:string}>}
 */
export async function decompressAuto(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
    return { ok: false, error: '输入为空，无法解压' };
  }

  const detected = detectFormat(bytes);
  const order = detected.confident
    ? [detected.id, ...FORMATS.map((entry) => entry.id).filter((id) => id !== detected.id)]
    : FORMATS.map((entry) => entry.id);

  const failures = [];
  for (const formatId of order) {
    try {
      const data = await decompressBytes(formatId, bytes);
      return { ok: true, format: formatId, data, guessed: !detected.confident || detected.id !== formatId };
    } catch (error) {
      failures.push(getFormat(formatId).label);
    }
  }

  return { ok: false, error: `三种格式都无法解压（已尝试 ${failures.join('、')}），数据可能不是压缩内容` };
}

/* ── 输入输出转换 ─────────────────────────────────────────── */

export function parseInput(text, format = 'base64') {
  const source = String(text ?? '').replace(/\s+/g, '');
  if (source === '') throw new Error('输入为空');
  if (format === 'hex') return hexToBytes(source);
  if (format === 'base64') return base64ToBytes(source);
  return textToBytes(text);
}

export function formatOutput(bytes, format = 'base64', { group = 0 } = {}) {
  if (format === 'hex') {
    const hex = bytesToHex(bytes);
    if (group <= 0) return hex;
    const parts = [];
    for (let i = 0; i < hex.length; i += group) parts.push(hex.slice(i, i + group));
    return parts.join(' ');
  }
  return bytesToBase64(bytes);
}

/** 尝试把字节当 UTF-8 文本读出来，用于判断要不要展示可读结果。 */
export function tryReadText(bytes) {
  const text = bytesToText(bytes);
  // 含替换字符说明不是合法 UTF-8 文本
  if (text.includes('\uFFFD')) return { ok: false, text: '' };
  const control = [...text].filter((char) => {
    const code = char.charCodeAt(0);
    return code < 32 && char !== '\n' && char !== '\r' && char !== '\t';
  }).length;
  if (text.length > 0 && control / text.length > 0.05) return { ok: false, text: '' };
  return { ok: true, text };
}

/* ── 概览 ─────────────────────────────────────────────────── */

export function describeCompression(original, compressed) {
  const originalSize = original.length;
  const compressedSize = compressed.length;
  const ratio = originalSize === 0 ? 0 : compressedSize / originalSize;
  return {
    originalSize,
    compressedSize,
    ratio,
    percent: originalSize === 0 ? 0 : (1 - ratio) * 100,
    savedBytes: originalSize - compressedSize,
    // 压缩后反而变大是正常现象（头部开销大于内容）
    expanded: compressedSize > originalSize
  };
}

/**
 * 一次完成「解压 + 转文本」或「压缩 + 转输出」，供界面直接调用。
 */
export async function run({
  direction,
  format,
  inputText,
  inputFormat = 'base64',
  outputFormat = 'base64',
  group = 0
}) {
  if (direction === 'decompress') {
    const bytes = parseInput(inputText, inputFormat);

    // format 传 'auto' 或未指定时自动识别；指定了具体格式就强制按它解压，
    // 否则界面上「强制按 GZIP」这类选项会毫无作用。
    const forced = format && format !== 'auto' ? getFormat(format) : null;
    let result;
    if (forced) {
      try {
        result = { ok: true, format: forced.id, data: await decompressBytes(forced.id, bytes), guessed: false };
      } catch (error) {
        result = { ok: false, error: error.message };
      }
    } else {
      result = await decompressAuto(bytes);
    }

    if (!result.ok) return { ok: false, error: result.error };

    const text = tryReadText(result.data);
    return {
      ok: true,
      format: result.format,
      guessed: result.guessed,
      output: formatOutput(result.data, outputFormat, { group }),
      text: text.ok ? text.text : null,
      size: result.data.length,
      inputSize: bytes.length
    };
  }

  const bytes = parseInput(inputText, inputFormat === 'text' ? 'text' : inputFormat);
  const compressed = await compressBytes(format, bytes);
  const info = describeCompression(bytes, compressed);
  return {
    ok: true,
    format,
    output: formatOutput(compressed, outputFormat, { group }),
    size: compressed.length,
    inputSize: bytes.length,
    info
  };
}
