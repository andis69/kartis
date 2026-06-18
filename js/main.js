'use strict';
/*
 * Pokers - score keeper for a trick-taking card game (Tizen TV web app).
 * The scoring engine (editingDone), the round-table builder (fillCol0),
 * running totals (calcSum) and the "Nevar" forbidden-bid logic are ported
 * 1:1 from the original Delphi FMX code (Unit1.pas) so behaviour matches.
 * On top of that sits a TV remote layer: D-pad focus navigation, OK/Back,
 * and (when available) hardware number-key registration.
 */
(function () {
  // ---------- Constants & state ----------
  var DEFAULT_NAMES = ['', 'Andis', 'Uldis', 'Iluta', 'Ilze', 'Marl\u0113na']; // 1-indexed
  var COLS = 16;
  var STORE_KEY = 'pokers_state_v1';
  var formOrder = ['newGame', 'count', 'name1', 'name2', 'name3', 'name4', 'name5', 'scale', 'theme', 'won'];
  var t3Order = ['station', 'play', 'volume'];

  // Background radio presets - public internet streams. Edit freely; each URL must be
  // a direct audio stream (e.g. an Icecast/SHOUTcast MP3 or an .aac/.m3u8 stream).
  var RADIO = [
    { name: 'Costa Del Mar - Chillout', url: 'https://radio4.cdm-radio.com:18020/stream-mp3-Chill' },
    { name: 'Instrumentals Forever', url: 'https://quincy.torontocast.com:1925/stream' },
    { name: 'Super Hits Only', url: 'https://stream-175.zeno.fm/14322cs8mbruv' },
    { name: 'Instrumental Hits Radio', url: 'https://panel.retrolandigital.com/radio/8130/listen' },
    { name: 'DANCE, ELECTRO & HOUSE BEATS', url: 'https://stream.kissfm.de/kissfm-dance/aac-64/tunein/' },
    { name: 'Costa Del Mar Dance', url: 'https://radio4.cdm-radio.com:18000/stream-mp3-Dance' }
  ];

  var state = {
    comboIndex: 2, names: DEFAULT_NAMES.slice(), dala: 1,
    txt1: '', txt2: '', rowCount: 0, cells: [],
    headerSum: ['', '', '', '', '', ''],
    selCol: 1, selRow: 0, scale: 1.5, nevar: '-',
    theme: 'light', stationIndex: 0, volume: 0.6, autoWon: false
  };

  var buffer = null;          // multi-digit entry buffer
  var activeTab = 1;          // 1 = Parametri, 2 = Sp\u0113le, 3 = Papildu
  var focus = { zone: 'form', i: 0 }; // zones: tabs | form | grid | pad | t3
  var audioEl = null;
  var radioPlaying = false;

  // ---------- Helpers ----------
  function players() { return state.comboIndex + 2; }
  function initCells() { state.cells = []; for (var c = 0; c < COLS; c++) state.cells[c] = []; }
  function ensureRows(rc) {
    for (var c = 0; c < COLS; c++) {
      var col = state.cells[c] || (state.cells[c] = []);
      while (col.length < rc) col.push('');
      if (col.length > rc) col.length = rc;
    }
  }
  function getCell(c, r) {
    if (c < 0 || c >= COLS) return '';
    var col = state.cells[c];
    if (!col || r < 0 || r >= col.length) return '';
    return col[r] == null ? '' : col[r];
  }
  function setCell(c, r, v) {
    if (c < 0 || c >= COLS) return;
    if (!state.cells[c]) state.cells[c] = [];
    while (state.cells[c].length <= r) state.cells[c].push('');
    state.cells[c][r] = v;
  }
  function parseIntStrict(s) {
    if (s == null) return null;
    s = ('' + s).trim();
    return /^[+-]?\d+$/.test(s) ? parseInt(s, 10) : null;
  }
  var tryInt = parseIntStrict;
  function esc(s) { return ('' + s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function nameAt(col) { var p = Math.floor(col / 3) + 1; if (p < 1) p = 1; if (p > 5) p = 5; return state.names[p] || ''; }
  function headerOf(col) {
    if (col === 0) return 'Sk';
    var m = col % 3;
    if (m === 1) return 'Sola';
    if (m === 2) return 'Dab\u016b';
    return state.headerSum[col / 3] || '';
  }
  function editable(c, r) { return c > 0 && (c % 3 !== 0) && c <= players() * 3 && r >= 0 && r < state.rowCount; }

  // ---------- Ported core logic (unchanged behaviour) ----------
  function fillCol0() {
    var n = players(), cells0 = {}, rowCount = 0, y = 0, i = 1, c = 1, x = n;
    do {
      rowCount = y + 3; cells0[y] = '' + c;
      if (i * n * (c + 1) > 36) { x = x - 1; if (x > 0) c = c - i; else i = -1; }
      c = c + i; y = y + 1;
    } while (c > 0);
    for (var j = y; j <= y + n - 1; j++) { rowCount = j; cells0[j - 1] = '1'; }
    ensureRows(rowCount); state.rowCount = rowCount;
    for (var k in cells0) { var r = parseInt(k, 10); if (r >= 0 && r < rowCount) state.cells[0][r] = cells0[k]; }
  }
  function comboChange() { fillCol0(); }
  function calcSum() {
    for (var p = 1; p <= 5; p++) {
      var h = 0, col = 3 * p;
      for (var r = 0; r < state.rowCount; r++) { var v = parseIntStrict(getCell(col, r)); if (v !== null) h += v; }
      state.headerSum[p] = '' + h;
    }
  }
  // Turn label; in "verify" mode it also shows how many tricks remain in the row.
  function turnText(Col, Row) {
    var t = nameAt(Col) + ' ' + (headerOf(Col) || '').toLowerCase();
    if (!state.autoWon && Col % 3 === 2) {
      var need = parseIntStrict(getCell(0, Row)) || 0, sum = 0, p, w;
      for (p = 1; p <= players(); p++) { w = tryInt(getCell(3 * p - 1, Row)); if (w !== null) sum += w; }
      var rem = need - sum; if (rem < 0) rem = 0;
      t += '  \u00b7  atliku\u0161i ' + rem;
    }
    return t;
  }
  function editingDone(ACol, ARow) {
    var i = tryInt(getCell(ACol, ARow));
    if (i !== null && ('' + i) === state.nevar) {
      setCell(ACol, ARow, '#'); state.selCol = ACol; state.selRow = ARow; return;
    }
    var Col = 0, Row = 0, b = (getCell(ACol + 1, ARow) === '');
    var n, c, G, D, P, k, x, s;
    for (var r = 0; r <= state.rowCount; r++) {
      x = 0;
      if (Col !== 0) {
        if (b && getCell(ACol, ARow) !== '') {
          state.dala = state.dala + 1; n = players();
          if (state.dala > n) state.dala = 1;
          state.txt1 = (state.names[state.dala] || '') + ' dala';
          Col = 1 + (state.dala % n) * 3;
        }
        break;
      }
      for (i = 0; i <= state.comboIndex + 1; i++) {
        c = ((i + state.dala) % (state.comboIndex + 2)) * 3;
        G = tryInt(getCell(c + 1, r));
        if (G !== null) {
          x = x + G;
          if (i === state.comboIndex) {
            k = (parseIntStrict(getCell(0, r)) || 0) - x;
            state.nevar = (k >= 0) ? ('' + k) : '-';
          } else state.nevar = '';
          D = tryInt(getCell(c + 2, r));
          if (D !== null) {
            if (G === D) {
              if (r === state.rowCount - 2) P = 20;
              else if (r === state.rowCount - 1) P = 45;
              else P = 5;
              s = '' + (D * P + 5);
            } else if (G < D) s = '' + D;
            else if (r === state.rowCount - 2) s = '-25';
            else if (r === state.rowCount - 1) s = '-50';
            else s = '' + (-10 * (G - D));
            setCell(c + 3, r, s);
          } else if (Col === 0) { b = false; Col = c + 2; Row = r; }
        } else { Col = c + 1; Row = r; break; }
      }
    }
    calcSum();
    state.txt2 = turnText(Col, Row);
    state.selCol = Col; state.selRow = Row;
  }

  // ---------- Entry / commit ----------
  // The tricks taken (Dab\u016b) in a round must add up to the cards dealt that round.
  // When every "Dab\u016b" in the row is filled except one, that last value is forced.
  function forcedWonCell(row) {
    var np = players(), p, empty = -1, cnt = 0;
    for (p = 1; p <= np; p++) if (tryInt(getCell(3 * p - 2, row)) === null) return null; // a bid is still missing
    for (p = 1; p <= np; p++) if (tryInt(getCell(3 * p - 1, row)) === null) { empty = 3 * p - 1; cnt++; }
    return cnt === 1 ? empty : null;
  }
  function commitValue(col, row, val) {
    setCell(col, row, val);
    // auto-complete the last "Dab\u016b" so the row's tricks sum to the dealt count (when enabled)
    if (state.autoWon && col % 3 === 2) {
      var fc = forcedWonCell(row);
      if (fc !== null) {
        var need = parseIntStrict(getCell(0, row)) || 0, sum = 0, p, w;
        for (p = 1; p <= players(); p++) {
          if (3 * p - 1 === fc) continue;
          w = tryInt(getCell(3 * p - 1, row));
          if (w !== null) sum += w;
        }
        if (need - sum >= 0) { setCell(fc, row, '' + (need - sum)); col = fc; } // proceed as if the last Dab\u016b was entered
      }
    }
    editingDone(col, row);
    buffer = null;
    saveState();
    render();
    focusSelected();
  }
  function padDigit(d) {
    if (!editable(state.selCol, state.selRow)) return;
    var cur = getCell(state.selCol, state.selRow);
    var val = /^[0-9]+$/.test(cur) ? (cur + d) : ('' + d); // append if returning to a filled cell, else fresh
    commitValue(state.selCol, state.selRow, val);          // auto-advance to the next position
  }
  function handlePadButton(btn) {
    if (!btn) return;
    var act = btn.getAttribute('data-act'), d = btn.getAttribute('data-d');
    if (act === 'del') backspaceCell();
    else if (act === 'ok') { recomputeTurn(); saveState(); render(); focusSelected(); } // jump to the active (turn) cell and scroll to it
    else if (d != null) padDigit(+d);
  }
  // Recompute all result cells + totals from the current bids/wons (no advance, no dealer change).
  function recomputeScores() {
    var np = players(), p, r, G, D, P, s;
    for (p = 1; p <= np; p++) {
      for (r = 0; r < state.rowCount; r++) {
        G = tryInt(getCell(3 * p - 2, r));
        D = tryInt(getCell(3 * p - 1, r));
        if (G !== null && D !== null) {
          if (G === D) { P = (r === state.rowCount - 2) ? 20 : (r === state.rowCount - 1) ? 45 : 5; s = '' + (D * P + 5); }
          else if (G < D) s = '' + D;
          else if (r === state.rowCount - 2) s = '-25';
          else if (r === state.rowCount - 1) s = '-50';
          else s = '' + (-10 * (G - D));
          setCell(3 * p, r, s);
        } else { setCell(3 * p, r, ''); }
      }
    }
    calcSum();
  }
  // Delete the last character of the selected cell, in place (stays put so you can retype).
  function backspaceCell() {
    if (!editable(state.selCol, state.selRow)) return;
    var cur = getCell(state.selCol, state.selRow);
    if (cur === '') return;
    setCell(state.selCol, state.selRow, cur.slice(0, -1));
    recomputeScores();
    saveState(); render(); focusSelected();
  }

  // ---------- Grid cell navigation ----------
  function editableList() {
    var list = [];
    for (var r = 0; r < state.rowCount; r++)
      for (var c = 1; c <= players() * 3; c++) if (c % 3 !== 0) list.push([c, r]);
    return list;
  }
  function selectCell(c, r) { if (!editable(c, r)) return; state.selCol = c; state.selRow = r; render(); focusSelected(); }
  function findInRow(r, preferCol) {
    if (r < 0) r = 0; if (r >= state.rowCount) r = state.rowCount - 1;
    if (editable(preferCol, r)) return [preferCol, r];
    for (var d = 1; d < players() * 3; d++) {
      if (editable(preferCol - d, r)) return [preferCol - d, r];
      if (editable(preferCol + d, r)) return [preferCol + d, r];
    }
    return null;
  }
  function arrowMove(dir) {
    var list = editableList(), idx = -1;
    for (var n = 0; n < list.length; n++)
      if (list[n][0] === state.selCol && list[n][1] === state.selRow) { idx = n; break; }
    if (dir === 'Right') { if (idx >= 0 && idx < list.length - 1) selectCell(list[idx + 1][0], list[idx + 1][1]); }
    else if (dir === 'Left') { if (idx > 0) selectCell(list[idx - 1][0], list[idx - 1][1]); }
    else if (dir === 'Down') { var f = findInRow(state.selRow + 1, state.selCol); if (f) selectCell(f[0], f[1]); }
    else if (dir === 'Up') { var g = findInRow(state.selRow - 1, state.selCol); if (g) selectCell(g[0], g[1]); }
  }

  // ---------- Rendering ----------
  function cellTd(c, r, cls) {
    var sel = (c === state.selCol && r === state.selRow);
    var val = (sel && buffer !== null) ? buffer : getCell(c, r);
    return '<td class="inp ' + cls + (sel ? ' sel' : '') + '" data-c="' + c + '" data-r="' + r + '">' +
      esc(val) + (sel ? '<span class="caret"></span>' : '') + '</td>';
  }
  function renderGrid() {
    var vp = players(), p, r;
    var subW = ((95 / vp) / 3).toFixed(3) + '%';
    var cg = '<colgroup><col class="c-cnt" style="width:5%">';
    for (p = 1; p <= 5; p++) {
      if (p > vp) { cg += '<col class="c-a hidden-col"><col class="c-b hidden-col"><col class="c-c hidden-col">'; }
      else { cg += '<col class="c-a" style="width:' + subW + '"><col class="c-b" style="width:' + subW + '"><col class="c-c" style="width:' + subW + '">'; }
    }
    cg += '</colgroup>';
    // frozen header (separate table so the first two rows stay visible while the body scrolls)
    var head = cg + '<tr class="hdr-names"><th class="nevar">' + esc(state.nevar) + '</th>';
    for (p = 1; p <= 5; p++) head += (p > vp) ? '<th class="namehdr hidden-col" colspan="3"></th>' : '<th class="namehdr" colspan="3">' + esc(state.names[p] || '') + '</th>';
    head += '</tr><tr class="hdr-sub"><th class="h-cnt">Sk</th>';
    for (p = 1; p <= 5; p++) {
      var hc = p > vp ? ' hidden-col' : '';
      head += '<th class="h-a' + hc + '">Sola</th><th class="h-b' + hc + '">Dab\u016b</th><th class="h-c' + hc + '">' + esc(state.headerSum[p] || '') + '</th>';
    }
    head += '</tr>';
    document.getElementById('gridHead').innerHTML = head;
    // scrolling body
    var body = cg;
    for (r = 0; r < state.rowCount; r++) {
      var aw = true, ws = 0, wv2;
      for (p = 1; p <= vp; p++) { wv2 = parseIntStrict(getCell(3 * p - 1, r)); if (wv2 === null) { aw = false; break; } ws += wv2; }
      var c0 = parseIntStrict(getCell(0, r)), badsum = aw && c0 !== null && ws !== c0;
      body += '<tr><td class="cnt' + (badsum ? ' badsum' : '') + '">' + esc(getCell(0, r)) + '</td>';
      for (p = 1; p <= 5; p++) {
        var hcol = p > vp ? ' hidden-col' : '';
        var rv = getCell(3 * p, r), rn = parseIntStrict(rv), rcls = (rn === null) ? '' : (rn < 0 ? ' neg' : (rn > 0 ? ' pos' : ''));
        body += cellTd(3 * p - 2, r, 'a' + hcol) + cellTd(3 * p - 1, r, 'b' + hcol) + '<td class="res' + hcol + rcls + '">' + esc(rv) + '</td>';
      }
      body += '</tr>';
    }
    document.getElementById('gridTable').innerHTML = body;
  }
  function renderHeaderTexts() {
    document.getElementById('txt1').textContent = state.txt1;
    document.getElementById('txt2').textContent = state.txt2;
  }
  function renderCount() { document.getElementById('countVal').textContent = players(); }
  function updateScale() {
    document.documentElement.style.setProperty('--scale', state.scale);
    document.getElementById('scaleVal').textContent = ('00' + Math.round(state.scale * 100)).slice(-3) + ' %';
    var sl = document.getElementById('scale'); if (sl) sl.value = state.scale;
  }
  function renderTab3() {
    var t = document.getElementById('themeVal'); if (t) t.textContent = (state.theme === 'dark') ? 'Tum\u0161s' : 'Gai\u0161s';
    var wn = document.getElementById('wonVal'); if (wn) wn.textContent = state.autoWon ? 'Autom\u0101tiski' : 'P\u0101rbaud\u012bt';
    var st = document.getElementById('stationVal'); if (st) st.textContent = RADIO.length ? RADIO[state.stationIndex].name : '\u2014';
    var pl = document.getElementById('playVal'); if (pl) pl.textContent = radioPlaying ? '\u23f9 Aptur\u0113t' : '\u25b6 Atska\u0146ot';
    var v = document.getElementById('volVal'); if (v) v.textContent = Math.round(state.volume * 100) + ' %';
    var stt = document.getElementById('radioStatus');
    if (stt) stt.textContent = radioPlaying ? ('Skan: ' + (RADIO[state.stationIndex] ? RADIO[state.stationIndex].name : '')) : '';
  }
  function applyTheme() { document.body.classList.toggle('dark', state.theme === 'dark'); }
  function toggleTheme() { state.theme = (state.theme === 'dark') ? 'light' : 'dark'; applyTheme(); saveState(); renderTab3(); }
  function toggleWon() { state.autoWon = !state.autoWon; state.txt2 = turnText(state.selCol, state.selRow); saveState(); render(); }
  function playRadio() {
    if (!audioEl || !RADIO.length) return;
    var url = RADIO[state.stationIndex] && RADIO[state.stationIndex].url;
    if (!url) return;
    audioEl.src = url; audioEl.volume = state.volume;
    var pr = audioEl.play();
    if (pr && pr.catch) pr.catch(function () { var s = document.getElementById('radioStatus'); if (s) s.textContent = 'Neizdev\u0101s atska\u0146ot'; });
    radioPlaying = true; renderTab3();
  }
  function stopRadio() { if (audioEl) { audioEl.pause(); audioEl.removeAttribute('src'); audioEl.load(); } radioPlaying = false; renderTab3(); }
  function toggleRadio() { if (radioPlaying) stopRadio(); else playRadio(); }
  function changeStation(d) {
    if (!RADIO.length) return;
    if (d !== 0) state.stationIndex = (state.stationIndex + d + RADIO.length) % RADIO.length;
    saveState();
    if (radioPlaying) playRadio(); else renderTab3();
  }
  function changeVolume(d) {
    var v = Math.round((state.volume + d * 0.1) * 10) / 10;
    if (v < 0.1) v = 0.1; if (v > 1) v = 1;
    state.volume = v; if (audioEl) audioEl.volume = v; saveState(); renderTab3();
  }
  function render() { renderGrid(); renderHeaderTexts(); renderTab3(); applyFocus(); }
  function focusSelected() {
    var el = document.querySelector('#gridTable td.sel');
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  // ---------- Focus / TV navigation ----------
  function focusEl() {
    if (focus.zone === 'tabs') return document.getElementById('btab' + (focus.i + 1));
    if (activeTab === 1 && focus.zone === 'form') {
      var key = formOrder[focus.i];
      if (key === 'count') return document.getElementById('f_count');
      if (key === 'scale') return document.getElementById('f_scale');
      if (key === 'theme') return document.getElementById('f_theme');
      if (key === 'won') return document.getElementById('f_won');
      if (/^name/.test(key)) return document.getElementById('nrow' + key.slice(4));
      if (key === 'newGame') return document.getElementById('newGame');
    }
    if (activeTab === 2 && focus.zone === 'pad') {
      return document.querySelectorAll('#pad .focusable')[focus.i];
    }
    if (activeTab === 3 && focus.zone === 't3') {
      return document.getElementById('f_' + t3Order[focus.i]);
    }
    return null; // grid handled by the cell ring
  }
  function applyFocus() {
    var all = document.querySelectorAll('.focusable');
    for (var n = 0; n < all.length; n++) all[n].classList.remove('focused');
    var gw = document.getElementById('gridWrap');
    if (gw) gw.classList.toggle('grid-active', activeTab === 2 && focus.zone === 'grid');
    var el = focusEl(); if (el) el.classList.add('focused');
    if (activeTab === 2 && focus.zone === 'grid') focusSelected();
    else if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  function padDefaultIndex() {
    var btns = document.querySelectorAll('#pad .focusable');
    for (var i = 0; i < btns.length; i++) if (btns[i].getAttribute('data-d') === '0') return i;
    return 0;
  }
  function gotoPad() { focus = { zone: 'pad', i: padDefaultIndex() }; applyFocus(); }
  function enterPanel() {
    focus = activeTab === 1 ? { zone: 'form', i: 0 } : activeTab === 2 ? { zone: 'grid' } : { zone: 't3', i: 0 };
    applyFocus();
  }
  // Browser fullscreen: kick in on the first user gesture, like a real app.
  var fsArmed = true;
  function requestFullscreenOnce() {
    if (!fsArmed) return; fsArmed = false;
    var el = document.documentElement;
    var fn = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;
    if (fn) { try { var pr = fn.call(el); if (pr && pr.catch) pr.catch(function () {}); } catch (e) {} }
  }
  function onFsChange() { if (!(document.fullscreenElement || document.webkitFullscreenElement)) fsArmed = true; }

  function changeCount(delta) {
    var ni = state.comboIndex + delta; if (ni < 0) ni = 0; if (ni > 3) ni = 3;
    if (ni === state.comboIndex) return;
    state.comboIndex = ni; comboChange();
    state.txt1 = (state.names[state.dala] || '') + ' dala';
    renderCount(); saveState(); render();
  }
  function changeScale(delta) {
    var ns = Math.round((state.scale + delta * 0.05) * 100) / 100;
    if (ns < 0.75) ns = 0.75; if (ns > 2) ns = 2;
    state.scale = ns; updateScale(); saveState();
  }
  // Recompute whose turn it is (selection + "Nevar" + totals) for the current
  // column arrangement, WITHOUT advancing the dealer. Used after a reorder.
  function recomputeTurn() {
    var Col = 0, Row = 0, c, G, D, k, x, i, r;
    for (r = 0; r <= state.rowCount; r++) {
      if (Col !== 0) break;
      x = 0;
      for (i = 0; i <= state.comboIndex + 1; i++) {
        c = ((i + state.dala) % (state.comboIndex + 2)) * 3;
        G = tryInt(getCell(c + 1, r));
        if (G !== null) {
          x = x + G;
          if (i === state.comboIndex) { k = (parseIntStrict(getCell(0, r)) || 0) - x; state.nevar = (k >= 0) ? ('' + k) : '-'; }
          else state.nevar = '';
          D = tryInt(getCell(c + 2, r));
          if (D === null && Col === 0) { Col = c + 2; Row = r; }
        } else { Col = c + 1; Row = r; break; }
      }
    }
    calcSum();
    state.txt2 = turnText(Col, Row);
    state.selCol = Col; state.selRow = Row;
  }
  function moveName(idx, dir) {
    var np = players(), j = idx + dir;
    if (idx < 1 || idx > np || j < 1 || j > np) return; // reorder only among active players
    var t = state.names[idx]; state.names[idx] = state.names[j]; state.names[j] = t;
    // move each player's three score columns (Sola / Dab\u016b / result) along with them
    for (var r = 0; r < state.rowCount; r++) {
      for (var o = 0; o < 3; o++) {
        var ca = 3 * idx - 2 + o, cb = 3 * j - 2 + o, v = getCell(ca, r);
        setCell(ca, r, getCell(cb, r)); setCell(cb, r, v);
      }
    }
    // dealer stays the same person -> follow them to the new slot
    if (state.dala === idx) state.dala = j; else if (state.dala === j) state.dala = idx;
    state.txt1 = (state.names[state.dala] || '') + ' dala';
    recomputeTurn(); // bidding order now follows the new seating; "Nevar" recomputed
    for (var m = 1; m <= 5; m++) { var el = document.getElementById('name' + m); if (el) el.value = state.names[m] || ''; }
    focus = { zone: 'form', i: formOrder.indexOf('name' + j) };
    saveState(); render();
  }

  function navTab1(dir) {
    var last = formOrder.length - 1, key = formOrder[focus.i];
    if (dir === 'Up') { if (focus.i === 0) focus = { zone: 'tabs', i: 0 }; else focus.i--; }
    else if (dir === 'Down') { if (focus.i < last) focus.i++; }
    else if (dir === 'Left') { if (key === 'count') changeCount(-1); else if (key === 'scale') changeScale(-1); else if (key === 'theme') toggleTheme(); else if (key === 'won') toggleWon(); else if (/^name/.test(key)) moveName(+key.slice(4), -1); }
    else if (dir === 'Right') { if (key === 'count') changeCount(1); else if (key === 'scale') changeScale(1); else if (key === 'theme') toggleTheme(); else if (key === 'won') toggleWon(); else if (/^name/.test(key)) moveName(+key.slice(4), 1); }
  }
  function navTab2(dir) {
    if (focus.zone === 'grid') {
      if (buffer !== null) { commitValue(state.selCol, state.selRow, buffer); return; } // arrow commits pending value
      if (dir === 'Up') { if (state.selRow <= 0) focus = { zone: 'tabs', i: 1 }; else arrowMove('Up'); }
      else if (dir === 'Down') { if (state.selRow >= state.rowCount - 1) gotoPad(); else arrowMove('Down'); }
      else if (dir === 'Left') arrowMove('Left');
      else if (dir === 'Right') arrowMove('Right');
      return;
    }
    if (focus.zone === 'pad') {
      var nb = document.querySelectorAll('#pad .focusable').length;
      if (dir === 'Left') { if (focus.i > 0) focus.i--; }
      else if (dir === 'Right') { if (focus.i < nb - 1) focus.i++; }
      else if (dir === 'Up') focus = { zone: 'grid' };
    }
  }
  function navTabs(dir) {
    if (dir === 'Left') { if (focus.i > 0) { focus.i--; showTab(focus.i + 1); } }
    else if (dir === 'Right') { if (focus.i < 2) { focus.i++; showTab(focus.i + 1); } }
    else if (dir === 'Down') { enterPanel(); }
  }
  function navTab3(dir) {
    var last = t3Order.length - 1, key = t3Order[focus.i];
    if (dir === 'Up') { if (focus.i === 0) focus = { zone: 'tabs', i: 2 }; else focus.i--; }
    else if (dir === 'Down') { if (focus.i < last) focus.i++; }
    else if (dir === 'Left') { if (key === 'station') changeStation(-1); else if (key === 'volume') changeVolume(-1); }
    else if (dir === 'Right') { if (key === 'station') changeStation(1); else if (key === 'volume') changeVolume(1); }
  }
  function nav(dir) {
    if (focus.zone === 'tabs') { navTabs(dir); applyFocus(); return; }
    if (activeTab === 1) navTab1(dir);
    else if (activeTab === 2) navTab2(dir);
    else navTab3(dir);
    applyFocus();
  }

  function onEnter() {
    if (focus.zone === 'tabs') { enterPanel(); return; }
    if (activeTab === 1 && focus.zone === 'form') {
      var key = formOrder[focus.i];
      if (/^name/.test(key)) { var inp = document.getElementById('name' + key.slice(4)); if (inp) { inp.focus(); try { inp.select(); } catch (e) {} } }
      else if (key === 'theme') toggleTheme();
      else if (key === 'won') toggleWon();
      else if (key === 'newGame') newGame();
      return;
    }
    if (activeTab === 2 && focus.zone === 'grid') {
      if (buffer !== null) commitValue(state.selCol, state.selRow, buffer); else gotoPad();
      return;
    }
    if (activeTab === 2 && focus.zone === 'pad') { handlePadButton(document.querySelectorAll('#pad .focusable')[focus.i]); return; }
    if (activeTab === 3 && focus.zone === 't3') {
      var k = t3Order[focus.i];
      if (k === 'play') toggleRadio();
      else if (k === 'station') { if (!radioPlaying) playRadio(); }
    }
  }
  function isEditingName() {
    var a = document.activeElement;
    return a && a.classList && a.classList.contains('nameinput');
  }
  function goBack() {
    if (buffer !== null) { buffer = null; render(); return; }
    if (isEditingName()) { document.activeElement.blur(); return; }
    if (activeTab === 2 || activeTab === 3) { showTab(1); focus = { zone: 'form', i: 0 }; applyFocus(); return; }
    try { if (window.tizen && tizen.application) { tizen.application.getCurrentApplication().exit(); return; } } catch (e) {}
  }

  // ---------- Tabs ----------
  function showTab(t) {
    activeTab = t;
    for (var i = 1; i <= 3; i++) {
      document.getElementById('tab' + i).classList.toggle('active', t === i);
      document.getElementById('btab' + i).classList.toggle('on', t === i);
    }
    render();
  }
  function setActiveTab(t) {
    showTab(t);
    focus = t === 1 ? { zone: 'form', i: 0 } : t === 2 ? { zone: 'grid' } : { zone: 't3', i: 0 };
    applyFocus();
  }

  // ---------- Actions ----------
  function newGame() {
    for (var r = 0; r < state.rowCount; r++) for (var c = 1; c < COLS; c++) setCell(c, r, '');
    state.dala = Math.floor(Math.random() * players()) + 1;
    comboChange();
    editingDone(0, 0);
    saveState();
    setActiveTab(2);
  }
  function tickClock() {
    var d = new Date();
    document.getElementById('clock').textContent = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }

  // ---------- Persistence ----------
  function saveState() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        comboIndex: state.comboIndex, names: state.names, dala: state.dala,
        txt1: state.txt1, txt2: state.txt2, rowCount: state.rowCount, cells: state.cells,
        headerSum: state.headerSum, selCol: state.selCol, selRow: state.selRow, scale: state.scale, nevar: state.nevar,
        theme: state.theme, stationIndex: state.stationIndex, volume: state.volume, autoWon: state.autoWon
      }));
    } catch (e) {}
  }
  function loadState() {
    try {
      var raw = localStorage.getItem(STORE_KEY); if (!raw) return false;
      var d = JSON.parse(raw);
      state.comboIndex = (typeof d.comboIndex === 'number') ? d.comboIndex : 2;
      state.names = (d.names && d.names.length >= 6) ? d.names : DEFAULT_NAMES.slice();
      state.dala = d.dala || 1; state.txt1 = d.txt1 || ''; state.txt2 = d.txt2 || '';
      state.rowCount = d.rowCount || 0; state.cells = d.cells || [];
      while (state.cells.length < COLS) state.cells.push([]);
      state.headerSum = d.headerSum || ['', '', '', '', '', ''];
      state.selCol = d.selCol || 1; state.selRow = d.selRow || 0;
      state.scale = d.scale || 1.5; state.nevar = d.nevar || '-';
      state.theme = (d.theme === 'dark') ? 'dark' : 'light';
      state.stationIndex = (typeof d.stationIndex === 'number' && d.stationIndex >= 0 && d.stationIndex < RADIO.length) ? d.stationIndex : 0;
      state.volume = (typeof d.volume === 'number') ? Math.min(1, Math.max(0.1, d.volume)) : 0.6;
      state.autoWon = !!d.autoWon;
      return true;
    } catch (e) { return false; }
  }

  // ---------- TV hardware keys ----------
  function registerTVKeys() {
    try {
      if (window.tizen && tizen.tvinputdevice && tizen.tvinputdevice.registerKey) {
        var keys = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
        for (var i = 0; i < keys.length; i++) { try { tizen.tvinputdevice.registerKey(keys[i]); } catch (e) {} }
      }
    } catch (e) {}
  }

  // ---------- Init ----------
  function init() {
    initCells();
    if (!loadState()) {
      comboChange();
      state.txt1 = (state.names[state.dala] || '') + ' dala';
      calcSum();
    } else ensureRows(state.rowCount);

    renderCount();
    for (var p = 1; p <= 5; p++) { var inp = document.getElementById('name' + p); if (inp) inp.value = state.names[p] || ''; }
    document.getElementById('scale').value = state.scale;
    updateScale();

    // mouse / pointer support (emulator, Smart Remote pointer)
    document.getElementById('btab1').addEventListener('click', function () { setActiveTab(1); });
    document.getElementById('btab2').addEventListener('click', function () { setActiveTab(2); });
    document.getElementById('btab3').addEventListener('click', function () { setActiveTab(3); });
    document.getElementById('newGame').addEventListener('click', newGame);

    // Tab 3: theme + radio
    audioEl = document.getElementById('radio');
    if (audioEl) {
      audioEl.volume = state.volume;
      audioEl.addEventListener('error', function () { var s = document.getElementById('radioStatus'); if (s && radioPlaying) s.textContent = 'Neizdev\u0101s atska\u0146ot'; });
    }
    applyTheme();
    document.getElementById('f_theme').addEventListener('click', function () { focus = { zone: 'form', i: formOrder.indexOf('theme') }; toggleTheme(); applyFocus(); });
    document.getElementById('f_won').addEventListener('click', function () { focus = { zone: 'form', i: formOrder.indexOf('won') }; toggleWon(); applyFocus(); });
    document.getElementById('f_play').addEventListener('click', function () { focus = { zone: 't3', i: t3Order.indexOf('play') }; toggleRadio(); applyFocus(); });
    document.getElementById('f_station').addEventListener('click', function (e) {
      var rect = this.getBoundingClientRect();
      focus = { zone: 't3', i: t3Order.indexOf('station') };
      changeStation(e.clientX < rect.left + rect.width / 2 ? -1 : 1); applyFocus();
    });
    document.getElementById('f_volume').addEventListener('click', function (e) {
      var rect = this.getBoundingClientRect();
      focus = { zone: 't3', i: t3Order.indexOf('volume') };
      changeVolume(e.clientX < rect.left + rect.width / 2 ? -1 : 1); applyFocus();
    });
    document.getElementById('f_count').addEventListener('click', function (e) {
      var rect = this.getBoundingClientRect();
      changeCount(e.clientX < rect.left + rect.width / 2 ? -1 : 1);
      focus = { zone: 'form', i: formOrder.indexOf('count') }; applyFocus();
    });
    document.getElementById('scale').addEventListener('input', function (e) { state.scale = parseFloat(e.target.value); updateScale(); saveState(); });
    for (p = 1; p <= 5; p++) {
      (function (idx) {
        var el = document.getElementById('name' + idx); if (!el) return;
        el.addEventListener('input', function () {
          state.names[idx] = el.value;
          state.txt1 = (state.names[state.dala] || '') + ' dala';
          saveState(); renderHeaderTexts(); renderGrid();
        });
      })(p);
    }
    var namesBox = document.querySelector('.names');
    if (namesBox) namesBox.addEventListener('click', function (e) {
      var mv = e.target.closest('.mv');
      if (mv) { moveName(+mv.getAttribute('data-idx'), +mv.getAttribute('data-dir')); return; }
      var row = e.target.closest('.nrow');
      if (row) { focus = { zone: 'form', i: formOrder.indexOf('name' + row.id.replace('nrow', '')) }; applyFocus(); }
    });
    document.getElementById('pad').addEventListener('click', function (e) {
      var b = e.target.closest('.focusable'); if (!b) return;
      var btns = document.querySelectorAll('#pad .focusable');
      for (var i = 0; i < btns.length; i++) if (btns[i] === b) { focus = { zone: 'pad', i: i }; break; }
      handlePadButton(b); applyFocus();
    });
    document.getElementById('gridTable').addEventListener('click', function (e) {
      var td = e.target.closest('td.inp'); if (!td) return;
      var c = +td.getAttribute('data-c'), r = +td.getAttribute('data-r');
      if (!editable(c, r)) return;
      if (buffer !== null && !(c === state.selCol && r === state.selRow)) commitValue(state.selCol, state.selRow, buffer);
      state.selCol = c; state.selRow = r; buffer = null; focus = { zone: 'grid' }; render(); focusSelected();
    });

    // keyboard + TV remote (capture phase + stopPropagation so our control navigation
    // wins over the browser's built-in arrow/pointer navigation)
    function stop(e) { e.preventDefault(); if (e.stopPropagation) e.stopPropagation(); }
    window.addEventListener('keydown', function (e) {
      requestFullscreenOnce();
      var kc = e.keyCode;
      if (isEditingName()) {
        if (kc === 13 || kc === 10009) { document.activeElement.blur(); stop(e); }
        return;
      }
      if (kc >= 48 && kc <= 57) {
        if (activeTab === 2 && (focus.zone === 'grid' || focus.zone === 'pad')) { padDigit(kc - 48); stop(e); }
        return;
      }
      switch (kc) {
        case 37: nav('Left'); stop(e); break;
        case 38: nav('Up'); stop(e); break;
        case 39: nav('Right'); stop(e); break;
        case 40: nav('Down'); stop(e); break;
        case 13: onEnter(); stop(e); break;
        case 8: if (activeTab === 2 && (focus.zone === 'grid' || focus.zone === 'pad')) { backspaceCell(); stop(e); } break;
        case 27: if (buffer !== null) { buffer = null; render(); stop(e); } break;
        case 10009: goBack(); stop(e); break;
      }
    }, true);

    registerTVKeys();
    window.addEventListener('pointerdown', requestFullscreenOnce, true);
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    tickClock(); setInterval(tickClock, 3000);
    focus = { zone: 'form', i: formOrder.indexOf('newGame') };
    showTab(1);
    applyFocus();

    document.addEventListener('visibilitychange', function () { if (document.hidden) saveState(); });
    window.addEventListener('beforeunload', saveState);
  }
  document.addEventListener('DOMContentLoaded', init);
})();
