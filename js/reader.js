// 翻頁閱讀。介面:window.StarBook.reader.start(containerEl, book)
//   containerEl = 閱讀畫面(#reader-screen),呼叫時已經顯示出來(量得到大小)
//   book        = content.js 的輸出 { meta: {title,to,birth,place}, sections: [{heading, paragraphs, forceBreakBefore}] }
//
// 做法:
//   1. planBlocks 把書拆成一塊一塊(標題、段落)。
//   2. 在看不見的量測頁裡,照實際字級、行高、頁面大小量每塊的高度和每行開頭位置。
//   3. paginate 把塊分到各頁(太長的段落拆開,標題一律換新頁)。
//   4. 扉頁 + 內文頁 + 結尾頁交給 page-flip(手機直拿一頁、寬螢幕兩頁)。
//   5. 每頁第一次被翻到時,段落一起淡入上飄;翻回看過的頁不再飄。
//   6. 視窗大小改變、字型晚到時重新排版,停在原本讀到的地方。
// 純函式(paginate / planBlocks / sliceLines)在 node 也能載入:require('engine/js/reader.js')。
// 注意:文字一律用 textContent 放進去,不用 innerHTML。
(function (root) {
  'use strict';

  // ---------- 分頁(純函式,node 也能測) ----------
  var EPS = 0.5;      // 量高度的小誤差
  var MIN_LINES = 2;  // 拆段時頁底、頁頂各至少幾行

  function paginate(items, pageHeight) {
    var pages = [];
    var page = [];
    var used = 0;

    function newPage() {
      if (page.length) pages.push(page);
      page = [];
      used = 0;
    }
    function gapOf(it) { return page.length ? (it.gapBefore || 0) : 0; }

    function place(i, from, to, h, gap) {
      used += gap + h;
      page.push({ index: i, from: from, to: to });
    }

    // 下一塊最少要放多高才不算「標題孤單」:能拆的段落要開頭 MIN_LINES 行,不能拆的要整塊
    function minStart(next) {
      var n = Math.max(1, next.lines || 1);
      var h = n >= 2 * MIN_LINES ? MIN_LINES * next.height / n : next.height;
      return (next.gapBefore || 0) + h;
    }

    items.forEach(function (it, i) {
      if (it.breakBefore) newPage();
      var next = items[i + 1];
      if (page.length && it.keepWithNext && next && !next.breakBefore &&
          used + gapOf(it) + it.height + minStart(next) > pageHeight + EPS) {
        newPage();
      }
      var lines = Math.max(1, it.lines || 1);
      var lh = it.height / lines;
      var from = 0;
      while (from < lines) {
        var rest = lines - from;
        var gap = from === 0 ? gapOf(it) : 0;
        var avail = pageHeight - used - gap;
        if (rest * lh <= avail + EPS) { place(i, from, lines, rest * lh, gap); break; }

        // 放不下:夠長就拆(這頁至少留 MIN_LINES 行、下一頁至少帶 MIN_LINES 行)
        var fit = Math.floor((avail + EPS) / lh);
        if (rest >= 2 * MIN_LINES) {
          var take = Math.min(fit, rest - MIN_LINES);
          if (take >= MIN_LINES) {
            place(i, from, from + take, take * lh, gap);
            newPage();
            from += take;
            continue;
          }
        }
        if (page.length) { newPage(); continue; } // 換一張空白頁再試

        // 空白頁也放不下:能拆就塞滿,不能拆只好整塊放
        take = Math.max(1, Math.min(fit, rest));
        place(i, from, from + take, take * lh, gap);
        from += take;
        if (from < lines) newPage();
      }
    });
    newPage();
    return pages;
  }

  // 書的資料 → 一塊一塊(標題、段落)。章節標題一律開新頁;強制換頁的區塊第一塊開新頁。
  function planBlocks(book) {
    var blocks = [];
    ((book && book.sections) || []).forEach(function (s) {
      var breakNext = !!s.forceBreakBefore;
      if (s.heading) {
        blocks.push({ kind: 'heading', text: s.heading, breakBefore: true, keepWithNext: true });
        breakNext = false;
      }
      (s.paragraphs || []).forEach(function (p) {
        blocks.push({ kind: 'para', text: p, breakBefore: breakNext, keepWithNext: false });
        breakNext = false;
      });
    });
    return blocks;
  }

  // 段落拆頁時切文字:lineStarts = 每行第一個字的位置;切出 [from, to) 這幾行,切口的換行去掉。
  function sliceLines(text, lineStarts, from, to) {
    var a = lineStarts[from] || 0;
    var b = to < lineStarts.length ? lineStarts[to] : text.length;
    var s = text.slice(a, b);
    if (from > 0) s = s.replace(/^\n+/, '');
    if (to < lineStarts.length) s = s.replace(/\n+$/, '');
    return s;
  }

  // 字型晚到時字寬會變,要重新排版(純函式,node 也能測)。
  //   fonts      = document.fonts(沒有就什麼都不做)
  //   wasLoading = 第一次排版時字型是不是還沒載完(document.fonts.status !== 'loaded')
  //   render     = 馬上重排;later = 稍後重排(給 loadingdone 用)
  // 第一次排版時字型已經載好,ready 之後就不再重排(避免一開始排兩次)。
  function watchFonts(fonts, wasLoading, render, later) {
    if (!fonts || !fonts.ready) return;
    var fontsDone = false;
    fonts.ready.then(function () {
      fontsDone = true;
      if (wasLoading) render();
    });
    if (fonts.addEventListener) {
      fonts.addEventListener('loadingdone', function () {
        if (fontsDone) later();
      });
    }
  }

  // 書尾:扉頁 1 張 + 內文 textPages 張 + (空白) + 結尾頁 + 封底。
  // 兩頁模式要讓最後一個畫面剛好是「結尾頁|封底」,所以結尾頁要落在左邊(雙數位置)。
  function bookTail(textPages, spread) {
    return { blank: !!spread && (1 + textPages) % 2 === 1 };
  }

  // 頁角的「next ›」小提示:手機每頁都放;電腦只放右頁(單數位置);結尾頁、封底不放
  function showsNextHint(index, kind, spread) {
    if (kind === 'ending' || kind === 'back') return false;
    return spread ? index % 2 === 1 : true;
  }

  var api = { paginate: paginate, planBlocks: planBlocks, sliceLines: sliceLines, watchFonts: watchFonts,
              bookTail: bookTail, showsNextHint: showsNextHint };
  if (typeof module === 'object' && module.exports) module.exports = api;

  // ---------- 網頁部分(只在瀏覽器跑) ----------
  var GUTTER = 16;       // 左右至少留白
  var NAV_H = 56;        // 底部箭頭列高度
  var PAGE_RATIO = 7 / 5; // 紙張 1200×1680

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function reducedMotion() {
    return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  // 依視窗大小決定:一頁還是兩頁、每頁多大、字多大
  function computeLayout() {
    var vw = document.documentElement.clientWidth || root.innerWidth;
    var vh = root.innerHeight;
    var availW = vw - GUTTER * 2;
    var availH = vh - NAV_H - 24;
    var spread = availW >= 720 && availW > availH * 1.15;
    var maxW = spread ? Math.min(availW / 2, 480) : Math.min(availW, 520);
    var pageW = Math.floor(Math.max(200, Math.min(maxW, availH / PAGE_RATIO)));
    var pageH = Math.round(pageW * PAGE_RATIO);
    var fontSize = Math.max(14, Math.min(19, pageW * 0.047));
    return { spread: spread, pageW: pageW, pageH: pageH, fontSize: Math.round(fontSize * 10) / 10, vw: vw, vh: vh };
  }

  // 一張紙的骨架:紙 + 四角 + 內容區
  function makePage(extraClass) {
    var page = el('div', 'flip-page' + (extraClass ? ' ' + extraClass : ''));
    page.setAttribute('data-density', 'soft');
    ['tl', 'tr', 'bl', 'br'].forEach(function (c) {
      var corner = el('span', 'page-corner page-corner--' + c);
      corner.setAttribute('aria-hidden', 'true');
      page.appendChild(corner);
    });
    var body = el('div', 'page-body');
    page.appendChild(body);
    return { page: page, body: body };
  }

  function blockEl(block, text) {
    return block.kind === 'heading' ? el('h2', 'page-heading', text) : el('p', 'page-para', text);
  }

  // 量一段文字每一行第一個字的位置
  function measureLineStarts(p) {
    var node = p.firstChild;
    if (!node || node.nodeType !== 3) return [0];
    var text = node.nodeValue;
    var range = document.createRange();
    var starts = [];
    var lastTop = -Infinity;
    var lh = parseFloat(getComputedStyle(p).lineHeight) || 20;
    for (var i = 0; i < text.length; i++) {
      if (text.charAt(i) === '\n') continue;
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      var rects = range.getClientRects();
      if (!rects.length) continue;
      var top = rects[0].top;
      if (top > lastTop + lh * 0.5) { starts.push(i); lastTop = top; }
    }
    return starts.length ? starts : [0];
  }

  function start(containerEl, book) {
    var meta = (book && book.meta) || {};
    var blocks = planBlocks(book);
    var reduce = reducedMotion();

    // 讀到哪裡(用「第幾塊第幾行」記,重新排版後頁數會變)
    var seenMax = -2;   // 看過最遠的頁的位置
    var currentPos = -1; // 目前打開的那頁的位置
    var pf = null;
    var pagesPos = [];
    var pageEls = [];
    var lastLayout = null;
    var nav = {};

    function posOf(piece) { return piece.index * 100000 + piece.from; }

    containerEl.textContent = '';
    containerEl.classList.add('reader-screen--flip');
    var stage = el('div', 'reader-stage');
    var navBar = el('nav', 'reader-nav');
    navBar.setAttribute('aria-label', '翻頁');
    nav.prev = el('button', 'reader-arrow reader-arrow--prev', '‹');
    nav.prev.type = 'button';
    nav.prev.setAttribute('aria-label', '上一頁');
    nav.count = el('span', 'reader-count');
    nav.count.setAttribute('aria-live', 'polite');
    nav.next = el('button', 'reader-arrow reader-arrow--next', '›');
    nav.next.type = 'button';
    nav.next.setAttribute('aria-label', '下一頁');
    navBar.appendChild(nav.prev);
    navBar.appendChild(nav.count);
    navBar.appendChild(nav.next);
    containerEl.appendChild(stage);
    containerEl.appendChild(navBar);

    nav.prev.addEventListener('click', function () { if (pf) pf.flipPrev('bottom'); });
    nav.next.addEventListener('click', function () { if (pf) pf.flipNext('bottom'); });
    document.addEventListener('keydown', function (e) {
      if (!pf || containerEl.hidden) return;
      if (e.key === 'ArrowLeft') pf.flipPrev('bottom');
      else if (e.key === 'ArrowRight') pf.flipNext('bottom');
    });

    // 量每一塊:在看不見的量測頁裡照真的樣子排一次
    function measure(layout) {
      var probe = makePage('is-measure');
      probe.page.style.width = layout.pageW + 'px';
      probe.page.style.height = layout.pageH + 'px';
      stage.appendChild(probe.page);
      var els = blocks.map(function (b) {
        var node = blockEl(b, b.text);
        probe.body.appendChild(node);
        return node;
      });
      var pageHeight = probe.body.clientHeight;
      var items = els.map(function (node, i) {
        var b = blocks[i];
        var starts = b.kind === 'para' ? measureLineStarts(node) : [0];
        return {
          height: node.getBoundingClientRect().height,
          lines: starts.length,
          lineStarts: starts,
          gapBefore: parseFloat(getComputedStyle(node).marginTop) || 0,
          breakBefore: b.breakBefore,
          keepWithNext: b.keepWithNext
        };
      });
      stage.removeChild(probe.page);
      return { items: items, pageHeight: pageHeight - 1 }; // 留 1px 保險
    }

    function addFx(body) {
      Array.prototype.forEach.call(body.children, function (child, i) {
        child.classList.add('fx');
        child.style.setProperty('--fx-i', i);
      });
    }

    function buildTitlePage() {
      var p = makePage('flip-page--title');
      p.body.appendChild(el('div', 'title-star'));
      p.body.appendChild(el('h1', 'title-name', meta.title || '星盤之書'));
      if (meta.to) p.body.appendChild(el('p', 'title-to', '給 ' + meta.to));
      if (meta.birth) p.body.appendChild(el('p', 'title-meta', meta.birth));
      if (meta.place) p.body.appendChild(el('p', 'title-meta', meta.place));
      return p.page;
    }

    function buildEndingPage() {
      var p = makePage('flip-page--ending');
      var stars = el('div', 'ending-stars');
      stars.setAttribute('aria-hidden', 'true');
      for (var i = 0; i < 3; i++) stars.appendChild(el('span', 'ending-star'));
      p.body.appendChild(stars);
      p.body.insertBefore(el('p', 'ending-fin', 'The End'), stars);
      p.body.appendChild(el('p', 'ending-text', '願星光照亮你的路 ✨'));
      return p.page;
    }

    // 封底:深色硬殼,中間一個小魔法陣和書名,看到它就知道書讀完了
    function buildBackPage() {
      var p = makePage('flip-page--back');
      p.page.setAttribute('data-density', 'hard');
      var sigil = el('div', 'back-sigil');
      sigil.setAttribute('aria-hidden', 'true');
      p.body.appendChild(sigil);
      p.body.appendChild(el('p', 'back-title', meta.title || '星盤之書'));
      p.body.appendChild(el('p', 'back-fin', '— fin —'));
      return p.page;
    }

    function buildPages(layout) {
      var m = measure(layout);
      var plan = paginate(m.items, m.pageHeight);
      var list = [{ page: buildTitlePage(), pos: -1 }];
      plan.forEach(function (pieces) {
        var p = makePage('flip-page--text');
        pieces.forEach(function (piece) {
          var b = blocks[piece.index];
          var item = m.items[piece.index];
          var whole = piece.from === 0 && piece.to >= item.lines;
          var text = whole ? b.text : sliceLines(b.text, item.lineStarts, piece.from, piece.to);
          var node = blockEl(b, text);
          if (piece.to < item.lines) node.classList.add('is-split'); // 段落接到下一頁:最後一行也排滿
          p.body.appendChild(node);
        });
        list.push({ page: p.page, pos: posOf(pieces[0]) });
      });
      // 兩頁模式:最後一個畫面要剛好是「結尾頁|封底」
      if (bookTail(plan.length, layout.spread).blank) {
        list.push({ page: makePage('flip-page--blank').page, pos: list[list.length - 1].pos + 1 });
      }
      list.push({ page: buildEndingPage(), pos: Infinity, kind: 'ending' });
      list.push({ page: buildBackPage(), pos: Infinity, kind: 'back' });
      list.forEach(function (x, i) {
        var body = x.page.querySelector('.page-body');
        addFx(body);
        if (x.pos > seenMax) x.page.classList.add('is-unseen');
        if (showsNextHint(i, x.kind || 'text', layout.spread)) {
          var hint = el('span', 'page-next', 'next ›');
          hint.setAttribute('aria-hidden', 'true');
          x.page.appendChild(hint);
        }
      });
      return list;
    }

    function visibleIndexes() {
      var i = pf.getCurrentPageIndex();
      if (pf.getOrientation() === 'landscape') {
        var left = i - (i % 2);
        return [left, left + 1].filter(function (n) { return n < pageEls.length; });
      }
      return [i];
    }

    function onShow() {
      if (!pf) return;
      var idx = visibleIndexes();
      currentPos = pagesPos[idx[0]];
      idx.forEach(function (n) {
        var page = pageEls[n];
        if (page.classList.contains('is-unseen')) {
          page.classList.remove('is-unseen');
          page.classList.add('is-revealing');
          // 飄完就拿掉動畫,不然翻頁時程式庫複製這張紙會再飄一次
          var count = page.querySelectorAll('.fx').length;
          setTimeout(function () { page.classList.remove('is-revealing'); }, 800 + count * 80);
        }
        if (pagesPos[n] > seenMax) seenMax = pagesPos[n];
      });
      var total = pageEls.length;
      var first = idx[0] + 1;
      var last = idx[idx.length - 1] + 1;
      nav.count.textContent = (first === last ? first : first + '–' + last) + ' / ' + total;
      nav.prev.disabled = idx[0] <= 0;
      nav.next.disabled = idx[idx.length - 1] >= total - 1;
    }

    function startPageFor(pos) {
      var best = 0;
      for (var i = 0; i < pagesPos.length; i++) if (pagesPos[i] <= pos) best = i;
      return best;
    }

    function render() {
      var layout = computeLayout();
      lastLayout = layout;
      if (pf) { try { pf.destroy(); } catch (e) { /* 舊的書已經拆掉 */ } pf = null; }
      stage.textContent = '';
      containerEl.style.setProperty('--page-w', layout.pageW + 'px');
      containerEl.style.setProperty('--page-h', layout.pageH + 'px');
      containerEl.style.setProperty('--reader-fs', layout.fontSize + 'px');
      containerEl.classList.toggle('is-spread', layout.spread);

      var list = buildPages(layout);
      pageEls = list.map(function (x) { return x.page; });
      pagesPos = list.map(function (x) { return x.pos; });

      var host = el('div', 'reader-book');
      host.style.width = (layout.spread ? layout.pageW * 2 : layout.pageW) + 'px';
      host.style.height = layout.pageH + 'px';
      pageEls.forEach(function (p) { host.appendChild(p); });
      stage.appendChild(host);

      if (!root.St || !root.St.PageFlip) {
        // 翻頁程式庫沒載到:退回一頁一頁直排,至少看得到字
        host.classList.add('is-fallback');
        host.style.height = 'auto';
        pageEls.forEach(function (p) {
          p.style.width = layout.pageW + 'px';
          p.style.height = layout.pageH + 'px';
          p.classList.remove('is-unseen');
        });
        navBar.hidden = true;
        console.warn('[星盤之書] 翻頁程式庫沒有載入,改用直排');
        return;
      }

      pf = new root.St.PageFlip(host, {
        width: layout.pageW,
        height: layout.pageH,
        size: 'fixed',
        autoSize: false,
        usePortrait: true,
        showCover: false,
        drawShadow: true,
        maxShadowOpacity: 0.35,
        flippingTime: reduce ? 300 : 800,
        mobileScrollSupport: true,
        startPage: startPageFor(currentPos)
      });
      pf.on('init', onShow);
      pf.on('flip', onShow);
      pf.loadFromHTML(pageEls);
    }

    // 視窗大小改變:等手停下來再重排(只有高度小小變動,像手機網址列縮放,就不重排)
    var timer = null;
    function scheduleRender() {
      clearTimeout(timer);
      timer = setTimeout(function () {
        var next = computeLayout();
        if (lastLayout && next.spread === lastLayout.spread && next.pageW === lastLayout.pageW &&
            next.fontSize === lastLayout.fontSize) return;
        render();
      }, 200);
    }
    root.addEventListener('resize', scheduleRender);
    root.addEventListener('orientationchange', scheduleRender);

    // 字型晚到時字寬會變,重新量一次(第一次排版時字型已經好了就不用)
    var fontsWereLoading = !!(document.fonts && document.fonts.status !== 'loaded');
    render();
    watchFonts(document.fonts, fontsWereLoading, render, function () {
      clearTimeout(timer);
      timer = setTimeout(render, 150);
    });
  }

  api.start = start;
  if (root && root.document) {
    root.StarBook = root.StarBook || {};
    root.StarBook.reader = api;
  }
})(typeof window !== 'undefined' ? window : this);
