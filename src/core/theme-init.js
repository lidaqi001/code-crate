/* 主题预置脚本 — 必须是经典脚本（非 module），在 <head> 中同步执行以避免首屏闪烁。
   仅依赖 localStorage，无其他副作用。 */
(function () {
  var KEY = 'codecrate:theme';
  var LEGACY_KEY = 'devkit:theme';

  /* 存储格式由 core/storage.js 的 write() 决定，是 JSON.stringify 的结果：
     字符串值会带引号（存的是 "light" 而不是 light）。
     这里必须同样 JSON.parse——直接拿原始串比较会永远不相等，
     用户的选择就永远读不回来。改写入格式时这两处必须一起改。
     解析单独包一层 try：存了脏数据也只是当作"没选过"，
     不会连带把下面跟随系统的兜底一起吞掉。 */
  var saved = null;
  try {
    var raw = localStorage.getItem(KEY);
    /* 旧版键位兜底：模块脚本里的迁移还没执行时也要能读到用户的选择 */
    if (raw === null) raw = localStorage.getItem(LEGACY_KEY);
    if (raw !== null) saved = JSON.parse(raw);
  } catch (err) {
    saved = null;
  }

  /* 用户没选过（或存储不可用）就跟随系统 */
  var mode;
  if (saved === 'light' || saved === 'dark') {
    mode = saved;
  } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
    mode = 'light';
  } else {
    mode = 'dark';
  }

  document.documentElement.setAttribute('data-theme', mode);
})();
