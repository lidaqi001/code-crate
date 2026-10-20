/* 本地存储包装：统一命名空间 + JSON 序列化 + 失败兜底。
   使用 localStorage（扩展页面同源共享），因此扩展无需申请任何权限。 */

const PREFIX = 'codecrate:';
const LEGACY_PREFIX = 'devkit:';
const MIGRATED_FLAG = 'migrated';

/** 把旧命名空间 devkit: 的数据一次性搬到 codecrate:，升级后不丢偏好与历史。 */
export function migrateLegacyKeys() {
  try {
    if (localStorage.getItem(PREFIX + MIGRATED_FLAG) !== null) return;
    const legacy = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith(LEGACY_PREFIX)) legacy.push(key);
    }
    for (const key of legacy) {
      const target = PREFIX + key.slice(LEGACY_PREFIX.length);
      const value = localStorage.getItem(key);
      if (value !== null && localStorage.getItem(target) === null) {
        localStorage.setItem(target, value);
      }
      localStorage.removeItem(key);
    }
    localStorage.setItem(PREFIX + MIGRATED_FLAG, JSON.stringify(true));
  } catch {
    /* 存储不可用或配额不足时忽略，下次启动再试 */
  }
}

migrateLegacyKeys();

export function read(key, fallback = null) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function write(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function drop(key) {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* 忽略 */
  }
}

/** 记住某工具最后一次输入，避免用户每次重开都要重新粘贴。 */
export function recall(id, fallback = '') {
  const value = read(`tool:${id}`, fallback);
  return typeof value === 'string' ? value : fallback;
}

export function remember(id, value) {
  return write(`tool:${id}`, String(value ?? ''));
}
