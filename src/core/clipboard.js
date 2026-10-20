/* 剪贴板：优先异步 Clipboard API，失败时回退到 execCommand。
   返回值明确表示成功与否，避免出现「提示已复制但其实没复制」。 */

function legacyCopy(value) {
  const area = document.createElement('textarea');
  area.value = value;
  area.setAttribute('readonly', '');
  area.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0';
  document.body.appendChild(area);
  area.select();
  area.setSelectionRange(0, value.length);
  let done = false;
  try {
    done = document.execCommand('copy');
  } catch {
    done = false;
  }
  area.remove();
  return done;
}

export async function copy(value) {
  const text = value === null || value === undefined ? '' : String(value);
  if (!text) return false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 落到回退路径 */
  }
  return legacyCopy(text);
}
