/* 统一的模糊匹配：popup、命令面板、工具首页共用。
   打分规则：连续子串优先；否则要求字符按顺序出现（子序列）。
   多个 token 必须全部命中，任一 token 无法命中即返回 0。 */

export function fuzzyScore(query, haystack) {
  const hay = String(haystack || '').toLowerCase();
  const tokens = String(query || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  // 空查询视为全部命中；排序交给调用方（置顶/最近/原始顺序）
  if (!tokens.length) return 1;

  let total = 0;
  for (const token of tokens) {
    const direct = hay.indexOf(token);
    if (direct >= 0) {
      total += 1000 - Math.min(direct, 900);
      continue;
    }

    let cursor = 0;
    let matched = 0;
    for (const char of token) {
      const found = hay.indexOf(char, cursor);
      if (found < 0) return 0;
      matched += found === cursor ? 3 : 1;
      cursor = found + 1;
    }
    if (!matched) return 0;
    total += matched;
  }
  return total;
}
