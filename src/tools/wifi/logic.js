/* Wi-Fi 二维码 —— 纯逻辑层。
 *
 * 把 Wi-Fi 配置编码成 ZXing 约定的 WIFI: 字符串，再交给二维码编码器渲染，
 * 手机相机扫一下即可连网，不用手输密码。
 *
 * 格式：WIFI:T:WPA;S:网络名;P:密码;H:true;;
 * 其中 \ ; , : " 属于分隔符，出现在内容里时必须用反斜杠转义，否则解析会错位。
 */

export const SECURITY_TYPES = [
  { id: 'WPA', label: 'WPA / WPA2 / WPA3', note: '最常见的家用与办公网络' },
  { id: 'WEP', label: 'WEP（老旧）', note: '已被破解，仅用于兼容老设备' },
  { id: 'nopass', label: '无密码（开放网络）', note: '不需要密码' }
];

/** 开放网络在 WIFI: 串里写作 T:nopass */
const SECURITY_IDS = SECURITY_TYPES.map((entry) => entry.id);

/** 这几个字符是 WIFI: 串的分隔符，出现在内容里必须转义。 */
const SPECIAL = /([\\;,:"])/g;

export function escapeWifiValue(text) {
  return String(text ?? '').replace(SPECIAL, '\\$1');
}

/** 反转义：去掉内容里的反斜杠转义。 */
export function unescapeWifiValue(text) {
  return String(text ?? '').replace(/\\(.)/g, '$1');
}

/** UTF-8 字节长度（SSID 上限按字节算，不是字符数）。 */
export function byteLength(text) {
  return new TextEncoder().encode(String(text ?? '')).length;
}

/* ── 生成 ─────────────────────────────────────────────────── */

/**
 * 生成 WIFI: 字符串。
 * @returns {{ok:true, text:string, warnings:string[]}|{ok:false, error:string}}
 */
export function buildWifiString({ ssid = '', password = '', security = 'WPA', hidden = false } = {}) {
  const name = String(ssid).trim();
  const warnings = [];

  if (name === '') return { ok: false, error: '网络名称（SSID）不能为空' };
  if (byteLength(name) > 32) {
    return { ok: false, error: `网络名称超过 32 字节（当前 ${byteLength(name)} 字节），设备无法识别` };
  }

  const type = SECURITY_IDS.includes(security) ? security : 'WPA';
  if (type !== security) warnings.push(`未知的加密方式「${security}」，已按 WPA 处理`);

  const secret = String(password);

  if (type === 'nopass') {
    if (secret !== '') warnings.push('选择了开放网络，密码会被忽略');
  } else if (type === 'WPA') {
    if (secret === '') return { ok: false, error: 'WPA 网络需要密码' };
    if (secret.length < 8 || secret.length > 63) {
      if (!/^[0-9a-fA-F]{64}$/.test(secret)) {
        return { ok: false, error: `WPA 密码需要 8-63 个字符（或 64 位十六进制），当前 ${secret.length} 个` };
      }
    }
  } else if (type === 'WEP') {
    if (secret === '') return { ok: false, error: 'WEP 网络需要密码' };
    const okLength = [5, 13, 10, 26, 16, 29].includes(secret.length);
    if (!okLength) warnings.push('WEP 密码常见长度为 5/13 个字符或 10/26 位十六进制，当前长度可能不被接受');
  }

  if (name !== String(ssid)) warnings.push('网络名称前后的空白会被去掉');
  if (/[\\;,:"#]/.test(secret) === false && /[^\x20-\x7e]/.test(secret)) {
    warnings.push('密码包含非 ASCII 字符，部分老设备可能无法连接');
  }

  const parts = [`T:${type}`, `S:${escapeWifiValue(name)}`];
  if (type !== 'nopass') parts.push(`P:${escapeWifiValue(secret)}`);
  if (hidden) parts.push('H:true');

  return { ok: true, text: `WIFI:${parts.join(';')};;`, warnings };
}

/* ── 解析 ─────────────────────────────────────────────────── */

/**
 * 解析 WIFI: 字符串。
 * @returns {{ok:true, ssid:string, password:string, security:string, hidden:boolean}|{ok:false, error:string}}
 */
export function parseWifiString(input) {
  const source = String(input ?? '').trim();
  if (source === '') return { ok: false, error: '内容为空' };
  if (!/^WIFI:/i.test(source)) return { ok: false, error: '不是 WIFI: 开头的二维码内容' };

  // 按未转义的分号切分
  const body = source.slice(5);
  const fields = [];
  let current = '';
  let escaped = false;

  for (const char of body) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      current += char;
      escaped = true;
      continue;
    }
    if (char === ';') {
      if (current !== '') fields.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (current !== '') fields.push(current);

  const result = { ssid: '', password: '', security: 'nopass', hidden: false };

  for (const field of fields) {
    const separator = field.indexOf(':');
    if (separator < 0) continue;
    const key = field.slice(0, separator).toUpperCase();
    const value = unescapeWifiValue(field.slice(separator + 1));

    if (key === 'T') result.security = value === '' ? 'nopass' : value;
    else if (key === 'S') result.ssid = value;
    else if (key === 'P') result.password = value;
    else if (key === 'H') result.hidden = value.toLowerCase() === 'true';
  }

  if (result.ssid === '') return { ok: false, error: '没有解析出网络名称（缺少 S: 字段）' };
  if (!SECURITY_IDS.includes(result.security)) {
    // 大小写不匹配时归一化，仍不认识就当 WPA
    const upper = result.security.toUpperCase();
    result.security = SECURITY_IDS.includes(upper) ? upper : 'WPA';
  }

  return { ok: true, ...result };
}

/* ── 校验与提示 ───────────────────────────────────────────── */

/** 独立的校验入口，供界面实时提示用（返回问题列表而不是抛错）。 */
export function validateWifi({ ssid = '', password = '', security = 'WPA' } = {}) {
  const problems = [];
  const name = String(ssid).trim();
  const secret = String(password);

  if (name === '') problems.push('网络名称不能为空');
  else if (byteLength(name) > 32) problems.push(`网络名称 ${byteLength(name)} 字节，超过 32 字节上限`);

  if (security === 'WPA') {
    if (secret === '') problems.push('WPA 网络需要密码');
    else if (!(secret.length >= 8 && secret.length <= 63) && !/^[0-9a-fA-F]{64}$/.test(secret)) {
      problems.push('WPA 密码需要 8-63 个字符');
    }
  } else if (security === 'WEP') {
    if (secret === '') problems.push('WEP 网络需要密码');
  }

  return problems;
}

/** 常见家用/办公场景的安全提示。 */
export function securityAdvice(security) {
  if (security === 'WEP') return 'WEP 早已被破解，能换就换到 WPA2 或 WPA3';
  if (security === 'nopass') return '开放网络意味着同一网络内任何人都能看到你的流量';
  return '';
}

/** 生成一份示例，便于快速试用。 */
export const WIFI_SAMPLE = {
  ssid: 'CodeCrate-Guest',
  password: 'welcome-2026',
  security: 'WPA',
  hidden: false
};
