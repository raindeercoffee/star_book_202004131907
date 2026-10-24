// 把 content.txt 的文字變成「書的資料」。純函式,瀏覽器和 node 都能用。
// 瀏覽器:window.StarBook.content.parse(text)
// node:require('./content.js').parse(text)
(function (root) {
  'use strict';

  var META_KEYS = { '書名': 'title', '給': 'to', '出生': 'birth', '地點': 'place' };

  function parseMeta(lines) {
    var meta = { title: '', to: '', birth: '', place: '' };
    lines.forEach(function (line) {
      var m = line.match(/^\s*([^:：]+?)\s*[:：]\s*(.*?)\s*$/);
      if (m && META_KEYS[m[1]]) meta[META_KEYS[m[1]]] = m[2];
    });
    return meta;
  }

  // 內文 → sections。
  // 「# 標題」開新章節;「===」單獨一行 = 強制換頁(下一段開一個沒有標題、forceBreakBefore 的新區塊);
  // 空行 = 新段落;單一換行保留在段落裡('\n')。
  function parseBody(lines) {
    var sections = [];
    var current = null;
    var para = [];
    var pendingBreak = false;

    function flushPara() {
      if (!para.length) return;
      if (!current) {
        current = { heading: '', paragraphs: [], forceBreakBefore: pendingBreak };
        sections.push(current);
        pendingBreak = false;
      }
      current.paragraphs.push(para.join('\n'));
      para = [];
    }

    lines.forEach(function (raw) {
      var line = raw.replace(/\s+$/, '');
      var h = line.match(/^#\s+(.*)$/);
      if (h) {
        flushPara();
        current = { heading: h[1].trim(), paragraphs: [], forceBreakBefore: pendingBreak };
        sections.push(current);
        pendingBreak = false;
      } else if (line.trim() === '===') {
        flushPara();
        current = null;
        pendingBreak = true;
      } else if (line.trim() === '') {
        flushPara();
      } else {
        para.push(line.trim());
      }
    });
    flushPara();
    return sections;
  }

  function parse(text) {
    var lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/);
    var sep = lines.findIndex(function (l) { return l.trim() === '---'; });
    var meta = parseMeta(sep >= 0 ? lines.slice(0, sep) : []);
    var body = sep >= 0 ? lines.slice(sep + 1) : lines;
    return { meta: meta, sections: parseBody(body) };
  }

  var api = { parse: parse };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.StarBook = root.StarBook || {};
    root.StarBook.content = api;
  }
})(typeof window !== 'undefined' ? window : null);
