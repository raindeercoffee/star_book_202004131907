// 封面文字調控板:網址加 ?tune=1 才會出現(客人看不到)。
// 按鈕調書名、「給 ○○」的位置和大小,數字即時套用;記在這台瀏覽器(重新整理還在)。
// 調好按「複製數值」貼給 Claude,填回 book.css 的 :root。
(function () {
  'use strict';

  var KEY = 'starbook_tune';
  var DEFAULTS = { 'title-x': 0, 'title-y': 22, 'title-size': 0.12, 'to-x': 0, 'to-y': 35, 'to-size': 0.055 };
  var STEP = { x: 1, y: 1, size: 0.005 };
  var rootStyle = document.documentElement.style;

  function load() {
    var v = {};
    var css = getComputedStyle(document.documentElement);
    Object.keys(DEFAULTS).forEach(function (k) {
      var fromCss = parseFloat(css.getPropertyValue('--' + k));
      v[k] = isNaN(fromCss) ? DEFAULTS[k] : fromCss;
    });
    try {
      var saved = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (saved) Object.keys(DEFAULTS).forEach(function (k) { if (typeof saved[k] === 'number') v[k] = saved[k]; });
    } catch (e) { /* 這台瀏覽器不能記也沒關係 */ }
    return v;
  }

  var vals = load();

  function round(n, step) { return Math.round(n / step) * step; }
  function fmt(k) { return k.slice(-4) === 'size' ? vals[k].toFixed(3) : vals[k].toFixed(1); }

  function apply() {
    Object.keys(vals).forEach(function (k) { rootStyle.setProperty('--' + k, String(vals[k])); });
    try { localStorage.setItem(KEY, JSON.stringify(vals)); } catch (e) { /* 不能記也沒關係 */ }
    Object.keys(vals).forEach(function (k) {
      var out = document.getElementById('tune-' + k);
      if (out) out.textContent = fmt(k);
    });
    var code = document.getElementById('tune-code');
    if (code) code.value = Object.keys(vals).map(function (k) { return '--' + k + ': ' + fmt(k) + ';'; }).join('\n');
  }

  function btn(label, onClick) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', function (e) { e.stopPropagation(); onClick(); });
    return b;
  }

  function row(name, prefix) {
    var box = document.createElement('div');
    box.className = 'tune-row';
    var title = document.createElement('div');
    title.className = 'tune-name';
    title.textContent = name;
    box.appendChild(title);

    var pad = document.createElement('div');
    pad.className = 'tune-pad';
    function move(k, d, step) { return function () { vals[k] = round(vals[k] + d * step, step); apply(); }; }
    pad.appendChild(btn('↑', move(prefix + '-y', -1, STEP.y)));
    pad.appendChild(btn('↓', move(prefix + '-y', 1, STEP.y)));
    pad.appendChild(btn('←', move(prefix + '-x', -1, STEP.x)));
    pad.appendChild(btn('→', move(prefix + '-x', 1, STEP.x)));
    pad.appendChild(btn('小', move(prefix + '-size', -1, STEP.size)));
    pad.appendChild(btn('大', move(prefix + '-size', 1, STEP.size)));
    box.appendChild(pad);

    var nums = document.createElement('div');
    nums.className = 'tune-nums';
    [['上下', '-y'], ['左右', '-x'], ['大小', '-size']].forEach(function (p) {
      var s = document.createElement('span');
      s.appendChild(document.createTextNode(p[0] + ' '));
      var b = document.createElement('b');
      b.id = 'tune-' + prefix + p[1];
      s.appendChild(b);
      nums.appendChild(s);
    });
    box.appendChild(nums);
    return box;
  }

  function build() {
    var style = document.createElement('style');
    style.textContent = [
      '.tune-panel{position:fixed;left:8px;right:8px;bottom:8px;z-index:9999;background:rgba(10,12,40,.92);',
      'border:1px solid #c9a75a;border-radius:12px;padding:10px;color:#f3dc9a;font:14px/1.4 sans-serif}',
      '.tune-row{margin-bottom:8px}.tune-name{font-weight:700;margin-bottom:4px}',
      '.tune-pad{display:grid;grid-template-columns:repeat(6,1fr);gap:6px}',
      '.tune-pad button,.tune-bar button{font-size:18px;padding:8px 0;border-radius:8px;border:1px solid #c9a75a;',
      'background:#1d2150;color:#f3dc9a}',
      '.tune-nums{display:flex;gap:12px;margin-top:4px;font-size:13px}.tune-nums b{color:#fff}',
      '.tune-bar{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px}.tune-bar button{font-size:14px}',
      '#tune-code{position:absolute;left:-9999px}'
    ].join('');
    document.head.appendChild(style);

    var panel = document.createElement('div');
    panel.className = 'tune-panel';
    panel.addEventListener('click', function (e) { e.stopPropagation(); });
    panel.appendChild(row('書名「星盤之書」', 'title'));
    panel.appendChild(row('「給 ○○」那行', 'to'));
    var bar = document.createElement('div');
    bar.className = 'tune-bar';
    var copyBtn = btn('複製數值', function () {
      var code = document.getElementById('tune-code');
      var text = code.value;
      function done() { copyBtn.textContent = '已複製 ✓'; setTimeout(function () { copyBtn.textContent = '複製數值'; }, 1500); }
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, function () { code.select(); document.execCommand('copy'); done(); });
      else { code.select(); document.execCommand('copy'); done(); }
    });
    bar.appendChild(copyBtn);
    bar.appendChild(btn('回到原本', function () { vals = Object.assign({}, DEFAULTS); apply(); }));
    bar.appendChild(btn('收起來', function () { panel.style.display = 'none'; }));
    panel.appendChild(bar);
    var code = document.createElement('textarea');
    code.id = 'tune-code';
    code.readOnly = true;
    panel.appendChild(code);
    document.body.appendChild(panel);
    apply();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();

  window.StarBook = window.StarBook || {};
  window.StarBook.tune = { values: function () { return Object.assign({}, vals); } };
})();
