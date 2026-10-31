/* NukkadTales — after Add to cart: the "one more piece" sheet, the offer strip, and the product-page ladder + bought-together block.
   Reads window.NT_SHEET (published from the dashboard). No network calls except Shopify's own cart endpoints. */
(function () {
  'use strict';
  var D = window.NT_SHEET || {}; if (!D.catalogue) return;
  var CAT = D.catalogue, PICKS = D.picks || {}, WHY = D.why || {}, LADDER = D.ladder || [], CUSTOM = D.custom || '', COLORS = D.colors || {}, IMG = D.imgBase || '';
  // v2 data packs colours as [name, variantId, price]; unpack once. Real swatch colours also arrive from the page (NT_SWATCHES, read from the product's own swatches in Liquid)
  for (var hk in CAT) { var cc = CAT[hk]; if (cc.img && IMG && cc.img.indexOf('http') !== 0) cc.img = IMG + cc.img; cc.cols = (cc.cols || []).map(function (c) { return Array.isArray(c) ? { n: c[0], vid: c[1], p: c[2] } : c; }); }
  var PAGE_SW = window.NT_SWATCHES || {}; try { var saved = JSON.parse(localStorage.getItem('nt_swatches') || '{}'); for (var k0 in PAGE_SW) saved[k0] = PAGE_SW[k0]; localStorage.setItem('nt_swatches', JSON.stringify(saved)); PAGE_SW = saved; } catch (e) {}
  var NAMED = { peach: '#f4a58a', blue: '#9ecbe6', white: '#f3efe8', red: '#d1261f', orange: '#ec8b1a', green: '#bfe3a3', yellow: '#f6d21c', purple: '#c9a9e8', gold: '#c89a5e', 'natural oak': '#b8895a', 'warm teak': '#7c4b1e', walnut: '#4a2c0a', espresso: '#5d4037', ivory: '#f5f0e8', sage: '#558b2f', terracotta: '#bf5530', charcoal: '#3a3a3a', rust: '#c7472a', forest: '#2b6a4a', indigo: '#3b4f9a', mustard: '#d9a441', rose: '#b23a6b', teal: '#2a7f8f', white: '#f5f0e8', black: '#2b2b2b', blue: '#3b4f9a', green: '#2b6a4a', red: '#c7472a', yellow: '#d9a441', pink: '#d77fa1', orange: '#e0764a', brown: '#7c4b1e', gold: '#c89a5e', cream: '#f3e6cf', grey: '#8a8a8a', gray: '#8a8a8a', peach: '#e8915b', maroon: '#7a1f2b', navy: '#1f2a5a', olive: '#6b7a2a', lavender: '#9a86c9', mint: '#7fc8a9', coral: '#e0764a', beige: '#d9c7a7' };
  var fmt = function (n) { return '₹' + Math.round(n).toLocaleString('en-IN'); };
  var hexOf = function (c) { if (c.hex) return c.hex; if (PAGE_SW[c.n]) return PAGE_SW[c.n]; if (COLORS[c.n]) return COLORS[c.n]; var n = (c.n || '').toLowerCase(); for (var k in NAMED) if (n.indexOf(k) >= 0) return NAMED[k]; return '#b07e44'; };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var ss = { get: function (k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }, set: function (k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} } };

  /* ── offer ──────────────────────────────────────────────── */
  // The offer the strip talks about. Published from the dashboard (Sheet picks → Offer); these defaults run until then.
  var OFFER = D.offer || { title: 'Special Diwali offers', type: 'free_nth', every: 3, steps: [3, 6, 9], price: 599, code: '', codes: ['DIWALI1', 'DIWALI2', 'DIWALI3'], note: 'Prepaid only · till 2 Nov', ends: '2026-11-02' };
  var EVERY = Math.max(2, +OFFER.every || 3), UNIT = +OFFER.price || 599, TIERS = OFFER.type === 'tiers' ? (OFFER.tiers && OFFER.tiers.length ? OFFER.tiers : LADDER) : [];
  var offerLive = !OFFER.ends || new Date().toISOString().slice(0, 10) <= OFFER.ends;
  /* ── flat sale (dashboard → Sale mode): timed in 24-hour days from an IST start; while it runs the strip is the sale
     timer and the free-quote offer rests (no ladder, no FREE tags, no price strike) ── */
  var SALE = D.sale && D.sale.on ? D.sale : null;
  function saleIst(s) { var m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})/.exec(String(s || '')); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 5, +m[5] - 30) : NaN; }
  function saleState() {
    if (!SALE) return null;
    var start = saleIst(SALE.start), days = +SALE.days || 3, DAY = 86400000, now = Date.now();
    if (isNaN(start) || now < start) return null;
    var idx = Math.floor((now - start) / DAY) + 1; if (idx > days) return null;
    var txt = idx === 1 ? SALE.day1 : idx === 2 ? SALE.day2 : idx === 3 ? SALE.day3 : (SALE.day_more || 'Day {n}');
    var t = Math.floor((start + idx * DAY - now) / 1000), pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return { idx: idx, last: idx === days, day: String(txt || '').replace('{n}', idx).replace('{days}', days), clock: pad(Math.floor(t / 3600)) + ':' + pad(Math.floor(t % 3600 / 60)) + ':' + pad(t % 60), urgent: t < 3600 };
  }
  var saleNow = saleState(); if (saleNow) offerLive = false;
  function saleLine(s) { return '🔥 ' + s.day + ' · ' + (s.last ? 'ends in ' : 'today ends in ') + s.clock; }
  // The strip has one short line for the cart summary: first part of the note only ("Prepaid only"); the drawer carries all of it
  var NOTE_SHORT = (OFFER.note || '').split(' · ')[0].trim();
  // One coupon per unlock point (DIWALI1 at 3, DIWALI2 at 6, DIWALI3 at 9); the last one repeats beyond
  var CODES = (OFFER.codes && OFFER.codes.length ? OFFER.codes : (OFFER.code ? [OFFER.code] : [])).map(String);
  function codeFor(k) { return !CODES.length || k < 1 ? '' : CODES[Math.min(k, CODES.length) - 1]; }
  // Any code in a line becomes a coupon chip
  function chips(html) {
    if (!CODES.length) return html;
    var re = new RegExp('\\b(' + CODES.map(function (c) { return c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|') + ')\\b', 'g');
    // "use code" goes in front unless the line already says so
    return html.replace(re, function (m, c, at) { var before = html.slice(Math.max(0, at - 12), at); return (/code\s*[-:–]?\s*$/i.test(before) ? '' : 'use code ') + '<code class="cc">' + c + '</code>'; });
  }
  // Every line, editable on the dashboard (Sheet picks → Offer → Texts); these are the defaults
  var TX_DEFAULT = { empty_line: 'Buy {t1_1}, get the {t1_nth} FREE', empty_side: '{t1} for {t1_pay}', first: 'Add {more} more — 1 is FREE', mid: 'Add {more} more — 1 is FREE', hot: '🎁 Add 1 more — it’s FREE', done: 'Make it {next_n} — pay for {next_paid}, {next_free} FREE', side_next: '{next_n} for {next_pay} · use code {next_code}', side_done: '{next_n} for {next_pay} · use code {next_code}', summary: '{n} in cart · {pay}', summary_done: '{pay} · {k} FREE ✓ · code {code}', ladder_title: 'Buy {t1_1}, get the {t1_nth} free', rule1: 'Add {t1} quotes, the cheapest one is FREE (worth up to {unit})', rule2: '{t2} quotes → 2 FREE · {t3} quotes → 3 FREE', rule3: 'Codes {codes} apply on their own at checkout', also_empty: 'People also buy with this', also_coll: 'More from {coll}', also_first: 'Buy {t1_1}, get the {t1_nth} FREE', also_hot: 'Pick your FREE {t1_nth} quote', also_done: 'Make it {next_n} — pay for {next_paid}, {next_free} FREE', sim_tag: 'similar', card_tag: '', card_tag_more: 'Add {more} more, get 1 free', card_tag_free: 'FREE' };
  var TX = {}; for (var tk in TX_DEFAULT) TX[tk] = (OFFER.text && OFFER.text[tk]) || TX_DEFAULT[tk];
  function tx(key, v) { return TX[key].replace(/\{(\w+)\}/g, function (m, k) { return v && v[k] != null ? v[k] : m; }).replace(/\s*·\s*·/g, ' ·').replace(/^\s*·\s*|\s*·\s*$/g, ''); }
  var bold = function (t) { return esc(t).replace(/FREE/g, '<b>FREE</b>'); };
  // Only stock quotes and their colour variations are in the offer: the custom pick, customised pieces and brand logos stay out
  var MAX_PRICE = +OFFER.max_price || 999;
  // When the offer names the collection the Shopify discount is set on, only those designs count, exactly as checkout does
  var ELIG = null; if (OFFER.eligible && OFFER.eligible.length) { ELIG = {}; OFFER.eligible.forEach(function (h) { ELIG[h] = 1; }); }
  function eligibleHandle(h) { return h !== CUSTOM && (!ELIG || !!ELIG[h]); }
  function eligible(it) { var p = (it.original_price != null ? it.original_price : it.price) / 100; if (it.handle === CUSTOM) return false; if (ELIG) return !!ELIG[it.handle]; return p >= UNIT && p <= MAX_PRICE && !/custom|personali|logo/i.test(it.product_type || ''); }
  function unitsOf(cart) { var u = []; (cart.items || []).forEach(function (it) { if (!eligible(it)) return; var p = (it.original_price != null ? it.original_price : it.price) / 100; for (var i = 0; i < it.quantity; i++) u.push(p); }); return u; }
  // Every Nth quote free: the cheapest ones go free, as Shopify's automatic discount applies it
  // Free quotes unlock at set counts (default 3, 8, 12: Shopflo's three coupons); past the last point the gap repeats
  var TH = (OFFER.steps && OFFER.steps.length ? OFFER.steps : [EVERY, EVERY * 2, EVERY * 3]).map(Number).filter(function (x) { return x > 0; }).sort(function (a, b) { return a - b; });
  var GAP = TH.length > 1 ? TH[TH.length - 1] - TH[TH.length - 2] : TH[0];
  function freeCount(n) { var k = 0; for (var i = 0; i < TH.length; i++) if (n >= TH[i]) k = i + 1; if (k === TH.length) k += Math.floor((n - TH[TH.length - 1]) / GAP); return k; }
  function nextAt(n) { for (var i = 0; i < TH.length; i++) if (n < TH[i]) return TH[i]; var last = TH[TH.length - 1]; return last + GAP * (Math.floor((n - last) / GAP) + 1); }
  function prevAt(n) { var p = 0; for (var i = 0; i < TH.length; i++) if (n >= TH[i]) p = TH[i]; var last = TH[TH.length - 1]; if (n >= last) p = last + GAP * Math.floor((n - last) / GAP); return p; }
  // A free quote is worth the quote price at most (Shopflo's coupon is a flat amount): a dearer colour still pays the difference
  function payFor(units) { var s = units.slice().sort(function (a, b) { return a - b; }), free = freeCount(s.length), pay = 0; for (var i = 0; i < s.length; i++) pay += i < free ? Math.max(0, s[i] - UNIT) : s[i]; return pay; }
  function withMore(units, k) { var u = units.slice(); for (var i = 0; i < k; i++) u.push(UNIT); return u; }
  function freeState(cart) {
    var units = unitsOf(cart), n = units.length, list = 0; units.forEach(function (p) { list += p; });
    var pay = payFor(units), k = freeCount(n), destN = nextAt(n), toNext = destN - n, destPay = payFor(withMore(units, toNext)), from = prevAt(n);
    var atPoint = n > 0 && TH.indexOf(n) >= 0 || (n >= TH[TH.length - 1] && (n - TH[TH.length - 1]) % GAP === 0);
    var steps = [{ at: TH[0] - 1, v: fmt(UNIT * (TH[0] - 1)), l: (TH[0] - 1) + ' quotes' }];
    for (var m = 0; m < Math.max(3, TH.length); m++) { var at = m < TH.length ? TH[m] : TH[TH.length - 1] + GAP * (m - TH.length + 1); steps.push({ at: at, v: (m + 1) + ' FREE', l: at + ' for ' + fmt(UNIT * (at - m - 1)) + (codeFor(m + 1) ? '<br><code class="cc">' + esc(codeFor(m + 1)) + '</code>' : '') }); }
    var next = null; for (var i = 0; i < steps.length; i++) if (steps[i].at > n) { next = steps[i]; break; }
    // Short lines: the main one, and a small one right of the bar (the destination, or the next free quote)
    var V = vars({ n: n, pay: pay, list: list, k: k, more: toNext, next_n: destN, next_pay: destPay });
    var a, line, side, hot = false, celebrate = false;
    if (!n) { a = OFFER.title; line = bold(tx('empty_line', V)); side = tx('empty_side', V) + (CODES[0] ? ' · ' + CODES[0] : ''); }
    else if (atPoint) { celebrate = true; line = bold(tx('done', V)); side = tx('side_done', V); }
    else if (toNext === 1) { line = bold(tx('hot', V)); side = tx('side_next', V); hot = true; }
    else if (!k) { line = bold(tx('first', V)); side = tx('side_next', V); }
    else { line = bold(tx('mid', V)); side = tx('side_next', V); }
    if (n) a = tx(celebrate ? 'summary_done' : 'summary', V);
    var short = line.replace(/<\/?b>/g, '');
    return { n: n, list: list, pay: pay, saving: list - pay, free: k, steps: steps, next: next, a: a, line: line, side: side, after: '', short: short, pct: atPoint ? 100 : Math.round((n - from) / (destN - from) * 100), hot: hot, celebrate: celebrate };
  }
  function ord(n) { return n + (n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'); }
  function vars(x) { var t = function (i) { return TH[i] || TH[TH.length - 1] + GAP * (i - TH.length + 1); }; return { n: x.n, pay: fmt(x.pay), list: fmt(x.list), saved: fmt(x.list - x.pay), k: x.k, more: x.more, next_n: x.next_n, next_paid: x.next_n - freeCount(x.next_n), next_free: freeCount(x.next_n), next_pay: fmt(x.next_pay), every: EVERY, every_1: EVERY - 1, every2: EVERY * 2, every3: EVERY * 3, nth: ord(EVERY), t1: t(0), t1_1: t(0) - 1, t1_nth: ord(t(0)), t1_pay: fmt(UNIT * (t(0) - 1)), t2: t(1), t2_pay: fmt(UNIT * (t(1) - 2)), t3: t(2), t3_pay: fmt(UNIT * (t(2) - 3)), note: NOTE_SHORT, unit: fmt(UNIT), code: codeFor(x.k), next_code: codeFor(freeCount(x.next_n)), codes: CODES.join(' · '), coll: x.coll || '' }; }
  function tierState(cart) {
    var units = unitsOf(cart), n = units.length, list = 0; units.forEach(function (p) { list += p; });
    var steps = [{ at: 1, v: fmt(UNIT), l: '1 piece' }].concat(TIERS.map(function (s) { return { at: s.at, v: s.label, l: s.at + ' pieces' }; }));
    var next = null; for (var i = 0; i < steps.length; i++) if (steps[i].at > n) { next = steps[i]; break; }
    var tier = null; for (var j = TIERS.length - 1; j >= 0; j--) if (n >= TIERS[j].at) { tier = TIERS[j]; break; }
    var pay = tier ? (tier.pct ? Math.round(list * (100 - tier.pct) / 100) : list - tier.off) : list;
    var line, short, a = n ? fmt(pay) : OFFER.title;
    if (n === 0) { line = TIERS.map(function (s) { return s.label + ' at ' + s.at; }).join(' · '); short = TIERS[0] ? TIERS[0].label + ' at ' + TIERS[0].at : ''; }
    else if (!next) { line = '<b>' + tier.label + ' applied.</b> You are set.'; short = tier.label + ' applied'; }
    else if (!tier) { var first = TIERS[0]; line = 'Add ' + (first.at - n) + ' more, <b>' + (first.off ? 'next piece at ₹' + (UNIT - first.off) : first.label) + '</b>'; short = first.off ? 'Next piece at ₹' + (UNIT - first.off) : first.label + ' at ' + first.at; }
    else { line = '<b>' + tier.label + ' applied</b> · ' + (next.at - n) + ' more for ' + next.v; short = tier.label + ' applied · ' + (next.at - n) + ' more for ' + next.v; }
    var maxAt = TIERS.length ? TIERS[TIERS.length - 1].at : 6;
    if (n) a = tx('summary', vars({ n: n, pay: pay, list: list, k: 0, more: 0, next_n: 0, next_pay: 0 }));
    return { n: n, list: list, pay: pay, saving: Math.max(0, list - pay), steps: steps, next: next, tier: tier, a: a, line: line, side: n ? '' : OFFER.note || '', after: '', short: short, pct: Math.min(100, n / maxAt * 100), hot: false, celebrate: false };
  }
  function ladderState(cart) { return TIERS.length ? tierState(cart) : freeState(cart); }
  function ladderHtml(S) {
    return '<div class="nts-ladder">' + S.steps.map(function (s) { return '<div class="st' + (S.n >= s.at ? ' done' : '') + (S.next && S.next.at === s.at ? ' next' : '') + '"><b>' + s.v + '</b>' + s.l + '</div>'; }).join('') + '</div>';
  }
  function offerRules() {
    if (TIERS.length) return TIERS.map(function (s) { return '<li>' + s.at + ' pieces · <b>' + s.label + '</b></li>'; }).join('');
    var V = vars({ n: 0, pay: 0, list: 0, k: 0, more: 0, next_n: 0, next_pay: 0 });
    return ['rule1', 'rule2', 'rule3'].filter(function (k) { return CODES.length || (TX[k].indexOf('{code') < 0); }).map(function (k) { return '<li>' + chips(bold(tx(k, V))) + '</li>'; }).join('') + (OFFER.note ? '<li>' + esc(OFFER.note) + '</li>' : '');
  }
  var _cart = { item_count: 0, items: [], total_price: 0 };
  function readCart() { return fetch('/cart.js').then(function (r) { return r.json(); }).then(function (c) { _cart = c; return c; }).catch(function () { return _cart; }); }

  /* ── DOM shell ───────────────────────────────────────────── */
  var root = document.createElement('div'); root.id = 'ntSheetRoot';
  root.innerHTML =
    '<div class="nts-dock" id="ntsDock"><div class="nts-strip" id="ntsStrip" role="button" tabindex="0" aria-label="Your offer"><div class="a" id="ntsStripA"></div><div class="b" id="ntsStripB"></div><div class="br"><div class="bar"><i id="ntsStripBar"></i></div><span class="pp" id="ntsStripPP"></span></div><span class="chev" aria-hidden="true"></span></div><button class="nts-cart" id="ntsCart" type="button">🛒 Cart<small id="ntsCartN"></small></button></div>' +
    '<div class="nts-dim" id="ntsDim"></div>' +
    '<div class="nts-sheet" id="ntsSheet" role="dialog" aria-label="Offers"><div class="nts-grab"></div>' +
    '<div class="nts-head"><div class="nts-mini" id="ntsMini"></div><div><div class="t" id="ntsT"></div><div class="s" id="ntsS"></div></div><button class="nts-x" id="ntsX" aria-label="Close">✕</button></div>' +
    '<div class="nts-body"><div class="nts-offers" id="ntsOffers"></div><div class="nts-tabs" id="ntsTabs"></div><div class="nts-lead" id="ntsLead"></div><div class="nts-row" id="ntsRow"></div></div>' +
    '<div class="nts-foot"><div class="nts-strip"><div class="a" id="ntsFootA"></div><div class="b" id="ntsFootB"></div></div><button class="nts-cart" id="ntsCart2" type="button">🛒 Cart<small id="ntsCartN2"></small></button></div></div>';
  document.body.appendChild(root);
  var $ = function (id) { return document.getElementById(id); };
  var cur = null, tab = 0, tabs = [];

  // Layout rules for the strip live here too, so a theme that only took the new script still renders it right
  var css = document.createElement('style'); css.textContent =
    '.cc{display:inline-block!important;width:auto!important;max-width:none!important;margin:0 0 0 2px!important;vertical-align:baseline;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:800;letter-spacing:.08em;background:#fff3cc!important;color:#3a2b1d!important;border:1.5px dashed #d4a017;border-radius:6px;padding:0 6px!important;font-size:1em;line-height:1.35;white-space:nowrap;box-shadow:none}#ntSheetRoot .nts-strip .pp .cc{font-size:1.1em}#ntsPdp .nts-fest .n.c{background:transparent;padding:0}#ntsPdp .nts-fest .n.c .cc{font-size:11px}.nts-ladder .st .cc{font-size:10px;padding:0 5px;margin-top:3px;display:inline-block}' +
    '#ntSheetRoot .nts-strip{position:relative;padding-right:30px}#ntSheetRoot .nts-strip .a{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#ntSheetRoot .nts-strip .a.has-cc{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#ntSheetRoot .nts-strip .a .cc{font-size:.95em;padding:0 5px!important}#ntSheetRoot .nts-strip .b{font-size:13px;font-weight:500;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#ntSheetRoot .nts-strip .b b{color:#f5c99a;font-weight:800}' +
    '#ntSheetRoot .nts-cart.added{background:#2e8b57;box-shadow:0 8px 20px rgba(46,139,87,.4)}#ntSheetRoot .nts-cart.bump{animation:ntsBump .5s cubic-bezier(.34,1.56,.64,1) 1}@keyframes ntsBump{0%{transform:scale(1)}40%{transform:scale(1.12)}100%{transform:scale(1)}}' +
    '#ntSheetRoot .nts-strip .br{display:flex;align-items:center;gap:8px;margin-top:6px}#ntSheetRoot .nts-strip .bar{flex:1;height:4px;border-radius:2px;background:rgba(255,255,255,.2);overflow:hidden;margin:0}#ntSheetRoot .nts-strip .bar i{display:block;height:100%;background:#f5c99a;width:0;transition:width .4s,background .3s}' +
    '#ntSheetRoot .nts-strip .pp{flex:none;font-size:10.5px;font-weight:600;opacity:.8;white-space:nowrap;line-height:1}#ntSheetRoot .nts-strip .pp:empty{display:none}' +
    '#ntSheetRoot .nts-strip .chev{position:absolute;right:12px;top:50%;width:9px;height:9px;border-left:2px solid #f5c99a;border-top:2px solid #f5c99a;transform:translateY(-30%) rotate(45deg);opacity:.9}' +
    '.ph-price.nts-on{white-space:normal!important;flex-shrink:1!important;min-width:0;line-height:1.1}.ph-price.nts-on .nts-free{font-size:.9em}.ph-price.nts-on s{display:inline-block}.ph-price .nts-free{color:#2e8b57;font-weight:700}.ph-price .nts-free em{font-style:normal;font-family:var(--fb,"Nunito",sans-serif);font-size:.42em;font-weight:700;color:#2e8b57;background:#e6f4ea;border-radius:999px;padding:2px 8px;vertical-align:middle;margin-left:4px;white-space:nowrap;display:inline-block}.ph-price s{font-size:.6em;color:var(--muted,#9c8a76);font-weight:400;margin-right:6px}' +
    '.pcard .nts-line{display:block;font-family:var(--fb,"Nunito",sans-serif);font-size:10.5px;font-weight:700;color:var(--accent,#d4541f);line-height:1.2;margin-top:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.pcard .pp s{font-weight:400;color:var(--muted,#9c8a76)}.pcard .pp .nts-free{color:#2e8b57;font-weight:700}' +
    '#ntSheetRoot .nts-strip.hot .b{color:#ffb27a;font-weight:700}#ntSheetRoot .nts-strip.hot .bar i{background:var(--accent,#d4541f)}#ntSheetRoot .nts-strip.pulse{animation:ntsPulse .9s ease-out 1}@keyframes ntsPulse{0%{box-shadow:0 8px 20px rgba(58,43,29,.3)}35%{box-shadow:0 0 0 6px rgba(212,84,31,.45),0 8px 20px rgba(58,43,29,.3)}100%{box-shadow:0 8px 20px rgba(58,43,29,.3)}}' +
    'html.nts-gul-off .nt-cgfab,html.nts-gul-off .callgul{display:none!important}' +
    '#ntSheetRoot .nts-dock.behind{opacity:0!important;pointer-events:none!important}#ntSheetRoot .nts-dock.empty .nts-cart,#ntSheetRoot .nts-sheet.offers.empty .nts-foot .nts-cart{display:none}#ntSheetRoot .nts-dock.empty .nts-strip .a{font-size:12px;font-weight:800;opacity:1}#ntSheetRoot .nts-dock{transition:transform .3s,opacity .3s,left .25s,bottom .25s}' +
    '#ntSheetRoot .nts-offers{display:none;padding:10px 16px 14px}#ntSheetRoot .nts-sheet.offers .nts-offers{display:block}#ntSheetRoot .nts-sheet.offers .nts-tabs,#ntSheetRoot .nts-sheet.offers .nts-lead,#ntSheetRoot .nts-sheet.offers .nts-row{display:none}' +
    '#ntSheetRoot .nts-foot .nts-strip .b small{display:block;font-size:11px;font-weight:600;opacity:.8}#ntSheetRoot .nts-foot .nts-strip{padding-right:12px}#ntSheetRoot .nts-foot .nts-strip .chev{display:none}' +
    '#ntSheetRoot .nts-rules{list-style:none;margin:12px 0 0;padding:0;font-size:13px;color:var(--ink2,#6f5b46);line-height:1.5}#ntSheetRoot .nts-rules li{padding:4px 0 4px 18px;position:relative}#ntSheetRoot .nts-rules li::before{content:"";position:absolute;left:4px;top:11px;width:6px;height:6px;border-radius:50%;background:var(--accent,#d4541f)}#ntSheetRoot .nts-rules b{color:var(--ink,#3a2b1d)}' +
    '#ntsPdp .nts-fest{margin:10px 0 -4px;border-radius:12px;padding:10px 14px;color:#fff;background:radial-gradient(ellipse 80% 120% at 100% 0%,rgba(255,220,150,.35) 0%,transparent 60%),linear-gradient(100deg,#b8431a 0%,var(--accent,#d4541f) 55%,#e8873f 100%);box-shadow:0 8px 20px -10px rgba(212,84,31,.6);position:relative;overflow:hidden}#ntsPdp .nts-fest::after{content:"";position:absolute;inset:0;background:repeating-linear-gradient(135deg,rgba(255,255,255,.06) 0 6px,transparent 6px 14px);pointer-events:none}#ntsPdp .nts-fest .t{font-family:var(--ff,Georgia,serif);font-weight:700;font-size:16px;letter-spacing:.01em;line-height:1.2}#ntsPdp .nts-fest .s{font-size:12.5px;margin-top:3px;opacity:.95;font-weight:500}#ntsPdp .nts-fest .s b{color:#ffe3a3;font-weight:800}#ntsPdp .nts-fest .n{display:inline-block;margin-left:6px;padding:1px 8px;border-radius:999px;background:rgba(255,255,255,.18);font-size:11px;font-weight:700}#ntsPdp .nts-fest .n.c{background:#fff;color:var(--accent,#d4541f);letter-spacing:.06em}' +
    '#ntsPdp .nts-also .h{margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;gap:8px}#ntsPdp .nts-also .h .tag{text-transform:none;letter-spacing:0;font-size:12px;font-weight:800;color:var(--accent,#d4541f);text-decoration:none;white-space:nowrap}#ntsPdp .nts-arow{display:flex;gap:10px;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;margin:0 -10px;padding:0 10px 4px}#ntsPdp .nts-arow::-webkit-scrollbar{display:none}' +
    '#ntsPdp .nts-ac{flex:none;width:138px;scroll-snap-align:start;border:1px solid var(--line,#e9ddca);border-radius:12px;padding:0 7px 7px;background:#fff;position:relative;overflow:hidden}#ntsPdp .nts-ac .im{display:block;aspect-ratio:1;margin:0 -7px 0;border-radius:0;overflow:hidden;background:#ece2d2}#ntsPdp .nts-ac .sim{position:absolute;top:6px;left:6px;background:rgba(58,43,29,.78);color:#fff;font-size:10px;font-weight:700;letter-spacing:.03em;padding:2px 7px;border-radius:999px;text-decoration:none;line-height:1.4;backdrop-filter:blur(2px)}#ntsPdp .nts-ac .sim:hover{background:var(--accent,#d4541f)}#ntsPdp .nts-ac .im img{width:100%;height:100%;object-fit:cover;display:block}' +
    '#ntsPdp .nts-ac .nm{font-family:var(--ff,Georgia,serif);font-weight:600;font-size:12.5px;line-height:1.2;margin:6px 0 4px;height:2.4em;overflow:hidden}#ntsPdp .nts-ac .cs{display:flex;gap:4px;height:14px;overflow:hidden;margin-bottom:5px}#ntsPdp .nts-ac .cs span{width:12px;height:12px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 0 1px var(--line,#e9ddca);cursor:pointer;flex:none}#ntsPdp .nts-ac .cs span.on{box-shadow:0 0 0 2px var(--ink,#3a2b1d)}' +
    '#ntsPdp .nts-ac .pr{font-size:13px;font-weight:800}#ntsPdp .nts-ac .pr em{font-style:normal;color:#2e8b57}#ntsPdp .nts-ac .pr s{color:var(--muted,#9c8a76);font-weight:600;margin-left:4px;font-size:11px}#ntsPdp .nts-ac .add{margin-top:6px;width:100%;border:0;background:var(--accent,#d4541f);color:#fff;border-radius:8px;padding:7px 4px;font:inherit;font-weight:800;font-size:12px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#ntsPdp .nts-ac .add.in{background:#2e8b57}#ntsPdp .nts-ac.all{display:grid;place-items:center;text-align:center;font-weight:800;font-size:13px;color:var(--ink2,#6f5b46);border-style:dashed;background:transparent;text-decoration:none;line-height:1.4}' +
    '#ntSheetRoot .nts-mini .gift{display:grid;place-items:center;width:100%;height:100%;font-size:22px;background:#fbe9d7}#ntSheetRoot .nts-ladder{grid-template-columns:repeat(auto-fit,minmax(56px,1fr))}' +
    '#ntSheetRoot .nts-strip.sale{background:linear-gradient(100deg,#c1001a 0%,#e8192c 55%,#ff5a3c 100%);padding:8px 30px 8px 12px;animation:ntsGlow 1.1s ease-in-out infinite}@keyframes ntsGlow{0%,100%{box-shadow:0 8px 20px rgba(58,43,29,.3),0 0 0 0 rgba(232,25,44,.65)}60%{box-shadow:0 8px 20px rgba(58,43,29,.3),0 0 0 8px rgba(232,25,44,0)}}#ntSheetRoot .nts-strip.sale .a{color:#fff2a8;font-weight:900;opacity:1;font-size:10.5px;letter-spacing:.07em;text-transform:uppercase;white-space:normal;overflow:visible;line-height:1.2}#ntSheetRoot .nts-strip.sale .b{display:flex;flex-direction:column;gap:4px;margin-top:4px;white-space:normal;line-height:1}#ntSheetRoot .nts-strip.sale .row{display:flex;align-items:center;gap:10px}#ntSheetRoot .nts-strip.sale .clk{display:inline-flex;align-items:center;gap:2px;flex:none}#ntSheetRoot .nts-strip.sale .clk b{display:inline-block;min-width:2ch;text-align:center;font-size:24px;font-weight:900;color:#fff;background:#1a0608;border-radius:7px;padding:5px 6px;font-variant-numeric:tabular-nums;line-height:1;letter-spacing:.02em;box-shadow:inset 0 -2px 0 rgba(255,255,255,.08)}#ntSheetRoot .nts-strip.sale .clk b[data-s]{animation:ntsSec 1s steps(1) infinite}@keyframes ntsSec{0%{background:#5a0a12;color:#fff2a8}50%{background:#1a0608;color:#fff}}#ntSheetRoot .nts-strip.sale .clk i{font-style:normal;font-weight:900;font-size:20px;color:#fff;line-height:1;margin:0 1px;animation:ntsColon 1s steps(1) infinite}@keyframes ntsColon{50%{opacity:.35}}#ntSheetRoot .nts-strip.sale .of{color:#fff;font-size:16px;font-weight:900;line-height:1.1;min-width:0}#ntSheetRoot .nts-strip.sale .hurry{display:block;color:#fff;font-size:11px;font-weight:700;opacity:.95;line-height:1.2}#ntSheetRoot .nts-strip.sale .br{display:none}#ntSheetRoot .nts-strip.sale .chev{border-color:#fff}#ntSheetRoot .nts-strip.sale.hot{animation-duration:.6s}#ntSheetRoot .nts-strip.sale.hot .clk b{background:#fff;color:#c1001a}#ntSheetRoot .nts-strip.sale.hot .clk b[data-s]{animation:none}' +
    '#ntsPdp .nts-fest.sale .n{font-variant-numeric:tabular-nums}';
  root.appendChild(css);
  var _lastN = -1;
  function paintStrip() {
    var S = ladderState(_cart), st = $('ntsDock'), bar = $('ntsStripBar');
    var total = _cart.item_count || 0;
    $('ntsCartN').textContent = total + ' item' + (total === 1 ? '' : 's');
    st.classList.toggle('empty', !S.n); $('ntsSheet').classList.toggle('empty', !total);
    if (saleNow) { paintSale(total); return; }
    $('ntsStrip').classList.remove('sale');
    if (!S.n && !offerLive) { st.classList.remove('on'); _lastN = 0; return; }
    if (S.n && !cur) cur = lastHandle();
    st.classList.add('on');
    $('ntsStripA').innerHTML = chips(esc(S.n ? S.a : '🎁 ' + S.a)); $('ntsStripPP').innerHTML = chips(esc(S.side || ''));
    // One line only: when the top line with a coupon chip does not fit, drop its "N in cart ·" start
    var A = $('ntsStripA'); A.classList.toggle('has-cc', A.querySelector('.cc') != null);
    if (A.querySelector('.cc') && A.scrollWidth > A.clientWidth + 1) A.innerHTML = A.innerHTML.replace(/^\s*\d+ in cart\s*·\s*/, '');
    bar.style.width = S.pct + '%';
    // 2, 5, 8: the bar turns terracotta and the pill pulses once; 3, 6, 9: a short celebration pulse
    var changed = S.n !== _lastN; _lastN = S.n;
    $('ntsStrip').classList.toggle('hot', !!S.hot);
    if ((S.hot || S.celebrate) && changed) { $('ntsStrip').classList.remove('pulse'); void $('ntsStrip').offsetWidth; $('ntsStrip').classList.add('pulse'); }
    $('ntsStripB').innerHTML = S.line;
    $('ntsFootA').innerHTML = chips(esc(S.n ? S.a : OFFER.title));
    $('ntsFootB').innerHTML = S.line + (S.side ? ' <small>' + chips(esc(S.side)) + '</small>' : ''); $('ntsCartN2').textContent = $('ntsCartN').textContent;
    $('ntsS').textContent = S.saving > 0 ? 'You saved ' + fmt(S.saving) + ' · ' + S.short : S.short;
    if ($('ntsSheet').classList.contains('offers')) renderOffers(S);
    if (document.getElementById('ntsPdp')) renderPdp();
    decorateCards();
  }
  // The strip as the sale timer: the day line and clock on top, the flat offer below, the cart count at the side
  function paintSale(total) {
    var s = saleState();
    if (!s) { saleNow = null; offerLive = !OFFER.ends || new Date().toISOString().slice(0, 10) <= OFFER.ends; paintStrip(); return; }
    var st = $('ntsDock'), strip = $('ntsStrip');
    st.classList.add('on'); st.classList.toggle('empty', !total); strip.classList.add('sale'); strip.classList.toggle('hot', !!s.urgent); strip.classList.remove('pulse');
    // three lines: the sale's name and day on top, the ticking clock as the hero with the offer beside it, the hurry line below
    var a = '\uD83D\uDD25 ' + s.day;
    var parts = s.clock.split(':');
    var html = '<span class="row"><span class="clk"><b data-h>' + parts[0] + '</b><i>:</i><b data-m>' + parts[1] + '</b><i>:</i><b data-s>' + parts[2] + '</b></span><span class="of">' + esc(SALE.title || 'Pick any at \u20b9399') + '</span></span>' + (SALE.sub ? '<small class="hurry">' + esc(SALE.sub) + '</small>' : '');
    var B = $('ntsStripB'), FB = $('ntsFootB');
    var setClock = function (el) { if (!el.querySelector('.clk')) { el.innerHTML = html; return; } el.querySelector('[data-h]').textContent = parts[0]; el.querySelector('[data-m]').textContent = parts[1]; el.querySelector('[data-s]').textContent = parts[2]; };
    if ($('ntsStripA').textContent !== a) $('ntsStripA').textContent = a;
    setClock(B);
    $('ntsStripPP').textContent = '';
    $('ntsStripBar').style.width = '0';
    $('ntsFootA').textContent = a; setClock(FB);
    $('ntsCartN2').textContent = $('ntsCartN').textContent;
    $('ntsS').textContent = SALE.title || '';
    var fc = document.getElementById('ntsFestClock'); if (fc) fc.textContent = s.day + ' \u00b7 ' + s.clock;
    if (document.getElementById('ntsPdp')) renderPdp();
    decorateCards();
  }
  if (SALE) setInterval(function () { if (saleState()) { saleNow = saleNow || saleState(); paintStrip(); } else if (saleNow) paintStrip(); }, 1000);
  function lastHandle() { var h = ss.get('nts_last'); if (h && CAT[h] && PICKS[h]) return h; var items = _cart.items || []; for (var i = 0; i < items.length; i++) if (CAT[items[i].handle] && PICKS[items[i].handle]) return items[i].handle; return D.generic && CAT[D.generic] ? D.generic : null; }
  window.ntSheetDebug = function () { console.log('NT_SHEET v' + D.v, Object.keys(CAT).length + ' designs', 'cart:', (_cart.items || []).map(function (i) { return i.handle + (CAT[i.handle] ? ' ✓' : ' ✗ not in data'); }), 'generic:', D.generic); };

  function tabsFor(h) {
    var c = CAT[h] || {}, P = PICKS[h] || {};
    var all = { pairs: { l: 'Pairs well', lead: 'People who bought <b>' + esc(c.t) + '</b> also took these home.' }, home: { l: 'For your home', lead: 'One for another corner of the house?' }, gift: { l: 'For gifting', lead: 'Someone you would gift this to?' }, self: { l: 'One for you', lead: c.gift ? 'And something for you?' : 'More in the same mood.' } };
    var order = c.gift ? ['pairs', 'self', 'home', 'gift'] : ['pairs', 'home', 'gift', 'self'];
    if (c.gift) all.self.l = 'One for you';
    if (c.gift) all.gift.l = 'Another gift';
    return order.filter(function (k) { return (P[k] || []).filter(function (x) { return CAT[x]; }).length; }).map(function (k) { return { k: k, l: all[k].l, lead: all[k].lead, items: P[k].filter(function (x) { return CAT[x]; }).slice(0, 4) }; });
  }
  function nextPrice(h, base) { var S = ladderState(_cart); base = base || CAT[h].p; if (TIERS.length) { if (S.n === 1 && TIERS[0].off && base < 999) return base - TIERS[0].off; return base; } return (S.n + 1) % EVERY === 0 ? 0 : base; }
  function renderTabs() {
    $('ntsTabs').innerHTML = tabs.map(function (t, i) { return '<button class="nts-tab' + (i === tab ? ' on' : '') + '" data-i="' + i + '">' + t.l + '</button>'; }).join('');
    renderRow();
  }
  var pick = {};
  function renderRow() {
    var t = tabs[tab]; if (!t) return;
    $('ntsLead').innerHTML = t.lead;
    var inCart = {}; (_cart.items || []).forEach(function (it) { inCart[it.handle] = (inCart[it.handle] || 0) + it.quantity; });
    $('ntsRow').innerHTML = t.items.map(function (h) {
      var c = CAT[h], pi = pick[h] || 0, col = c.cols[pi] || c.cols[0] || { n: 'Standard', vid: 0, p: c.p }, base = col.p || c.p, np = nextPrice(h, base);
      var why = (WHY[cur] || {})[h] || '';
      return '<div class="nts-card" data-h="' + h + '">' +
        '<a class="im" href="/products/' + h + '">' + (c.img ? '<img src="' + esc(c.img) + '" alt="" loading="lazy">' : '') + '</a>' +
        '<div class="nm">' + esc(c.t) + '</div><div class="pf">' + esc(why) + '</div>' +
        (c.cols.length > 1 ? '<div class="cs">' + c.cols.map(function (cc, i) { return '<span class="' + (i === pi ? 'on' : '') + '" style="background:' + hexOf(cc) + '" title="' + esc(cc.n) + '" data-h="' + h + '" data-i="' + i + '"></span>'; }).join('') + '</div>' : '<div class="cs"></div>') +
        '<div class="pr">' + (np ? fmt(np) : 'FREE') + (np < base ? '<s>' + fmt(base) + '</s>' : '') + '</div>' +
        '<button class="add' + (inCart[h] ? ' in' : '') + '" data-h="' + h + '" data-vid="' + col.vid + '">' + (inCart[h] ? 'Added ✓  + 1 more' : '+ Add' + (c.cols.length > 1 ? ' · ' + esc(col.n) : '')) + '</button></div>';
    }).join('') + '<a class="nts-card all" href="' + (t.k === 'home' ? '/collections/all' : t.k === 'gift' ? '/collections/all' : t.k === 'pairs' ? '/pages/ask-nukkad' : '/collections/all') + '">See all →</a>';
  }

  function openSheet(h) {
    if (!CAT[h] || !PICKS[h]) { h = D.generic; if (!h || !CAT[h] || !PICKS[h]) { console.warn('[nt-sheet] no rows for this design; press Update website on the dashboard'); return false; } }
    cur = h; ss.set('nts_last', h); tab = 0; tabs = tabsFor(h); if (!tabs.length) return false;
    var c = CAT[h], inCart = (_cart.items || []).some(function (i) { return i.handle === h; });
    $('ntsT').textContent = inCart ? c.t + ' is in your cart' : 'One more piece?';
    $('ntsMini').innerHTML = c.img ? '<img src="' + esc(c.img) + '" alt="">' : '';
    $('ntsSheet').classList.remove('offers'); paintStrip(); renderTabs();
    $('ntsDim').classList.add('on'); $('ntsSheet').classList.add('on'); document.documentElement.classList.add('nts-lock'); $('ntsDock').classList.add('hide');
    return true;
  }
  // The offers drawer: what the strip opens. The ladder, the rules, and the cart button.
  function renderOffers(S) {
    $('ntsOffers').innerHTML = ladderHtml(S) + '<ul class="nts-rules">' + offerRules() + '</ul>';
  }
  function openOffers() {
    // in the sale the strip is a plain link to the sale collection: no ladder to explain
    if (saleNow) { window.location.href = SALE.link || '/collections/all'; return; }
    var S = ladderState(_cart);
    $('ntsT').textContent = OFFER.title; $('ntsMini').innerHTML = '<span class="gift">🎁</span>';
    $('ntsSheet').classList.add('offers'); renderOffers(S); paintStrip();
    $('ntsDim').classList.add('on'); $('ntsSheet').classList.add('on'); document.documentElement.classList.add('nts-lock'); $('ntsDock').classList.add('hide');
  }
  function closeSheet() { $('ntsDim').classList.remove('on'); $('ntsSheet').classList.remove('on'); document.documentElement.classList.remove('nts-lock'); $('ntsDock').classList.remove('hide'); }
  function openCart() {
    closeSheet(); _quiet = 0;
    var host = (typeof window.handleFloCartBtn === 'function') ? window : (window.parent && window.parent !== window && typeof window.parent.handleFloCartBtn === 'function') ? window.parent : null;
    if (host) return host.handleFloCartBtn();
    var icon = document.querySelector('[data-flo-cart-btn], .flo-cart-btn, a[href="/cart"], a[href*="/cart"], .header__icon--cart, #cart-icon-bubble');
    if (icon) icon.click(); else location.href = '/cart';
  }
  $('ntsCart').addEventListener('click', openCart); $('ntsCart2').addEventListener('click', openCart);
  $('ntsDim').addEventListener('click', closeSheet); $('ntsX').addEventListener('click', closeSheet);
  // The strip opens the offers drawer. The "one more piece" sheet stays reachable as window.ntSheetOpen for later.
  $('ntsStrip').addEventListener('click', openOffers);
  $('ntsStrip').addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openOffers(); } });
  window.ntSheetOpen = function (h) { return openSheet(h || cur || lastHandle()); };
  window.ntOffersOpen = openOffers;
  $('ntsTabs').addEventListener('click', function (e) { var b = e.target.closest('.nts-tab'); if (!b) return; tab = +b.getAttribute('data-i'); renderTabs(); });
  $('ntsRow').addEventListener('click', function (e) {
    var sw = e.target.closest('.cs span'); if (sw) { pick[sw.getAttribute('data-h')] = +sw.getAttribute('data-i'); renderRow(); return; }
    var b = e.target.closest('button.add'); if (!b) return;
    var h = b.getAttribute('data-h'), vid = +b.getAttribute('data-vid'); if (!vid) { location.href = '/products/' + h; return; }
    b.disabled = true; b.textContent = 'Adding…';
    _quiet = Date.now() + 3000;
    fetch('/cart/add.js', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [{ id: vid, quantity: 1, properties: { _from: 'sheet' } }] }) })
      .then(function (r) { return r.json(); }).then(function () { return readCart(); })
      .then(function () { paintStrip(); renderRow(); document.dispatchEvent(new CustomEvent('cart:refresh')); })
      .catch(function () { b.disabled = false; b.textContent = '+ Add'; });
  });

  /* ── product page: "people also buy" row + the ladder ─────── */
  function productHandle() { var m = location.pathname.match(/\/products\/([^/?#]+)/); return m ? m[1] : null; }
  // Designs bought with this one (published picks), topped up from the top seller's rows; ₹599 pieces only, since the cheapest one is the free one
  function alsoList(h) {
    var P = PICKS[h] || {}, G = PICKS[D.generic] || {}, out = [], seen = {}; seen[h] = 1;
    // No rows of its own but a collection: lead with that collection's designs from the catalogue
    if (!P.self && (CAT[h] || {}).cl) { var ch = CAT[h].cl.h, fromColl = []; for (var hk in CAT) if (hk !== h && CAT[hk].cl && CAT[hk].cl.h === ch) fromColl.push(hk); P = { self: fromColl, coll: CAT[h].cl }; }
    // A design in a highlighted collection leads with that collection (its "self" row), then what sold with it
    (P.coll ? [P.self, P.pairs, P.home, G.pairs, G.self, G.home] : [P.pairs, P.self, P.home, G.pairs, G.self, G.home]).forEach(function (l) { (l || []).forEach(function (x) { var c = CAT[x]; if (!c || seen[x] || !eligibleHandle(x) || c.p !== UNIT || !c.cols.length) return; seen[x] = 1; out.push(x); }); });
    return out.slice(0, 6);
  }
  function pageColour() { var r = document.querySelector('input[type=radio][name^="ntpb-opt-"]:checked'); return r ? String(r.value).toLowerCase() : ''; }
  function alsoHeader(S) { var r = S.n % EVERY, c = _pdp && (PICKS[_pdp.h] || {}).coll, V = vars({ n: S.n, pay: S.pay, list: S.list, k: 0, more: 0, next_n: 0, next_pay: 0, coll: c ? c.t : '' }); return TIERS.length || !S.n ? tx(c ? 'also_coll' : 'also_empty', V) : r === EVERY - 1 ? tx('also_hot', V) : r ? tx('also_first', V) : tx('also_done', V); }
  var _pdp = null;
  function renderAlso() {
    if (!_pdp || !$('ntsAlsoRow')) return;
    // Each card shows what adding it really costs: the cheapest piece in a full set goes free, so a dearer colour is not "free"
    var S = ladderState(_cart), units = unitsOf(_cart), pc = pageColour();
    var marginal = function (base) { return TIERS.length ? base : Math.max(0, payFor(units.concat([base])) - payFor(units)); };
    $('ntsAlsoH').innerHTML = '<span>' + esc(alsoHeader(S)) + '</span>';
    var inCart = {}; (_cart.items || []).forEach(function (it) { inCart[it.handle] = (inCart[it.handle] || 0) + it.quantity; });
    $('ntsAlsoRow').innerHTML = _pdp.list.map(function (x) {
      var c = CAT[x];
      if (_pdp.pick[x] == null) { var m = -1; c.cols.forEach(function (cc, i) { if (m < 0 && pc && String(cc.n).toLowerCase() === pc) m = i; }); _pdp.pick[x] = m < 0 ? 0 : m; }
      var col = c.cols[_pdp.pick[x]] || c.cols[0], base = col.p || c.p;
      // Each card links to its own collection through a small tag on the photo
      var sc = c.cl || (PICKS[x] || {}).coll;
      return '<div class="nts-ac" data-h="' + x + '"><a class="im" href="/products/' + x + '">' + (c.img ? '<img src="' + esc(c.img) + '" alt="" loading="lazy">' : '') + '</a>' + (sc ? '<a class="sim" href="' + esc(sc.u || '/collections/' + sc.h) + '" title="' + esc(sc.t) + '">' + esc(tx('sim_tag', { coll: sc.t })) + '</a>' : '') + '<div class="nm">' + esc(c.t) + '</div>' +
        (c.cols.length > 1 ? '<div class="cs">' + c.cols.map(function (cc, i) { return '<span class="' + (i === _pdp.pick[x] ? 'on' : '') + '" style="background:' + hexOf(cc) + '" title="' + esc(cc.n) + '" data-h="' + x + '" data-i="' + i + '"></span>'; }).join('') + '</div>' : '<div class="cs"></div>') +
        '<div class="pr">' + (function (m) { return m <= 0 ? '<em>FREE</em><s>' + fmt(base) + '</s>' : m < base ? '<em>' + fmt(m) + '</em><s>' + fmt(base) + '</s>' : fmt(base); })(marginal(base)) + '</div>' +
        '<button class="add' + (inCart[x] ? ' in' : '') + '" data-h="' + x + '" data-vid="' + col.vid + '">' + (inCart[x] ? 'Added ✓ · +1' : '+ Add' + (c.cols.length > 1 ? ' · ' + esc(col.n) : '')) + '</button></div>';
    }).join('');
  }
  // The page's own price: when adding this piece completes a set, strike the price and show FREE (or the difference for a dearer colour)
  var _pp = { html: null, base: null };
  function decoratePrice() {
    var el = document.querySelector('.ph-price'), h = productHandle(); if (!el || !h || TIERS.length || !offerLive) return;
    var base = el.innerHTML === _pp.html ? _pp.base : el.innerHTML;
    var tmp = document.createElement('span'); tmp.innerHTML = base; Array.prototype.forEach.call(tmp.querySelectorAll('s,small'), function (x) { x.parentNode.removeChild(x); });
    var m = tmp.textContent.match(/₹\s*([\d,]+)/), price = m ? +m[1].replace(/,/g, '') : 0;
    var small = (base.match(/<small[^>]*>[\s\S]*<\/small>/) || [""])[0];
    var ok = price && eligible({ handle: h, price: price * 100, original_price: price * 100, product_type: '' });
    var units = unitsOf(_cart), marginal = ok ? Math.max(0, payFor(units.concat([price])) - payFor(units)) : price;
    var html = !ok || marginal >= price ? base : '<s>' + fmt(price) + '</s> <span class="nts-free">' + (marginal <= 0 ? 'FREE' : fmt(marginal)) + ' <em>as your ' + ord(nextAt(units.length)) + '</em></span>' + small;
    if (el.innerHTML !== html) el.innerHTML = html;
    el.classList.toggle('nts-on', html !== base);
    _pp = { html: html, base: base };
  }
  function renderPdp() { var l = $('ntsPdpLadder'); if (l) l.innerHTML = ladderHtml(ladderState(_cart)); renderAlso(); decoratePrice(); }
  function mountProduct() {
    // Any product page gets the band and the ladder; the row needs the design in the data (its own rows, or borrowed ones)
    var h = productHandle(); if (!h) return;
    var form = document.querySelector('.ntpb-form') || document.querySelector('form[action*="/cart/add"]'); if (!form || document.getElementById('ntsPdp')) return;
    var box = document.createElement('div'); box.id = 'ntsPdp';
    var list = alsoList(h);
    // The offer first, then the pieces that complete it
    // A festive band above the offer: the offer title, its one-line promise and the small note
    var V0 = vars({ n: 0, pay: 0, list: 0, k: 0, more: 0, next_n: 0, next_pay: 0 });
    var band = saleNow ? '<div class="nts-fest sale"><div class="t">🔥 ' + esc(SALE.title || 'Pick any at ₹399') + '</div><div class="s">' + esc(SALE.sub || '') + ' <span class="n" id="ntsFestClock">' + esc(saleNow.day + ' · ' + saleNow.clock) + '</span></div></div>'
      : offerLive ? '<div class="nts-fest"><div class="t">✨ ' + esc(OFFER.title) + '</div><div class="s">' + (TIERS.length ? esc(TIERS.map(function (t) { return t.label + ' at ' + t.at; }).join(' · ')) : bold(tx('empty_line', V0)) + ' · ' + esc(tx('empty_side', V0))) + '' + (OFFER.note ? ' <span class="n">' + esc(OFFER.note) + '</span>' : '') + '</div></div>' : '';
    box.innerHTML = band + (saleNow ? '' : '<div class="nts-lbox"><div class="h">' + esc(TIERS.length ? 'Buy more, pay less' : tx('ladder_title', V0)) + '</div><div id="ntsPdpLadder"></div></div>') +
      (list.length ? '<div class="nts-lbox nts-also"><div class="h" id="ntsAlsoH"></div><div class="nts-arow" id="ntsAlsoRow"></div></div>' : '');
    form.insertAdjacentElement('afterend', box);
    _pdp = list.length ? { h: h, list: list, pick: {} } : null;
    renderPdp();
    // The theme rewrites the price on every colour change; follow it
    var pe = document.querySelector('.ph-price'); if (pe) { try { new MutationObserver(function () { decoratePrice(); }).observe(pe, { childList: true, subtree: true, characterData: true }); } catch (e) {} }
    // The page's colour changes: cards follow it again
    form.addEventListener('change', function (e) { if (_pdp && e.target && /^ntpb-opt-/.test(e.target.name || '')) { _pdp.pick = {}; renderAlso(); } });
    box.addEventListener('click', function (e) {
      var sw = e.target.closest('.cs span'); if (sw && _pdp) { _pdp.pick[sw.getAttribute('data-h')] = +sw.getAttribute('data-i'); renderAlso(); return; }
      var b = e.target.closest('button.add'); if (!b) return;
      var x = b.getAttribute('data-h'), vid = +b.getAttribute('data-vid'); if (!vid) { location.href = '/products/' + x; return; }
      b.disabled = true; b.textContent = 'Adding…';
      fetch('/cart/add.js', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [{ id: vid, quantity: 1, properties: { _from: 'pdp' } }] }) })
        .then(function (r) { if (!r.ok) throw new Error('add'); return readCart(); })
        .then(function () { renderPdp(); document.dispatchEvent(new CustomEvent('cart:refresh')); })
        .catch(function () { b.disabled = false; b.textContent = '+ Add'; });
    });
  }

  /* ── catch every Add to cart on the page ─────────────────── */
  var opens = +(ss.get('nts_opens') || 0), _quiet = 0;
  // Shopflo opens its cart after the theme's add; hold it back for the adds where the sheet opens instead
  var _floPatched = false;
  function patchFlo() {
    if (_floPatched || typeof window.handleFloCartBtn !== 'function') return;
    var orig = window.handleFloCartBtn; _floPatched = true;
    window.handleFloCartBtn = function () { if (Date.now() < _quiet) return; return orig.apply(this, arguments); };
  }
  var _fetch = window.fetch;
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var p = _fetch.apply(this, arguments);
    if (/\/cart\/add(\.js)?(\?|$)/.test(url)) {
      // Every Add to cart on the site lands in the strip, not in the cart drawer: hold Shopflo back for a moment
      holdCart();
      p.then(function (r) { if (!r.ok) return;
        r.clone().json().then(function (d) {
          var it = (d.items && d.items[0]) || d, h = it && it.handle;
          readCart().then(function () { if (h && CAT[h]) cur = h; paintStrip(); addedFx(); });
        }).catch(function () {});
      });
    } else if (/\/cart\/(change|update|clear)(\.js)?(\?|$)/.test(url)) {
      // Quantity changed or a line removed from the cart drawer: repaint once the call lands
      p.then(function () { setTimeout(function () { readCart().then(paintStrip); }, 150); }, function () {});
    }
    return p;
  };
  // Carts changed through XHR, or by a drawer that talks to its own API: watch the cart itself
  var _xo = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (m, url) {
    var u = String(url), add = /\/cart\/add/.test(u);
    if (add) holdCart();
    if (add || /\/cart\/(change|update|clear)/.test(u)) this.addEventListener('loadend', function () { setTimeout(function () { readCart().then(function () { paintStrip(); if (add) addedFx(); }); }, 150); });
    return _xo.apply(this, arguments);
  };
  function holdCart() { _quiet = Date.now() + 3000; patchFlo(); }
  // "Added" feedback on the dock: the strip pulses and the cart button bumps and reads Added for a moment
  var _fxT = null;
  function addedFx() {
    var st = $('ntsStrip'), cb = $('ntsCart');
    st.classList.remove('pulse'); cb.classList.remove('bump'); void st.offsetWidth; st.classList.add('pulse'); cb.classList.add('bump', 'added');
    cb.firstChild.textContent = '✓ Added';
    clearTimeout(_fxT); _fxT = setTimeout(function () { cb.classList.remove('bump', 'added'); cb.firstChild.textContent = '🛒 Cart'; }, 1800);
  }
  var _sig = '';
  function pollCart() { if (document.hidden) return; readCart().then(function (c) { var sig = c.item_count + ':' + c.total_price; if (sig !== _sig) { _sig = sig; paintStrip(); } }); }
  setInterval(pollCart, 4000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) pollCart(); });
  window.addEventListener('focus', pollCart); window.addEventListener('pageshow', pollCart);
  var t0 = setInterval(function () { patchFlo(); if (_floPatched) clearInterval(t0); }, 500); setTimeout(function () { clearInterval(t0); }, 15000);

  /* ── where the dock sits: clear of the bottom nav pill and the Call Gul button ── */
  function vis(sel) { var el = document.querySelector(sel); if (!el) return null; var cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return null; var r = el.getBoundingClientRect(); return r.width && r.height && r.top < window.innerHeight ? r : null; }
  // Full-screen layers of the theme (customiser slider, quick view, tutorial, Shopflo cart): the dock steps aside while they are open
  var OVERLAYS = '.nt-slider.open, .nt-backdrop.show, .nt-tut-overlay.open, .nt-sample-overlay.open, [class*="nt-qv"].open, #ntQV.open';
  function overlayOpen() { try { return !!document.querySelector(OVERLAYS) || document.body.classList.contains('overflow-hidden'); } catch (e) { return false; } }
  function placeDock() {
    var dock = $('ntsDock'), W = window.innerWidth, H = window.innerHeight, desk = W >= 760, dh = dock.offsetHeight || 56;
    dock.classList.toggle('behind', overlayOpen());
    var pill = vis('.nt-bnav-outer'), bars = [pill, vis('.bbar.show'), vis('#nt-bbar'), vis('#ntFloatBar')].filter(Boolean);
    var fabs = ['.nt-cgfab.show', '.callgul.show', '.nt-tut-card', '.nt-tut-bubble'].map(vis).filter(Boolean);
    var s = { left: '12px', right: '12px', bottom: '14px', width: '' }, bottom = 14;
    var raise = function (r) { bottom = Math.max(bottom, Math.ceil(H - r.top) + 10); };
    var overlaps = function (r, b) { return r.bottom > H - b - dh && r.top < H - b; };
    if (desk && pill) {
      // Stacked above the nav pill, centred on it
      bars.forEach(raise);
      s.left = Math.max(16, Math.min(W - 16 - 420, Math.round(pill.left + pill.width / 2 - 210))) + 'px'; s.right = 'auto'; s.width = '420px';
      fabs.forEach(function (r) { if (r.right > pill.left && r.left < pill.right && overlaps(r, bottom)) raise(r); });
    } else if (desk) {
      bars.forEach(raise); fabs.forEach(function (r) { if (r.left > W / 2 && overlaps(r, bottom)) raise(r); });
      s.left = 'auto'; s.right = '24px'; s.width = '420px';
    } else {
      // Phones: full width above the nav pill. The Call Gul button is hidden while the dock is up so the cart button always fits.
      bars.forEach(raise);
    }
    document.documentElement.classList.toggle('nts-gul-off', !desk && dock.classList.contains('on'));
    s.bottom = 'calc(' + bottom + 'px + env(safe-area-inset-bottom, 0px))';
    for (var k in s) if (dock.style[k] !== s[k]) dock.style[k] = s[k];
  }
  // Collection and grid cards: a small tag on the photo of every piece the offer covers (stock quotes at the quote price)
  function decorateCards() {
    if (!offerLive || TIERS.length) return;
    // Cards follow the cart: the price strikes through to FREE when this piece completes a set; before that, a quiet line says what is still needed
    var n = unitsOf(_cart).length, toNext = nextAt(n) - n, V = vars({ n: n, pay: 0, list: 0, k: 0, more: toNext, next_n: nextAt(n), next_pay: 0 }); V.more_1 = toNext - 1;
    var free = n > 0 && toNext === 1, line = !n ? tx('card_tag', V) : free ? '' : tx('card_tag_more', V), word = tx('card_tag_free', V);
    var cards = document.querySelectorAll('a.pcard');
    for (var i = 0; i < cards.length; i++) {
      var a = cards[i], pp = a.querySelector('.pp'), pb = a.querySelector('.pb'); if (!pp || !pb) continue;
      var m = (a.getAttribute('href') || '').match(/\/products\/([^/?#]+)/); if (!m || !eligibleHandle(m[1])) continue;
      if (pp.getAttribute('data-nts') == null) {
        var pm = (pp.textContent || '').match(/₹\s*([\d,]+)/), price = pm ? +pm[1].replace(/,/g, '') : (CAT[m[1]] || {}).p;
        if (!price || price !== UNIT) continue;
        pp.setAttribute('data-nts', pp.innerHTML);
      }
      var base = pp.getAttribute('data-nts');
      var want = free ? '<s>' + base + '</s> <span class="nts-free">' + esc(word) + '</span>' : base;
      if (pp.innerHTML !== want) pp.innerHTML = want;
      var old = a.querySelector('.nts-line');
      if (!line) { if (old) old.style.display = 'none'; continue; }
      if (old) { if (old.textContent !== line) old.textContent = line; old.style.display = ''; continue; }
      var d = document.createElement('div'); d.className = 'nts-line'; d.textContent = line;
      var pf = a.querySelector('.pf'); if (pf && pf.parentNode === pb) pf.insertAdjacentElement('afterend', d); else pb.appendChild(d);
    }
  }
  var _dc = null; function decorateSoon() { if (_dc) return; _dc = setTimeout(function () { _dc = null; decorateCards(); }, 150); }
  try { new MutationObserver(decorateSoon).observe(document.body, { childList: true, subtree: true }); } catch (e) {}
  decorateSoon();
  var _pl = null; function placeSoon() { if (_pl) return; _pl = requestAnimationFrame(function () { _pl = null; placeDock(); }); }
  window.addEventListener('resize', placeSoon); window.addEventListener('scroll', placeSoon, { passive: true });
  var pt = setInterval(placeSoon, 700); setTimeout(function () { clearInterval(pt); setInterval(placeSoon, 3000); }, 15000);
  try { new MutationObserver(placeSoon).observe(document.body, { attributes: true, attributeFilter: ['class'], subtree: true }); } catch (e) {}

  readCart().then(function () { paintStrip(); placeDock(); mountProduct(); setTimeout(mountProduct, 1500); setTimeout(mountProduct, 4000); });
  document.addEventListener('cart:refresh', function () { readCart().then(paintStrip); });
})();
