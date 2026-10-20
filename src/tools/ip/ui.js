/* IP / 子网计算 界面层 */

import { h, mount, clear, $, debounce } from '../../core/dom.js';
import { mountTool } from '../../core/app.js';
import { copyButton } from '../../core/widgets.js';
import { read, write } from '../../core/storage.js';
import * as toast from '../../core/toast.js';
import * as logic from './logic.js';

const STORAGE_ID = 'ip';

const SAMPLE = ['192.168.1.10/24', '10.0.0.0/8', '172.16.5.9/20', '8.8.8.8', '2001:db8:abcd:1234::1/64', 'fd12::1', '::ffff:192.168.1.1'].join('\n');

const els = {};

/* ── 通用小部件 ───────────────────────────────────────────── */

function metric(label, value, { highlight = false } = {}) {
  return h('div', { class: `metric${highlight ? ' highlight' : ''}` },
    h('div', { class: 'k', text: label }),
    h('div', { class: 'v', text: value })
  );
}

function row(label, value) {
  return h('div', { class: 'ip-row' },
    h('span', { class: 'k', text: label }),
    h('span', { class: 'v', text: value }),
    copyButton(() => value, { title: `复制${label}` })
  );
}

function head(address, { badges = [], raw } = {}) {
  return h('div', { class: 'ip-card-head' },
    h('span', { class: 'ip-address', text: address }),
    h('span', { class: 'tag-row' }, badges),
    h('span', { class: 'grow', style: { flex: '1 1 auto' } }),
    raw && raw !== address ? h('span', { class: 'hint', text: raw }) : null
  );
}

function badge(text, kind = '') {
  return h('span', { class: `badge ${kind}`.trim(), text });
}

/* ── 各类型卡片 ───────────────────────────────────────────── */

function ipv4Card(entry) {
  const badges = [
    entry.isPublic ? badge('公网', 'ok') : badge('非公网', 'warn'),
    badge(`类别 ${entry.addressClass}`)
  ];
  for (const tag of entry.tags) badges.push(badge(tag));

  return h('div', { class: 'ip-card' },
    head(entry.address, { badges, raw: entry.raw }),
    h('div', { class: 'ip-card-body' },
      h('div', { class: 'ip-rows' },
        row('整数', String(entry.integer)),
        row('二进制', entry.binary),
        row('十六进制', entry.hex)
      )
    )
  );
}

function ipv4CidrCard(entry) {
  const { subnet } = entry;
  const badges = [
    entry.isPublic ? badge('公网', 'ok') : badge('非公网', 'warn'),
    badge(`/${subnet.prefix}`)
  ];
  for (const tag of entry.tags) badges.push(badge(tag));

  return h('div', { class: 'ip-card' },
    head(`${subnet.networkText}/${subnet.prefix}`, { badges, raw: entry.raw }),
    h('div', { class: 'ip-card-body' },
      h('div', { class: 'ip-metrics' },
        metric('可用地址数', String(subnet.usable), { highlight: true }),
        metric('地址总数', String(subnet.total)),
        metric('网络地址', subnet.networkText),
        metric('广播地址', subnet.broadcastText),
        metric('首个可用', subnet.firstHostText ?? '—'),
        metric('最后可用', subnet.lastHostText ?? '—'),
        metric('子网掩码', subnet.maskText),
        metric('通配符掩码', subnet.wildcardText)
      ),
      h('div', { class: 'ip-rows' },
        row('地址范围', subnet.rangeText),
        row('输入地址', entry.address),
        row('二进制掩码', logic.ipv4ToBinary([
          (subnet.mask >>> 24) & 255,
          (subnet.mask >>> 16) & 255,
          (subnet.mask >>> 8) & 255,
          subnet.mask & 255
        ]))
      )
    )
  );
}

function ipv6Card(entry) {
  const badges = [
    entry.isPublic ? badge('公网', 'ok') : badge('非公网', 'warn'),
    badge('IPv6')
  ];
  for (const tag of entry.tags) badges.push(badge(tag));

  return h('div', { class: 'ip-card' },
    head(entry.address, { badges, raw: entry.raw }),
    h('div', { class: 'ip-card-body' },
      h('div', { class: 'ip-rows' },
        row('展开形式', entry.expanded)
      )
    )
  );
}

function ipv6CidrCard(entry) {
  const { subnet } = entry;
  const badges = [
    entry.isPublic ? badge('公网', 'ok') : badge('非公网', 'warn'),
    badge(`/${subnet.prefix}`)
  ];
  for (const tag of entry.tags) badges.push(badge(tag));

  return h('div', { class: 'ip-card' },
    head(`${subnet.networkText}/${subnet.prefix}`, { badges, raw: entry.raw }),
    h('div', { class: 'ip-card-body' },
      h('div', { class: 'ip-metrics' },
        metric('网络前缀', subnet.networkText),
        metric('末个地址', subnet.lastText),
        metric('地址总数', subnet.totalText)
      ),
      h('div', { class: 'ip-rows' },
        row('地址范围', subnet.rangeText),
        row('输入地址', entry.address),
        row('展开形式', entry.expanded)
      )
    )
  );
}

function errorCard(entry) {
  return h('div', { class: 'ip-card error' },
    h('div', { class: 'ip-card-head' },
      h('span', { class: 'ip-address', text: entry.raw }),
      badge('无法解析', 'err')
    ),
    h('div', { class: 'ip-card-body' },
      h('div', { class: 'hint text-err', text: entry.error })
    )
  );
}

/* ── 渲染 ─────────────────────────────────────────────────── */

const PAINT = {
  ipv4: ipv4Card,
  'ipv4-cidr': ipv4CidrCard,
  ipv6: ipv6Card,
  'ipv6-cidr': ipv6CidrCard,
  error: errorCard
};

function refresh() {
  const text = els.input.value;
  write(`${STORAGE_ID}:input`, text);

  const entries = logic.analyze(text);
  const box = $('#output');
  clear(box);

  const errors = entries.filter((entry) => entry.type === 'error').length;
  $('#count').textContent = entries.length ? `${entries.length} 条` : '';

  if (!entries.length) {
    box.appendChild(h('div', { class: 'empty' }, '输入 IP 或网段后自动解析，支持 IPv4、IPv6 与 CIDR'));
    els.inputStatus.textContent = '每行一个地址，支持 192.168.1.0/24、2001:db8::/64 这类写法';
    $('#status').textContent = '';
    return;
  }

  for (const entry of entries) {
    const render = PAINT[entry.type];
    if (render) box.appendChild(render(entry));
  }

  els.inputStatus.textContent = `${entries.length} 条输入 · ${errors} 条无法解析`;
  els.status.textContent = errors
    ? '存在无法解析的条目，请检查格式'
    : '可用地址数已按 RFC 3021（/31 点对点）与单主机（/32）规则计算';
  els.status.className = `panel-foot${errors ? ' text-err' : ''}`;
}

function setInput(value) {
  els.input.value = value;
  refresh();
}

/* ── 初始化 ───────────────────────────────────────────────── */

function init() {
  els.input = $('#input');
  els.inputStatus = $('#input-status');
  els.status = $('#status');
  els.input.value = read(`${STORAGE_ID}:input`, '') || SAMPLE;

  els.input.addEventListener('input', debounce(refresh, 200));

  $('#btn-sample').addEventListener('click', () => {
    setInput(SAMPLE);
    toast.ok('已载入示例');
  });
  $('#btn-clear').addEventListener('click', () => {
    setInput('');
    toast.ok('已清空');
  });

  mountTool({
    actions: [
      { id: 'sample', label: '载入示例网段', icon: 'network', primary: true, keywords: 'sample 示例', run: () => $('#btn-sample').click() },
      { id: 'clear', label: '清空输入', icon: 'close', keywords: 'clear 清空', run: () => $('#btn-clear').click() },
      {
        id: 'copy-summary',
        label: '复制解析摘要',
        icon: 'copy',
        keywords: 'copy 复制 摘要',
        run: async () => {
          const { copy } = await import('../../core/clipboard.js');
          const entries = logic.analyze(els.input.value);
          if (!entries.length) {
            toast.warn('还没有可复制的结果');
            return;
          }
          const lines = entries.map((entry) => {
            if (entry.type === 'error') return `${entry.raw}\t解析失败：${entry.error}`;
            if (entry.subnet) {
              return `${entry.raw}\t网络 ${entry.subnet.networkText}/${entry.subnet.prefix}\t可用 ${entry.subnet.usable ?? entry.subnet.totalText}`;
            }
            return `${entry.raw}\t${entry.address}\t${entry.tags.join('/')}`;
          });
          if (await copy(lines.join('\n'))) toast.ok('已复制解析摘要');
          else toast.fail('复制失败');
        }
      }
    ]
  });

  refresh();
}

init();
