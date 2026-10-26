/* QA probe (not shipped): drives the real page in headless Chrome.
   Config comes from the URL hash so one probe file can cover several runs:
     #hard   Engine X = Hard,  Engine O = Medium   (rich search report)
     #fast   both Medium                            (a decisive game, quickly)
     #pvp    two-player mode, synthetic clicks on the board, then Undo + Hint
     #d0     both Medium with Look-ahead pinned to 0 (no search, opening variation)
     #d12    Hard vs Medium with Look-ahead pinned to 12 plies (the reported deep case)
*/
(function () {
  var q = function (id) { return document.getElementById(id); };
  function setSel(id, v) { var s = q(id); if (!s) return; s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); }
  function setRange(id, v) { var r = q(id); if (!r) return; r.value = v; r.dispatchEvent(new Event('input', { bubbles: true })); }
  function mode(m) { var b = document.querySelector('#modeSeg button[data-mode="' + m + '"]'); if (b) b.click(); }

  var hash = (location.hash || '#hard').slice(1);
  if (hash === 'hard') { mode('cvc'); setSel('lvl1Sel', 'hard'); setSel('lvl2Sel', 'medium'); }
  else if (hash === 'fast') { mode('cvc'); setSel('lvl1Sel', 'medium'); setSel('lvl2Sel', 'medium'); }
  else if (hash === 'expert') { mode('cvc'); setSel('lvl1Sel', 'expert'); setSel('lvl2Sel', 'expert'); }
  else if (hash === 'master') { mode('cvc'); setSel('lvl1Sel', 'master'); setSel('lvl2Sel', 'master'); }
  else if (hash === 'easy') { mode('cvc'); setSel('lvl1Sel', 'easy'); setSel('lvl2Sel', 'easy'); }
  else if (hash === 'd0') {
    mode('cvc'); setSel('lvl1Sel', 'medium'); setSel('lvl2Sel', 'medium');
    setSel('depthSel', '0');           // pinned 0 plies: no search at all
  } else if (hash === 'd12') {
    mode('cvc'); setSel('lvl1Sel', 'hard'); setSel('lvl2Sel', 'medium');
    setSel('depthSel', '12');          // the reported setting: look-ahead pinned to 12 plies
    setRange('timeSel', '2500');       // explicit clock so the run is not machine-speed dependent
  } else if (hash === 'pvp') {
    mode('pvp');
    var cv = q('board');
    var pts = [];
    for (var i = 0; i < 9; i++) pts.push([120 + (i % 3) * 90, 120 + Math.floor(i / 3) * 90]);
    var j = 0;
    var iv = setInterval(function () {
      if (j >= pts.length) { clearInterval(iv); return; }
      var r = cv.getBoundingClientRect();
      var x = r.left + pts[j][0], y = r.top + pts[j][1];
      cv.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true }));
      cv.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, bubbles: true }));
      j++;
    }, 120);
    // after the clicks land: undo one move, then press Hint (exercises undo + the worker search path in PvP)
    setTimeout(function () { q('undoBtn').click(); }, 1450);
    setTimeout(function () { q('hintBtn').click(); }, 1700);
  }
  setRange('speedSel', '0');
  q('newBtn').click();

  var box = document.createElement('div');
  box.id = 'probeStatus';
  box.style.cssText = 'position:fixed;left:6px;bottom:6px;z-index:9999;font:11px/1.5 monospace;color:#eaf2ff;background:#000;padding:6px 8px;max-width:96vw;border:1px solid #444';
  document.body.appendChild(box);
  function probeCanvas() {
    var c = q('board');
    if (!c || !c.getContext) return 'nocanvas';
    var g = c.getContext('2d');
    var d = g.getImageData(0, 0, c.width, c.height).data;
    var lit = 0, ink = 0;
    for (var i = 0; i < d.length; i += 4 * 17) {
      var v = d[i] + d[i + 1] + d[i + 2];
      if (v > 90) lit++;
      if (v > 300) ink++;
    }
    return 'canvas=' + c.width + 'x' + c.height + ' lit=' + lit + ' ink=' + ink;
  }
  // square pixels of the result panel that sit on top of the board - must be 0
  function overlap() {
    var b = q('banner'), c = q('board');
    if (!b || !c) return -1;
    var br = b.getBoundingClientRect(), cr = c.getBoundingClientRect();
    var w = Math.min(br.right, cr.right) - Math.max(br.left, cr.left);
    var h = Math.min(br.bottom, cr.bottom) - Math.max(br.top, cr.top);
    return (w <= 0 || h <= 0) ? 0 : Math.round(w * h);
  }
  // what the strength menu is actually promising, and how many workers answered the last move
  function lvlText() {
    const t = (id) => {
      var s = q(id);
      if (!s || s.selectedIndex < 0) return '-';
      var txt = s.options[s.selectedIndex].textContent.replace(/\s+/g, ' ');
      return txt + ' (value=' + s.value + ', visible=' + (s.closest('label') ? s.closest('label').style.display !== 'none' : '?') + ')';
    };
    return t('lvl1Sel') + ' vs ' + t('lvl2Sel');
  }
  // the colour the decision text is actually drawn in - it must be one of the two stone colours
  function colOf(id) {
    var e = q(id);
    return e ? getComputedStyle(e).color : '-';
  }
  // the decision log: how many lines, which colours they use, and what the newest one says
  function logInfo() {
    var l = q('logList');
    if (!l) return 'no-log-element';
    var kids = Array.prototype.slice.call(l.querySelectorAll('.msg'));
    var cols = {};
    kids.forEach(function (m) {
      var c = getComputedStyle(m.querySelector('.mv')).color;
      cols[c] = (cols[c] || 0) + 1;
    });
    var seen = Object.keys(cols).map(function (c) { return c + '×' + cols[c]; });
    var last = kids.length ? kids[kids.length - 1].textContent.replace(/\s+/g, ' ').slice(0, 170) : '(none)';
    return kids.length + ' lines cols[' + seen.join(',') + '] last "' + last + '"';
  }
  // the advanced panel must be closed by default, and its visible line must state what is pinned
  function foldInfo() {
    var d = q('settingsCard');
    if (!d) return 'no-settings-card';
    var peek = q('setPeek');
    return (d.open ? 'open' : 'closed') + ' peek="' + (peek ? peek.textContent.replace(/\s+/g, ' ') : '-') + '"';
  }
  setInterval(function () {
    box.textContent = 'HASH=' + hash + ' | MOVES=' + q('stMoves').textContent + ' | ' + probeCanvas() +
      ' | DEPTH=' + q('stDepth').textContent + ' | WHY=' + q('stWhy').textContent +
      ' | DECCOL=' + colOf('stWhy') + ' | BY=' + q('stBy').textContent + ' | BYCOL=' + colOf('stBy') +
      ' | NODES=' + q('stNodes').textContent + ' | TIME=' + q('stTime').textContent +
      ' | WORKERS=' + q('stThreads').textContent + ' | LVL=' + lvlText() +
      ' | FOURS=' + q('stFours').textContent + ' | SCORE=' + q('stScore').textContent +
      ' | TURN=' + q('turnTxt').textContent + ' | THINK=' + q('thinkDots').className +
      ' | OVERLAP=' + overlap() +
      ' | LOG=' + logInfo() +
      ' | SETTINGS=' + foldInfo() +
      ' | BANNER=' + (q('banner') && q('banner').classList.contains('show') ? q('bannerRes').textContent : '(hidden)') +
      ' | TALLY=' + q('sc1').textContent + '/' + q('scD').textContent + '/' + q('sc2').textContent;
  }, 250);
})();
