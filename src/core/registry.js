import { read, write } from './storage.js';

/* 工具注册表 —— 全项目唯一事实来源。
   popup、命令面板、测试都从这里读取，避免出现「注册表/目录不一致」或死链。
   新增工具时只需：建目录 + 在此登记一行。 */

export const CATEGORIES = [
  { id: 'data', name: '数据' },
  { id: 'encode', name: '编码' },
  { id: 'time', name: '时间' },
  { id: 'generate', name: '生成' },
  { id: 'text', name: '文本' },
  { id: 'web', name: '网络' },
  { id: 'design', name: '设计' },
  { id: 'system', name: '系统' }
];

export const TOOLS = [
  {
    id: 'json',
    name: 'JSON 工具',
    icon: 'json',
    category: 'data',
    desc: '格式化、校验、树形浏览、JSONPath 查询、转 TypeScript / Schema',
    tags: ['json', 'format', 'validate', 'tree', 'jsonpath', 'typescript', 'schema', '格式化', '校验', '压缩'],
    path: 'src/tools/json/index.html'
  },
  {
    id: 'converter',
    name: '格式转换',
    icon: 'converter',
    category: 'data',
    desc: 'JSON / YAML / TOML / XML / CSV / TSV 任意互转，自动识别源格式',
    tags: ['convert', 'yaml', 'toml', 'xml', 'csv', 'tsv', 'json', '转换', '格式', 'yaml', 'toml', 'xml', 'csv'],
    path: 'src/tools/converter/index.html'
  },
  {
    id: 'file',
    name: '文件哈希与编码',
    icon: 'download',
    category: 'data',
    desc: '拖入文件即可计算 MD5 / CRC32 / SHA 系列摘要，并导出 Base64 / Data URI / 十六进制',
    tags: ['file', 'hash', 'md5', 'sha', 'crc32', 'base64', 'datauri', 'hex', '文件', '哈希', '校验', '编码', '拖拽'],
    path: 'src/tools/file/index.html'
  },
  {
    id: 'units',
    name: '进制与单位',
    icon: 'units',
    category: 'data',
    desc: '任意进制互转（2-36）、位运算、字节序翻转、7 类单位换算',
    tags: ['base', 'hex', 'binary', 'octal', 'bitwise', 'unit', 'convert', '进制', '十六进制', '位运算', '单位', '换算'],
    path: 'src/tools/units/index.html'
  },
  {
    id: 'codec',
    name: '编解码 / 哈希',
    icon: 'codec',
    category: 'encode',
    desc: 'Base64、URL、HTML 实体、JWT 解析、MD5 / SHA / CRC32',
    tags: ['base64', 'url', 'encode', 'decode', 'hash', 'md5', 'sha', 'jwt', 'crc32', 'hex', '编码', '解码', '哈希'],
    path: 'src/tools/codec/index.html'
  },
  {
    id: 'regex',
    name: '正则测试',
    icon: 'regex',
    category: 'text',
    desc: '实时匹配与高亮、分组查看、替换、表达式解释与常用速查',
    tags: ['regex', 'regexp', 'match', 'replace', '正则', '匹配', '替换', '分组', '断言'],
    path: 'src/tools/regex/index.html'
  },
  {
    id: 'diff',
    name: '文本 Diff',
    icon: 'diff',
    category: 'text',
    desc: '真实 LCS 差异比较：文本行、词级高亮、JSON 结构对比与统一补丁',
    tags: ['diff', 'compare', 'patch', 'merge', 'json-diff', '比对', '差异', '补丁', '对比'],
    path: 'src/tools/diff/index.html'
  },
  {
    id: 'text',
    name: '文本处理',
    icon: 'text',
    category: 'text',
    desc: '大小写与命名风格、排序去重、行编辑、空白清理、转义与统计',
    tags: ['text', 'case', 'sort', 'dedupe', 'trim', 'escape', 'stats', '文本', '大小写', '排序', '去重', '转义', '字数'],
    path: 'src/tools/text/index.html'
  },
  {
    id: 'markdown',
    name: 'Markdown 预览',
    icon: 'markdown',
    category: 'text',
    desc: '实时预览、GFM 表格与任务列表、目录、安全导出 HTML',
    tags: ['markdown', 'md', 'preview', 'toc', 'html', '预览', '目录', '导出', '文档'],
    path: 'src/tools/markdown/index.html'
  },
  {
    id: 'mdtable',
    name: 'Markdown 表格',
    icon: 'markdown',
    category: 'text',
    desc: '可视化编辑表格，实时生成 Markdown，支持对齐、CSV / TSV / Markdown 导入',
    tags: ['markdown', 'table', 'csv', 'tsv', '表格', '对齐', '导入', '导出'],
    path: 'src/tools/mdtable/index.html'
  },
  {
    id: 'timestamp',
    name: '时间戳转换',
    icon: 'timestamp',
    category: 'time',
    desc: '时间戳互转、任意时区换算、日期差计算',
    tags: ['timestamp', 'unix', 'time', 'timezone', 'date', 'utc', '时间戳', '时区', '日期'],
    path: 'src/tools/timestamp/index.html'
  },
  {
    id: 'cron',
    name: 'Cron 表达式',
    icon: 'cron',
    category: 'time',
    desc: '解析 Cron 表达式、生成中文说明、计算接下来 6 次触发时间',
    tags: ['cron', 'crontab', 'schedule', 'expression', '定时', '表达式', '调度', '计划任务'],
    path: 'src/tools/cron/index.html'
  },
  {
    id: 'uuid',
    name: 'UUID / 随机',
    icon: 'uuid',
    category: 'generate',
    desc: 'UUID v4 / v7、ULID、随机字符串与强密码',
    tags: ['uuid', 'guid', 'ulid', 'random', 'password', 'nanoid', '随机', '密码', '生成'],
    path: 'src/tools/uuid/index.html'
  },
  {
    id: 'chmod',
    name: '文件权限计算',
    icon: 'chmod',
    category: 'system',
    desc: '八进制 / 符号 / ls -l 三种权限表示互转，支持 setuid 与 chmod 增量写法',
    tags: ['chmod', 'permission', 'mode', 'octal', 'setuid', '权限', '755', '644', '文件权限'],
    path: 'src/tools/chmod/index.html'
  },
  {
    id: 'keycode',
    name: '按键速查',
    icon: 'keycode',
    category: 'web',
    desc: '实时显示 event.key / code / keyCode，内置按键速查表与代码片段',
    tags: ['keycode', 'keyboard', 'event', 'key', 'code', '快捷键', '按键', '键盘事件'],
    path: 'src/tools/keycode/index.html'
  },
  {
    id: 'crypto',
    name: '加密与摘要',
    icon: 'crypto',
    category: 'encode',
    desc: 'HMAC 签名与校验、AES-GCM 认证加解密、PBKDF2 口令派生、随机字节',
    tags: ['hmac', 'aes', 'gcm', 'encrypt', 'decrypt', 'pbkdf2', 'crypto', '加密', '解密', '签名', '摘要'],
    path: 'src/tools/crypto/index.html'
  },
  {
    id: 'otp',
    name: '动态口令',
    icon: 'otp',
    category: 'encode',
    desc: '本地生成 TOTP / HOTP 二次验证码，解析与导出 otpauth 链接和二维码',
    tags: ['otp', 'totp', 'hotp', '2fa', 'mfa', 'authenticator', 'otpauth', '动态口令', '二次验证', '验证码'],
    path: 'src/tools/otp/index.html'
  },
  {
    id: 'compress',
    name: '压缩与解压',
    icon: 'compress',
    category: 'encode',
    desc: 'GZIP / ZLIB / 原始 DEFLATE 压缩解压，自动识别格式，输出 Base64 或十六进制',
    tags: ['gzip', 'deflate', 'zlib', 'compress', 'decompress', 'zip', '压缩', '解压', 'gz'],
    path: 'src/tools/compress/index.html'
  },
  {
    id: 'webassets',
    name: 'Web 资产',
    icon: 'web',
    category: 'web',
    desc: '生成 meta / Open Graph 标签、robots.txt、sitemap.xml 与 sitemap 索引',
    tags: ['meta', 'og', 'seo', 'robots', 'sitemap', 'open-graph', 'twitter-card', '标签', '索引'],
    path: 'src/tools/webassets/index.html'
  },
  {
    id: 'svg',
    name: 'SVG 占位图',
    icon: 'svg',
    category: 'design',
    desc: '生成带文字与纹理的 SVG 占位图，支持渐变、圆角、圆形与 Data URI 输出',
    tags: ['svg', 'placeholder', 'image', 'data-uri', 'avatar', 'og', '占位图', '矢量图'],
    path: 'src/tools/svg/index.html'
  },
  {
    id: 'wifi',
    name: 'Wi-Fi 二维码',
    icon: 'wifi',
    category: 'generate',
    desc: '把网络配置生成扫码即连的 Wi-Fi 二维码，支持隐藏网络与开放网络',
    tags: ['wifi', 'qrcode', 'network', 'ssid', 'wpa', '无线', '二维码', '扫码连网'],
    path: 'src/tools/wifi/index.html'
  },
  {
    id: 'image',
    name: '图片工具',
    icon: 'image',
    category: 'design',
    desc: '格式转换与压缩、尺寸缩放、EXIF 元数据查看、色盲模拟，全部本地完成',
    tags: ['image', 'png', 'jpeg', 'webp', 'compress', 'resize', 'exif', 'colorblind', '图片', '压缩', '元数据', '色盲'],
    path: 'src/tools/image/index.html'
  },
  {
    id: 'ip',
    name: 'IP / 子网计算',
    icon: 'network',
    category: 'web',
    desc: 'IPv4 / IPv6 解析、CIDR 子网划分、可用地址数、公网私有判定',
    tags: ['ip', 'ipv4', 'ipv6', 'cidr', 'subnet', 'netmask', '子网', '掩码', '网段', '可用地址'],
    path: 'src/tools/ip/index.html'
  },
  {
    id: 'color',
    name: '颜色工具',
    icon: 'color',
    category: 'design',
    desc: '颜色解析与格式转换、WCAG 对比度检查、色阶与配色方案',
    tags: ['color', 'hex', 'rgb', 'hsl', 'contrast', 'wcag', 'palette', '颜色', '对比度', '色阶', '配色'],
    path: 'src/tools/color/index.html'
  },
  {
    id: 'css',
    name: 'CSS 生成器',
    icon: 'sliders',
    category: 'design',
    desc: '可视化生成渐变与多层阴影，实时预览并复制 CSS',
    tags: ['css', 'gradient', 'shadow', 'box-shadow', 'background', '渐变', '阴影', '生成器'],
    path: 'src/tools/css/index.html'
  },
  {
    id: 'password',
    name: '密码与随机串',
    icon: 'crypto',
    category: 'generate',
    desc: '使用加密随机数生成密码、PIN 与随机令牌，实时显示熵值与强度',
    tags: ['password', 'passwd', 'random', 'token', 'entropy', '密码', '随机', '令牌', '强度', '熵'],
    path: 'src/tools/password/index.html'
  },
  {
    id: 'barcode',
    name: 'Code 128 条码',
    icon: 'qrcode',
    category: 'design',
    desc: 'Code 128-B 条码生成：自动校验位、实时预览，导出 SVG / PNG',
    tags: ['barcode', 'code128', 'code-128', '条码', '条形码', '标签', 'svg', 'png'],
    path: 'src/tools/barcode/index.html'
  },
  {
    id: 'qrcode',
    name: '二维码工具',
    icon: 'qrcode',
    category: 'design',
    desc: '生成二维码（版本 1–8、四种纠错等级），导出 PNG / SVG / 终端字符画',
    tags: ['qrcode', 'qr', 'barcode', 'svg', 'png', '二维码', '扫码', '生成'],
    path: 'src/tools/qrcode/index.html'
  },
  {
    id: 'http',
    name: 'HTTP / cURL',
    icon: 'http',
    category: 'web',
    desc: '发送 HTTP 请求、解析 cURL、查看响应；另含状态码与 MIME 速查',
    tags: ['http', 'curl', 'api', 'request', 'rest', 'status', 'mime', 'basic-auth', 'cookie', '请求', '接口', '状态码'],
    path: 'src/tools/http/index.html'
  }
];

const byId = new Map(TOOLS.map((tool) => [tool.id, tool]));

/* 最近使用：只记 id，最多 6 个；存储不可用时静默降级为空列表。
   popup 用它把刚用过的工具排前面，工具页之间跳转也会记一笔。 */
export const PINNED_KEY = 'pinned';
const RECENT_KEY = 'recent';
const RECENT_LIMIT = 6;

export function pinnedToolIds() {
  const stored = read(PINNED_KEY, []);
  if (!Array.isArray(stored)) return [];
  return stored.filter((id) => byId.has(id));
}

export function recentToolIds() {
  const stored = read(RECENT_KEY, []);
  if (!Array.isArray(stored)) return [];
  return stored.filter((id) => byId.has(id));
}

export function markToolUsed(id) {
  if (!byId.has(id)) return;
  const next = [id, ...recentToolIds().filter((item) => item !== id)].slice(0, RECENT_LIMIT);
  write(RECENT_KEY, next);
}

export function getTool(id) {
  return byId.get(id) || null;
}

export function getCategory(id) {
  return CATEGORIES.find((category) => category.id === id) || null;
}

/** 该工具所属分类的显示名。 */
export function categoryName(tool) {
  const category = getCategory(tool.category);
  return category ? category.name : '其他';
}

/** 实际被使用的分类（用于 popup 只渲染有内容的分类，避免空分类）。 */
export function activeCategories() {
  const used = new Set(TOOLS.map((tool) => tool.category));
  return CATEGORIES.filter((category) => used.has(category.id));
}

/**
 * 把扩展内相对路径解析为可访问 URL。
 * 有 chrome.runtime 时用官方 API（扩展页面 / popup 均适用）。
 */
export function resolveUrl(path) {
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
    return chrome.runtime.getURL(path);
  }
  return new URL(path, document.baseURI).href;
}

export function toolUrl(tool) {
  return resolveUrl(tool.path);
}

/** 在新标签页打开工具（popup 用）。chrome.tabs.create 不需要任何权限。 */
export function openToolInTab(tool) {
  markToolUsed(tool.id);
  const url = toolUrl(tool);
  if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
    chrome.tabs.create({ url });
  } else {
    window.open(url, '_blank', 'noopener');
  }
}

/** 在当前标签页跳转到另一个工具（工具页内切换用）。 */
export function goToTool(tool) {
  markToolUsed(tool.id);
  window.location.assign(toolUrl(tool));
}

/** 供测试与 lint 使用：注册表自检。 */
export function validateRegistry() {
  const problems = [];
  const seen = new Set();
  for (const tool of TOOLS) {
    if (seen.has(tool.id)) problems.push(`重复的工具 id: ${tool.id}`);
    seen.add(tool.id);
    for (const field of ['id', 'name', 'icon', 'category', 'desc', 'path']) {
      if (!tool[field]) problems.push(`${tool.id} 缺少字段 ${field}`);
    }
    if (!getCategory(tool.category)) problems.push(`${tool.id} 的分类 ${tool.category} 未定义`);
    if (!/^src\/tools\/[a-z0-9-]+\/index\.html$/.test(tool.path)) {
      problems.push(`${tool.id} 的 path 不符合约定: ${tool.path}`);
    }
    if (!Array.isArray(tool.tags) || tool.tags.length === 0) problems.push(`${tool.id} 缺少 tags`);
  }
  return problems;
}
