// 串起來:讀 content.txt → 畫封面(同時預先載開書要用的圖)→ 點擊 → opening → reader
//
// 兩種開法:
//   成品(dist/star_book_<12碼>/index.html):讀同資料夾的 content.txt,圖在 assets/book/*.webp
//   開發(engine/index.html?book=<12碼>):讀 ../books/<12碼>/content.txt,圖在 ../assets/book/*.png
//
// 給其他程式用的東西:
//   window.StarBook.assets = { cover, coverBack, paper, corner, sigil, starA, starB, sky }  每張圖的完整網址
//   CSS 變數 --img-cover / --img-cover-back / --img-paper / --img-corner / --img-sigil /
//     --img-star-a / --img-star-b / --img-sky = url("完整網址")
//   window.StarBook.book = 解析後的書本資料(讀完才有)
//
// 可測的函式(node 也能 require):resolvePaths、preloadImage、settleWithin、startReaderSafely、showPlainBook
(function (root) {
  'use strict';

  var IMAGES = {
    cover: 'cover',
    coverBack: 'cover_back',
    paper: 'paper',
    corner: 'corner',
    sigil: 'sigil',
    starA: 'star_a',
    starB: 'star_b',
    sky: 'sky',
    skyWide: 'sky_wide'
  };
  var CSS_VARS = {
    cover: '--img-cover',
    coverBack: '--img-cover-back',
    paper: '--img-paper',
    corner: '--img-corner',
    sigil: '--img-sigil',
    starA: '--img-star-a',
    starB: '--img-star-b',
    sky: '--img-sky',
    skyWide: '--img-sky-wide'
  };

  // 開書動畫一開始就要用到的圖:進頁面就先載
  var PRELOAD_KEYS = ['coverBack', 'sigil', 'starA', 'starB'];
  var PRELOAD_WAIT_MS = 1500;   // 點書時圖還沒好,最多等這麼久
  var WAKING_HINT = '書正在醒來…';

  // 依網址決定讀哪裡。search = location.search(例:'?book=202004131907')
  // version = 組書工具寫在 <meta name="starbook-version"> 的版本記號;成品的圖網址加 ?v=,改版後瀏覽器才不會一直用舊圖
  function resolvePaths(search, version) {
    var m = /[?&]book=([^&]*)/.exec(search || '');
    var id = m ? decodeURIComponent(m[1]) : '';
    var dev = /^\d{12}$/.test(id);
    var base = dev ? '../assets/book/' : 'assets/book/';
    var ext = dev ? '.png' : '.webp';   // 成品的圖由組書工具轉成 webp
    var tag = !dev && version ? '?v=' + encodeURIComponent(version) : '';
    var images = {};
    Object.keys(IMAGES).forEach(function (key) { images[key] = base + IMAGES[key] + ext + tag; });
    return { content: dev ? '../books/' + id + '/content.txt' : 'content.txt', images: images };
  }

  // 載一張圖並等它解好;載不到就回報失敗。ImageCtor 預設是瀏覽器的 Image。
  function preloadImage(url, ImageCtor) {
    var Ctor = ImageCtor || root.Image;
    return new Promise(function (resolve, reject) {
      var img = new Ctor();
      if (typeof img.decode === 'function') {
        img.src = url;
        img.decode().then(function () { resolve(img); }, reject);
      } else {
        img.onload = function () { resolve(img); };
        img.onerror = reject;
        img.src = url;
      }
    });
  }

  // 等一群 promise 都結束(成功失敗都算),最多等 ms 毫秒。
  // 全部結束 → true;時間到還沒結束 → false。永遠不會丟錯。
  function settleWithin(promises, ms) {
    return new Promise(function (resolve) {
      var left = promises.length;
      var timer = setTimeout(function () { resolve(false); }, ms);
      function one() {
        left -= 1;
        if (left <= 0) { clearTimeout(timer); resolve(true); }
      }
      if (!left) { clearTimeout(timer); resolve(true); return; }
      promises.forEach(function (p) { Promise.resolve(p).then(one, one); });
    });
  }

  // 開始翻頁閱讀;出錯時記下來並改用 fallback(el, book, err),畫面不會空白。
  function startReaderSafely(reader, el, book, fallback) {
    try {
      if (!reader || typeof reader.start !== 'function') throw new Error('翻頁閱讀程式沒有載入');
      reader.start(el, book);
      return true;
    } catch (err) {
      console.error('[星盤之書] 翻頁閱讀出錯,改用簡單的直排顯示:', err);
      try { fallback(el, book, err); } catch (e2) { console.error('[星盤之書] 簡單顯示也失敗:', e2); }
      return false;
    }
  }

  // 最簡單的備案:把整本書一段一段由上往下排出來(文字一律用 textContent)
  // 第三個參數不是網頁(例如 startReaderSafely 傳來的錯誤)時,用 el 自己所在的網頁。
  function showPlainBook(el, book, doc) {
    if (!doc || typeof doc.createElement !== 'function') doc = el.ownerDocument || root.document;
    el.textContent = '';
    // 翻頁模式的版面不能捲動,拿掉才看得到整本
    if (el.classList) el.classList.remove('reader-screen--flip', 'is-spread');
    var box = el.appendChild(doc.createElement('div'));
    box.className = 'reader-plain';
    function add(tag, cls, text) {
      var n = box.appendChild(doc.createElement(tag));
      n.className = cls;
      n.textContent = text;
      return n;
    }
    var meta = (book && book.meta) || {};
    var sections = (book && book.sections) || [];
    add('h1', 'reader-plain-title', meta.title || '星盤之書');
    if (meta.to) add('p', 'reader-plain-to', '給 ' + meta.to);
    var info = [meta.birth, meta.place].filter(Boolean).join(' · ');
    if (info) add('p', 'reader-plain-info', info);
    sections.forEach(function (s) {
      if (s.heading) add('h2', 'reader-plain-heading', s.heading);
      (s.paragraphs || []).forEach(function (p) { add('p', 'reader-plain-p', p); });
    });
    if (!sections.length) add('p', 'reader-plain-p', '這本書暫時打不開,請重新整理頁面再試一次。');
    add('p', 'reader-plain-end', '願星光照亮你的路 ✨');
  }

  var api = {
    resolvePaths: resolvePaths,
    preloadImage: preloadImage,
    settleWithin: settleWithin,
    startReaderSafely: startReaderSafely,
    showPlainBook: showPlainBook,
    PRELOAD_KEYS: PRELOAD_KEYS,
    PRELOAD_WAIT_MS: PRELOAD_WAIT_MS
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (!root || !root.document) return;   // 以下只在瀏覽器跑

  var SB = root.StarBook = root.StarBook || {};
  SB.main = api;
  var document = root.document;

  // 圖片網址轉成完整網址再交給 CSS,避免相對路徑被 CSS 檔的位置算錯。
  // 圖缺檔時 CSS 底下的漸層會露出來,所以不用另外處理。
  function setupAssets(images) {
    var assets = {};
    var rootStyle = document.documentElement.style;
    Object.keys(images).forEach(function (key) {
      var url = new URL(images[key], root.location.href).href;
      assets[key] = url;
      rootStyle.setProperty(CSS_VARS[key], 'url("' + url + '")');
    });
    SB.assets = assets;
  }

  // 進頁面就開始載開書要用的圖。回傳 { done, promises }
  function startPreload(assets) {
    var state = { done: false, promises: [] };
    state.promises = PRELOAD_KEYS.map(function (key) {
      return preloadImage(assets[key]).catch(function (err) {
        console.warn('[星盤之書] 圖片預先載入失敗(不影響開書):', assets[key], err);
      });
    });
    settleWithin(state.promises, 60000).then(function () { state.done = true; });
    return state;
  }

  function showError(msg) {
    var box = document.getElementById('load-error');
    box.textContent = msg;
    box.hidden = false;
  }

  function fillCover(meta) {
    var title = meta.title || '星盤之書';
    document.getElementById('cover-title').textContent = title;
    document.getElementById('cover-to').textContent = meta.to ? '給 ' + meta.to : '';
    document.title = meta.to ? title + '|給 ' + meta.to : title;
  }

  function openBook(book, preload) {
    var cover = document.getElementById('cover-screen');
    var readerScreen = document.getElementById('reader-screen');
    var bookEl = document.getElementById('book');
    var hint = cover.querySelector('.cover-hint');
    var opened = false;

    function play() {
      SB.opening.play(cover, function () {
        cover.hidden = true;
        readerScreen.hidden = false;
        readerScreen.classList.add('is-entering');
        root.scrollTo(0, 0);
        startReaderSafely(SB.reader, readerScreen, book, showPlainBook);
      });
    }

    function go() {
      if (opened) return;
      opened = true;
      bookEl.setAttribute('aria-disabled', 'true');
      if (preload.done) { play(); return; }
      if (hint) hint.textContent = WAKING_HINT;
      settleWithin(preload.promises, PRELOAD_WAIT_MS).then(play);
    }

    bookEl.addEventListener('click', go);
    bookEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
    });
  }

  function pageVersion() {
    var meta = document.querySelector('meta[name="starbook-version"]');
    return meta ? meta.getAttribute('content') : '';
  }

  // 網址有 ?tune=1 才載入封面文字調控板(客人看不到)
  function loadTuner(version) {
    if (new URLSearchParams(root.location.search).get('tune') !== '1') return;
    var s = document.createElement('script');
    s.src = 'js/tune.js' + (version ? '?v=' + encodeURIComponent(version) : '');
    document.body.appendChild(s);
  }

  function init() {
    var version = pageVersion();
    loadTuner(version);
    var paths = resolvePaths(root.location.search, version);
    setupAssets(paths.images);
    var preload = startPreload(SB.assets);

    fetch(paths.content, { cache: 'no-cache' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.text();
      })
      .then(function (text) {
        var book = SB.content.parse(text);
        SB.book = book;
        fillCover(book.meta);
        openBook(book, preload);
      })
      .catch(function (err) {
        console.error('[星盤之書] 讀不到內容:', paths.content, err);
        showError('找不到這本書的內容,請稍後再試一次。');
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(typeof window !== 'undefined' ? window : null);
