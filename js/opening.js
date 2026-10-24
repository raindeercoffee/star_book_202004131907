// 開書動畫。介面:window.StarBook.opening.play(stageEl, onDone)
//   stageEl = 封面畫面(#cover-screen),裡面有 .book-stage > .book > .book-cover
//   onDone  = 動畫做完要呼叫一次(main.js 會接著把封面藏起來、打開閱讀畫面)
//
// 流程(約 2.85 秒,用 GSAP):光變亮 → sigil 在書後亮起慢轉 → 封面以左邊為軸 3D 翻開
//   (有厚度,背面是 cover_back.png)→ star_a/star_b 從書裡飛出 → 畫面放大靠近 → 淡出 → onDone()
// 減少動態設定、或 GSAP 沒載到:直接短短淡出。
// 只動 transform / opacity,手機比較順。樣式在 book.css 的「開書動畫」區塊(class 都是 op- 開頭)。
//
// 可測的純函式(node 也能 require):makeStars(rng, count)、buildPlan({ reduce, hasGsap })
(function (root) {
  'use strict';

  var STAR_MIN = 30;
  var STAR_MAX = 40;
  var STAR_DEFAULT = 36;

  function between(rng, lo, hi) { return lo + rng() * (hi - lo); }

  // 產生飛出來的星星參數(純函式)。rng 回傳 0~1。
  //   type: 'a' 四角星芒 / 'b' 小光點;size 像素;spin 轉幾度;
  //   angle 往哪個方向飛(度);dist 飛多遠(畫面短邊的倍數);duration/delay 秒
  function makeStars(rng, count) {
    rng = rng || Math.random;
    var n = Math.round(count == null ? STAR_DEFAULT : count);
    n = Math.max(STAR_MIN, Math.min(STAR_MAX, n));
    var stars = [];
    for (var i = 0; i < n; i++) {
      var isA = i % 3 === 0 || rng() < 0.25; // 大約四成是星芒,其餘是小光點
      stars.push({
        type: isA ? 'a' : 'b',
        size: isA ? between(rng, 18, 42) : between(rng, 8, 24),
        spin: between(rng, -540, 540),
        angle: between(rng, 0, 360) % 360,
        dist: between(rng, 0.35, 1.1),
        duration: between(rng, 0.8, 1.3),
        delay: between(rng, 0, 0.4)
      });
    }
    return stars;
  }

  // 時間軸(純函式,單位:秒)。at = 從第幾秒開始,dur = 持續幾秒。
  //   glow  光變亮(書停止飄、提示字淡掉、背後光暈亮起)
  //   sigil 魔法陣在書後亮起(之後一直慢慢轉到結束)
  //   open  封面以左邊為軸 3D 翻開
  //   stars 星星從書裡飛出(每顆再加自己的 delay)
  //   zoom  畫面放大靠近
  //   fade  整個封面畫面淡出,接著 onDone()
  var FULL_STEPS = [
    { name: 'glow',  at: 0,    dur: 0.5 },
    { name: 'sigil', at: 0.15, dur: 0.75 },
    { name: 'open',  at: 0.5,  dur: 1.2 },
    { name: 'stars', at: 1.1,  dur: 1.7 },
    { name: 'zoom',  at: 1.85, dur: 0.95 },
    { name: 'fade',  at: 2.4,  dur: 0.45 }
  ];
  var FAST_STEPS = [{ name: 'fade', at: 0, dur: 0.3 }];

  function buildPlan(opts) {
    opts = opts || {};
    var fast = !!opts.reduce || opts.hasGsap === false;
    var steps = (fast ? FAST_STEPS : FULL_STEPS).map(function (s) {
      return { name: s.name, at: s.at, dur: s.dur };
    });
    var total = 0;
    steps.forEach(function (s) { total = Math.max(total, s.at + s.dur); });
    return { mode: fast ? 'fast' : 'full', steps: steps, total: total };
  }

  // ---------- 以下只在瀏覽器用 ----------

  function el(cls, parent, before) {
    var d = document.createElement('div');
    d.className = cls;
    d.setAttribute('aria-hidden', 'true');
    if (before) parent.insertBefore(d, before); else parent.appendChild(d);
    return d;
  }

  function stepMap(plan) {
    var m = {};
    plan.steps.forEach(function (s) { m[s.name] = s; });
    return m;
  }

  function playFast(stageEl, plan, finish) {
    stageEl.style.setProperty('--op-fast', plan.total + 's');
    stageEl.classList.add('is-leaving');
    setTimeout(finish, plan.total * 1000 + 50);
  }

  function playFull(stageEl, plan, finish) {
    var gsap = root.gsap;
    var S = stepMap(plan);
    var stage = stageEl.querySelector('.book-stage');
    var book = stageEl.querySelector('.book');
    var front = stageEl.querySelector('.book-cover');
    var hint = stageEl.querySelector('.cover-hint');
    if (!stage || !book || !front) { playFast(stageEl, buildPlan({ reduce: true }), finish); return; }

    // 書原本在上下飄:記住現在飄到哪,停掉飄動後從那裡平順回到原位
    var floatY = 0;
    try {
      var tf = getComputedStyle(book).transform;
      if (tf && tf !== 'none' && root.DOMMatrixReadOnly) floatY = new DOMMatrixReadOnly(tf).m42;
    } catch (e) { floatY = 0; }
    stageEl.classList.add('is-opening');

    // 量尺寸(開始前量,這時 .book-stage 還沒有 transform)
    var hostRect = stageEl.getBoundingClientRect();
    var stageRect = stage.getBoundingClientRect();
    var W = stage.offsetWidth || stageRect.width;
    var vw = stageEl.clientWidth || root.innerWidth;
    var vh = root.innerHeight || stageEl.clientHeight;
    var cx = stageRect.left - hostRect.left + stageRect.width / 2;   // 書的中心(相對封面畫面)
    var cy = stageRect.top - hostRect.top + stageRect.height / 2;
    var dx = vw / 2 - cx;                                            // 書中心到畫面中心的差
    var dy = vh / 2 - (stageRect.top + stageRect.height / 2);
    var fit = Math.min(1, (vw - 32) / (2 * W));                      // 攤開後兩頁要塞得進畫面
    var zoom = Math.max(vw / W, vh / (W * 1.4)) * 1.15;              // 放大到紙頁蓋滿畫面

    // 補上動畫要用的零件
    var glow = el('op-glow', stageEl, stageEl.firstChild);
    var sigil = el('op-sigil', stage, book);
    var pages = el('op-pages', book, book.firstChild);
    var light = el('op-light', pages);
    var hinge = el('op-hinge', book);
    hinge.appendChild(front);                 // 原本的封面變成「門板」的正面
    el('op-cover-back', hinge);
    el('op-edge op-edge-r', hinge);
    el('op-edge op-edge-t', hinge);
    el('op-edge op-edge-b', hinge);
    var starLayer = el('op-stars', stageEl);

    gsap.set(book, { y: floatY });
    gsap.set(stageEl, { opacity: 1 });

    var tl = gsap.timeline({ onComplete: finish });

    // 1. 光變亮
    tl.fromTo(glow, { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: S.glow.dur, ease: 'power2.out' }, S.glow.at);
    tl.to(book, { y: 0, duration: S.glow.dur, ease: 'power2.out' }, S.glow.at);
    if (hint) tl.to(hint, { opacity: 0, y: 10, duration: S.glow.dur * 0.8, ease: 'power1.out' }, S.glow.at);

    // 2. 魔法陣在書後亮起,一路慢慢轉到結束
    tl.fromTo(sigil, { opacity: 0, scale: 0.55 }, { opacity: 0.95, scale: 1, duration: S.sigil.dur, ease: 'power2.out' }, S.sigil.at);
    tl.fromTo(sigil, { rotation: 0 }, { rotation: 75, duration: plan.total - S.sigil.at, ease: 'none' }, S.sigil.at);

    // 3. 封面以左邊為軸翻開;書往右移讓兩頁置中;窄螢幕稍微縮小
    tl.to(hinge, { rotationY: -172, duration: S.open.dur, ease: 'power3.inOut' }, S.open.at);
    tl.to(book, { x: W / 2, duration: S.open.dur, ease: 'power3.inOut' }, S.open.at);
    tl.to(stage, { scale: fit, duration: S.open.dur, ease: 'power3.inOut' }, S.open.at);
    tl.fromTo(light, { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: S.open.dur * 0.6, ease: 'power1.out' }, S.open.at + S.open.dur * 0.4);

    // 4. 星星從書頁中間飛出
    var ox = cx + fit * W / 2;
    var oy = cy;
    var unit = Math.min(vw, vh);
    makeStars(Math.random).forEach(function (s) {
      var star = el('op-star op-star-' + s.type, starLayer);
      star.style.width = star.style.height = s.size.toFixed(1) + 'px';
      var rad = s.angle * Math.PI / 180;
      var d = s.dist * unit * 0.6;
      var x0 = ox - s.size / 2 + (Math.random() - 0.5) * W * 0.3 * fit;
      var y0 = oy - s.size / 2 + (Math.random() - 0.5) * W * 0.4 * fit;
      var t0 = S.stars.at + s.delay;
      var r0 = Math.random() * 90;
      tl.fromTo(star,
        { x: x0, y: y0, scale: 0.2, rotation: r0 },
        { x: x0 + Math.cos(rad) * d, y: y0 + Math.sin(rad) * d * 0.8 - unit * 0.12,
          scale: s.type === 'a' ? 1.25 : 1, rotation: r0 + s.spin,
          duration: s.duration, ease: 'power2.out' }, t0);
      tl.fromTo(star, { opacity: 0 }, { opacity: 1, duration: 0.15, ease: 'none' }, t0);
      tl.to(star, { opacity: 0, duration: s.duration * 0.45, ease: 'power1.in' }, t0 + s.duration * 0.55);
    });

    // 5. 畫面放大靠近書頁:書頁中心一路直直移到畫面正中間(不會邊放大邊往旁邊滑)
    var cam = { p: 0 };
    tl.to(cam, {
      p: 1, duration: S.zoom.dur, ease: 'power2.in',
      onUpdate: function () {
        var sc = fit + (zoom - fit) * cam.p;
        var pageX = fit * W / 2 + (dx - fit * W / 2) * cam.p;   // 書頁中心要在的位置(相對書原本中心)
        gsap.set(stage, { scale: sc, x: pageX - sc * W / 2, y: dy * cam.p });
      }
    }, S.zoom.at);
    tl.to(light, { scale: 1.6, duration: S.zoom.dur, ease: 'power1.in' }, S.zoom.at);
    tl.to(glow, { scale: 1.5, duration: S.zoom.dur, ease: 'power1.in' }, S.zoom.at);

    // 6. 淡出,交給閱讀畫面
    tl.to(stageEl, { opacity: 0, duration: S.fade.dur, ease: 'power1.inOut' }, S.fade.at);

    // 保險:分頁被切到背景時畫面更新會暫停,時間到了還是要往下走
    setTimeout(finish, plan.total * 1000 + 1500);
  }

  function play(stageEl, onDone) {
    var finished = false;
    function finish() {
      if (finished) return;
      finished = true;
      if (typeof onDone === 'function') onDone();
    }
    if (!stageEl) { finish(); return; }

    var reduce = !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
    var plan = buildPlan({ reduce: reduce, hasGsap: !!root.gsap });
    try {
      if (plan.mode === 'fast') playFast(stageEl, plan, finish);
      else playFull(stageEl, plan, finish);
    } catch (err) {
      console.error('[星盤之書] 開書動畫出錯,直接進入閱讀:', err);
      finish();
    }
  }

  var api = { play: play, makeStars: makeStars, buildPlan: buildPlan };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.StarBook = root.StarBook || {};
    root.StarBook.opening = api;
  }
})(typeof window !== 'undefined' ? window : null);
