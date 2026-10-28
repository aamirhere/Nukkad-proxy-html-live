// Courier reconciliation core: parses the Bluedart invoice (pdf.js text items or a sheet), checks every line
// against the city rate × weight slabs, checks the weight audit file against our own piece weight, and checks
// a COD charge sheet against which orders were really COD. Pure functions: the page and the tests share them.
(function (root) {
  const round2 = n => Math.round(n * 100) / 100;
  const near = (a, b, tol = 0.02) => Math.abs(a - b) <= tol;
  const normCity = s => String(s || '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const toNum = v => { if (v == null || v === '') return null; const n = +String(v).replace(/[₹,\s]/g, ''); return isNaN(n) ? null : n; };
  const isoFromDmy = s => { const m = String(s || '').match(/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null; };
  const excelDate = v => { if (typeof v === 'number' && v > 20000 && v < 80000) { const d = new Date(Math.round((v - 25569) * 86400e3)); return d.toISOString().slice(0, 10); } const iso = isoFromDmy(v); if (iso) return iso; const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[0] : null; };

  // ---------- invoice PDF (pdf.js text items: {s, x, y} per page, page width) ----------
  const LINE_RE = /^(\d+)\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+(\(R\))?\s*(\d{8,14})\s+(.*?)\s*([A-Za-z]{2,6})\s+(\d+(?:\.\d+)?)\s+(-?[\d,]+\.\d{2})$/;
  function rowsFromItems(items) {
    const sorted = items.slice().sort((a, b) => b.y - a.y || a.x - b.x);
    const rows = []; let cur = null;
    for (const it of sorted) { if (!cur || Math.abs(it.y - cur.y) > 3) { cur = { y: it.y, items: [] }; rows.push(cur); } cur.items.push(it); }
    for (const r of rows) r.items.sort((a, b) => a.x - b.x);
    return rows;
  }
  function parseInvoicePdf(pages) {
    const out = { invoice_no: null, invoice_date: null, product: null, account: null, lines: [], totals: {}, pages: pages.length, unparsed: [] };
    const TOTAL_KEYS = [['freight', /^freight/i], ['idc', /^idc$/i], ['efss', /^efss$/i], ['fuel', /^fuel surcharge/i], ['caf', /^currency adjustment/i], ['net', /^net amount/i], ['cgst', /^cgst/i], ['sgst', /^sgst/i], ['igst', /^igst/i], ['grand', /^grand total/i], ['total', /^total$/i]];
    pages.forEach((page, pi) => {
      const mid = (page.width || 612) / 2;
      const rows = rowsFromItems(page.items);
      for (const row of rows) {
        const text = row.items.map(i => i.s).join(' ').replace(/\s+/g, ' ').trim();
        if (pi === 0 || !out.invoice_no) {
          let m = text.match(/Invoice No\.?\s*:?\s*([A-Z0-9]{8,})/i); if (m && !out.invoice_no) out.invoice_no = m[1];
          m = text.match(/Invoice Date\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i); if (m && !out.invoice_date) out.invoice_date = isoFromDmy(m[1]);
          m = text.match(/Customer A\/C\s*:?\s*([A-Z0-9]{6,})/i); if (m && !out.account) out.account = m[1];
          m = text.match(/Product\s*:?\s*([A-Za-z][A-Za-z ]{3,40}?)(?:\s+RCM|\s*$)/); if (m && !out.product) out.product = m[1].trim();
        }
        // totals block: label on the left, number further right on the same row
        const label = row.items[0] && row.items[0].s.trim(), nums = row.items.slice(1).map(i => i.s.trim()).filter(s => /^[\d,]+\.\d{2}$/.test(s));
        if (label && nums.length === 1) for (const [k, re] of TOTAL_KEYS) if (re.test(label) && out.totals[k] == null) { out.totals[k] = toNum(nums[0]); break; }
        // shipment rows: two tables side by side
        for (const half of [row.items.filter(i => i.x < mid), row.items.filter(i => i.x >= mid)]) {
          if (!half.length) continue;
          const t = half.map(i => i.s).join(' ').replace(/\s+/g, ' ').trim();
          const m = t.match(LINE_RE);
          if (m) out.lines.push({ sno: +m[1], date: isoFromDmy(m[2]), ret: !!m[3], awb: m[4], dest: normCity(m[5]), type: m[6], wt: +m[7], amount: toNum(m[8]), page: pi + 1 });
          else if (/\d{1,2}\/\d{1,2}\/\d{4}/.test(t) && /\d{8,}/.test(t) && !/Invoice|IRN/i.test(t)) out.unparsed.push({ page: pi + 1, text: t });
        }
      }
    });
    out.lines.sort((a, b) => a.sno - b.sno);
    if (out.totals.freight == null && out.totals.total != null) out.totals.freight = out.totals.total;
    out.totals.gst = (out.totals.cgst || 0) + (out.totals.sgst || 0) + (out.totals.igst || 0);
    out.totals.surcharges = (out.totals.idc || 0) + (out.totals.efss || 0) + (out.totals.fuel || 0) + (out.totals.caf || 0);
    return out;
  }

  // ---------- invoice from a sheet (any export with AWB / destination / weight / amount columns) ----------
  const findCol = (keys, ...res) => keys.find(k => res.some(re => re.test(k)));
  function parseInvoiceSheet(rows) {
    if (!rows.length) return { lines: [], totals: {}, unparsed: [] };
    const keys = Object.keys(rows[0]);
    const cAwb = findCol(keys, /awb|tracking|waybill/i), cDest = findCol(keys, /dest|city|station/i), cWt = findCol(keys, /chrg|charge|weight|wt/i), cAmt = findCol(keys, /amount|freight|billed|charges?$/i), cDate = findCol(keys, /ship.*date|pickup|date/i), cType = findCol(keys, /type|product/i);
    if (!cAwb || !cAmt) throw new Error('Could not find the AWB and amount columns in the sheet');
    const lines = [];
    rows.forEach((r, i) => {
      const raw = String(r[cAwb] || ''); const awb = raw.replace(/\D/g, ''); if (awb.length < 8) return;
      lines.push({ sno: i + 1, date: cDate ? excelDate(r[cDate]) : null, ret: /\(R\)|^R/i.test(raw.trim()) || /return|rto/i.test(String(r[cType] || '')), awb, dest: normCity(cDest ? r[cDest] : ''), type: cType ? String(r[cType] || '') : '', wt: cWt ? toNum(r[cWt]) || 0 : 0, amount: toNum(r[cAmt]) || 0 });
    });
    return { lines, totals: {}, unparsed: [], invoice_no: null };
  }

  // ---------- the rate check ----------
  const ISSUES = {
    ok: 'OK', fee50: 'Reverse-pickup fee (₹50) on a forward shipment', zone: 'Billed at a higher zone rate', oda: 'Add-on of ₹5 per slab — check', norate: 'No rate on file for this city', other: 'Amount does not match any rate — check', dup: 'AWB billed twice', under: 'Billed below rate (no action)', prepaid: 'COD fee on a prepaid order', dup_prepaid: 'Also billed on the prepaid invoice', codpct: 'COD fee charged as % of order value — verify value',
  };
  const DISPUTE = new Set(['fee50', 'zone', 'oda', 'other', 'dup', 'prepaid', 'dup_prepaid']);
  function tierFor(city, cfg) {
    if (!city) return null;
    const o = cfg.cities || {}, s = cfg.seed_cities || {};
    if (o[city]) return +o[city];
    if (s[city]) return +s[city];
    // invoice names get cut at ~16 chars; try the stored names that start the same way, or the first word
    const hit = Object.keys(o).find(k => k.startsWith(city) || city.startsWith(k)) || Object.keys(s).find(k => k.length >= 5 && (k.startsWith(city) || city.startsWith(k)));
    return hit ? +(o[hit] || s[hit]) : null;
  }
  // Add-ons (the ₹50, the ₹5, COD fees) carry GST but none of the percentage surcharges — the August invoices
  // show IDC, EFSS, fuel and CAF computed on base freight only. Base-freight errors carry everything.
  const GST_ONLY = new Set(['fee50', 'oda', 'prepaid']);
  function retotal(lines, summary) {
    const by = {};
    for (const l of lines) {
      const disp = DISPUTE.has(l.issue);
      l.impact = disp ? round2(l.extra * (GST_ONLY.has(l.issue) ? summary.gst_mult : summary.multiplier)) : 0;
      const b = (by[l.issue] ||= { issue: l.issue, label: ISSUES[l.issue], n: 0, extra: 0, impact: 0, gst_only: GST_ONLY.has(l.issue) });
      b.n++; if (disp) { b.extra = round2(b.extra + l.extra); b.impact = round2(b.impact + l.impact); }
    }
    const disputed = lines.filter(l => DISPUTE.has(l.issue));
    summary.by_issue = Object.values(by).sort((a, b) => b.impact - a.impact || b.n - a.n);
    summary.flagged = lines.filter(l => l.issue !== 'ok').length; summary.disputed = disputed.length;
    summary.extra = round2(disputed.reduce((s, l) => s + l.extra, 0));
    summary.extra_addon = round2(disputed.filter(l => GST_ONLY.has(l.issue)).reduce((s, l) => s + l.extra, 0));
    summary.extra_freight = round2(summary.extra - summary.extra_addon);
    summary.impact_addon = round2(disputed.filter(l => GST_ONLY.has(l.issue)).reduce((s, l) => s + l.impact, 0));
    summary.impact_freight = round2(disputed.filter(l => !GST_ONLY.has(l.issue)).reduce((s, l) => s + l.impact, 0));
    summary.impact = round2(summary.impact_addon + summary.impact_freight);
    return summary;
  }
  function checkInvoice(parsed, cfg, opts = {}) {
    const tiers = cfg.tiers, slab = cfg.slab_kg || 0.5, learned = {}, seen = {}, lines = [];
    // COD invoice: the COD fee rides on every forward line and is handed back on a return (RTO) line
    const codFee = opts.cod ? (+cfg.cod_fee || 30) : 0, codPct = opts.cod ? (+cfg.cod_pct || 0) / 100 : 0;
    const feeOf = L => opts.cod ? (L.ret ? -codFee : codFee) : 0;
    const baseTier = per => { for (const t of [1, 2, 3, 4, 5]) if (near(per, tiers[t])) return +t; return null; };
    const allowedR = new Set([0, +cfg.reverse_fee || 0, +cfg.rto_fee || 0, (+cfg.reverse_fee || 0) + (+cfg.rto_fee || 0)]);
    for (const L of parsed.lines) {
      const slabs = Math.max(1, Math.round(L.wt / slab)); const per = round2((L.amount - feeOf(L)) / slabs);
      let tier = tierFor(L.dest, cfg) || learned[L.dest] || null, note = '';
      if (!tier) { const t = baseTier(per) || (near(per - (cfg.oda_fee || 5), tiers[baseTier(per - (cfg.oda_fee || 5))] || -1) ? baseTier(per - (cfg.oda_fee || 5)) : null); if (t) { learned[L.dest] = t; tier = t; note = 'city rate learned from this invoice'; } }
      const base = tier ? tiers[tier] : null, expected = base != null ? round2(base * slabs + feeOf(L)) : null;
      const diff = expected != null ? round2(L.amount - expected) : null;
      let issue = 'ok', extra = 0;
      if (expected == null) issue = 'norate';
      else if (near(diff, 0)) issue = 'ok';
      else if (L.ret && [...allowedR].some(a => near(diff, a))) { issue = 'ok'; note = 'return with allowed fee ₹' + diff; }
      else if (near(diff, 50)) { issue = 'fee50'; extra = diff; }
      else if (near(diff, (cfg.oda_fee || 5) * slabs) || near(diff, cfg.oda_fee || 5)) { issue = 'oda'; extra = diff; }
      else if (diff < 0) issue = 'under';
      else if (opts.cod && !L.ret && codPct && diff > 0 && diff + codFee <= codPct * 12000) { issue = 'codpct'; note = `COD fee ₹${round2(diff + codFee)} = ${cfg.cod_pct}% of about ₹${Math.round((diff + codFee) / codPct)} order value`; }
      else { const bt = baseTier(per) || baseTier(per - 50); if (bt && bt !== tier) { issue = 'zone'; note = `billed at the ${cfg.tier_names ? cfg.tier_names[bt] : 'tier ' + bt} rate ₹${tiers[bt]}${baseTier(per) ? '' : ' + ₹50'} instead of ₹${base}`; } else issue = 'other'; extra = diff; }
      const legKey = L.awb + (L.ret ? ':R' : ':F');
      if (seen[legKey]) { issue = 'dup'; extra = Math.max(0, L.amount); note = `also billed as S.no ${seen[legKey]}`; } else seen[legKey] = L.sno;
      lines.push({ ...L, slabs, per, tier, base, expected, diff, issue, extra: round2(extra), note, fee: feeOf(L) || undefined });
    }
    const T = parsed.totals || {}; const freightSum = round2(lines.reduce((s, l) => s + l.amount, 0));
    const surchargePct = T.freight ? (T.surcharges || 0) / T.freight : (cfg.multiplier / 1.18 - 1);
    const gstPct = T.net ? (T.gst || 0) / T.net : 0.18;
    const multiplier = round2((1 + surchargePct) * (1 + gstPct) * 100) / 100, gst_mult = round2((1 + gstPct) * 100) / 100;
    const summary = {
      invoice_no: parsed.invoice_no, invoice_date: parsed.invoice_date, product: parsed.product, cod: !!opts.cod, cod_fee: codFee || undefined, cod_fees: opts.cod ? round2(lines.reduce((s, l) => s + (l.fee || 0), 0)) : undefined, lines: lines.length, returns: lines.filter(l => l.ret).length,
      freight_lines: freightSum, freight_invoice: T.freight ?? null, freight_match: T.freight == null ? null : near(freightSum, T.freight, 1), surcharges: T.surcharges ?? null, gst: T.gst ?? null, grand: T.grand ?? null,
      surcharge_pct: Math.round(surchargePct * 1000) / 10, multiplier, gst_mult,
      // anything in Net Amount that the summary page does not itemise (September carried a 5% PSS this way)
      unlisted: T.net != null && T.freight != null ? round2(T.net - T.freight - (T.surcharges || 0)) : null,
      base_freight: round2(lines.reduce((s, l) => s + (l.base != null ? l.base * l.slabs : 0), 0)),
      rates_of_base: (() => { const b = lines.reduce((s, l) => s + (l.base != null ? l.base * l.slabs : 0), 0); return b ? { idc: round2((T.idc || 0) / b * 100), efss: round2((T.efss || 0) / b * 100), fuel: round2((T.fuel || 0) / b * 100), caf: round2((T.caf || 0) / b * 100) } : null; })(),
      learned: Object.keys(learned).length, unparsed: (parsed.unparsed || []).length, tiers_used: lines.reduce((m, l) => { if (l.tier) m[l.tier] = (m[l.tier] || 0) + 1; return m; }, {}),
    };
    retotal(lines, summary);
    const flagged = lines.filter(l => l.issue !== 'ok');
    return { lines, flagged, summary, learned, labels: ISSUES };
  }
  // AWB ownership check (after a lookup): marks lines we never shipped
  function applyLookup(result, lookup, opts = {}) {
    const by = (lookup && lookup.by_awb) || {}; let unknown = 0, cod = 0;
    const other = new Set((opts.other_lines || []).map(l => l.awb));
    for (const l of result.lines) {
      const o = by[l.awb]; l.ours = !!o;
      if (o) { l.order = o.order_name; l.units = o.units; l.payment = o.payment; l.source = o.source; l.custom = !!o.custom; if (o.payment === 'cod') cod++; } else unknown++;
      if (opts.cod && !l.ret && o && o.payment && o.payment !== 'cod' && (l.issue === 'ok' || l.issue === 'codpct')) { l.issue = 'prepaid'; l.extra = round2(l.amount - (l.base || 0) * l.slabs); l.note = `${o.order_name} was ${o.payment}`; }
      else if (opts.cod && !l.ret && o && o.value > 0 && opts.cod_pct > 0 && l.base != null) {
        const fee = Math.max(+result.summary.cod_fee || 0, round2(o.value * opts.cod_pct / 100)), exp = round2(l.base * l.slabs + fee), d = round2(l.amount - exp);
        if (Math.abs(d) <= 0.02) { if (l.issue === 'codpct' || l.issue === 'other') { l.issue = 'ok'; l.extra = 0; l.note = fee > (+result.summary.cod_fee || 0) ? `COD fee ${opts.cod_pct}% of ₹${o.value}` : ''; } }
        else if (l.issue === 'codpct' || l.issue === 'ok') { l.issue = 'other'; l.extra = Math.max(0, d); l.note = `order value ₹${o.value}: COD fee should be ₹${fee}, line should be ₹${exp}`; }
        l.expected = exp; l.diff = d;
      }
      if (other.has(l.awb) && l.issue !== 'dup') { l.issue = 'dup_prepaid'; l.extra = l.amount; l.note = `AWB also on invoice ${opts.other_no || ''}`.trim(); }
    }
    result.summary.unknown_awb = unknown; result.summary.cod_lines = cod; result.summary.known_awb = result.lines.length - unknown;
    // re-total after the lookup moved lines between categories
    retotal(result.lines, result.summary);
    result.flagged = result.lines.filter(l => l.issue !== 'ok');
    return result;
  }

  // ---------- weight audit file ----------
  function checkAudit(rows, lookup, cfg) {
    if (!rows.length) throw new Error('The sheet is empty');
    const keys = Object.keys(rows[0]);
    const c = { awb: findCol(keys, /^awb|awbno|tracking/i), ref: findCol(keys, /crcrdref|custorderref|reference|order/i), preact: findCol(keys, /preactwt|declared|booked/i), applied: findCol(keys, /^billedwt/i) || findCol(keys, /audchargwt|charg/i), audact: findCol(keys, /audactwt/i), audvol: findCol(keys, /audvolwt/i), ln: findCol(keys, /^ln$|length/i), bd: findCol(keys, /^bd$|breadth|width/i), ht: findCol(keys, /^ht$|height/i), item: findCol(keys, /commodity|description|item/i), date: findCol(keys, /pickupdt|pickup|batchdt|batch/i) || keys.find(k => /date|dt$/i.test(k) && !/inv/i.test(k)), flag: findCol(keys, /corflg|reason/i), img: findCol(keys, /cloudurl|image|photo/i) };
    if (!c.awb || !c.applied) throw new Error('Could not find the AWB and charged-weight columns');
    const piece = +cfg.piece_kg || 0.38, slab = +cfg.slab_kg || 0.5, byAwb = (lookup && lookup.by_awb) || {}, byRef = (lookup && lookup.by_ref) || {};
    const slabsOf = kg => Math.ceil(kg / slab - 1e-9) * slab;
    const out = [];
    for (const r of rows) {
      const awb = String(r[c.awb] || '').replace(/\D/g, ''); if (!awb) continue;
      const ref = c.ref ? String(r[c.ref] || '').trim().replace(/^#/, '') : '';
      const declared = c.preact ? toNum(r[c.preact]) : null, applied = toNum(r[c.applied]) || 0;
      // Correct weight: our declared actual weight, rounded up to the slab; when we know the order, at least pieces × piece weight
      let units = null, basis, order = null, payment = null, custom = false;
      const o = byAwb[awb] || (ref && byRef[ref]);
      if (o && o.units) { units = o.units; order = o.order_name; payment = o.payment; custom = !!o.custom; }
      const fromOrder = units ? round2(units * piece) : 0, fromDeclared = declared != null && declared > 0 ? declared : 0;
      const ourKg = round2(Math.max(fromOrder, fromDeclared, piece));
      basis = fromOrder >= fromDeclared && units ? (byAwb[awb] ? 'our order (by AWB)' : 'our order (by order no.)') : fromDeclared ? 'declared weight' : 'assumed 1 piece';
      if (!units) units = Math.max(1, Math.floor(ourKg / piece + 0.1));
      const correct = slabsOf(ourKg), diff = round2(applied - correct);
      out.push({ awb, ref, date: c.date ? excelDate(r[c.date]) : null, item: c.item ? String(r[c.item] || '') : '', declared, audited_actual: c.audact ? toNum(r[c.audact]) : null, audited_vol: c.audvol ? toNum(r[c.audvol]) : null, dims: c.ln ? [r[c.ln], r[c.bd], r[c.ht]].filter(v => v !== '' && v != null).join(' × ') : '', flag: c.flag ? String(r[c.flag] || '') : '', img: c.img ? String(r[c.img] || '') : '', units, basis, order, payment, custom, our_kg: ourKg, applied, correct, diff, over: diff > 0.001, raw: r });
    }
    const over = out.filter(x => x.over), kgOver = round2(over.reduce((s, x) => s + x.diff, 0)), slabsOver = over.reduce((s, x) => s + Math.round(x.diff / slab), 0);
    const avg = +cfg.avg_rate || 40, mult = +cfg.multiplier || 2.1;
    const basis = {}; out.forEach(x => basis[x.basis] = (basis[x.basis] || 0) + 1);
    const summary = { rows: out.length, over: over.length, under: out.filter(x => x.diff < -0.001).length, exact: out.filter(x => !x.over && x.diff > -0.001).length, kg_over: kgOver, slabs_over: slabsOver, est_freight: round2(slabsOver * avg), est_impact: round2(slabsOver * avg * mult), basis, custom_over: over.filter(x => x.custom).length, dates: [...new Set(out.map(x => x.date).filter(Boolean))].sort() };
    return { rows: out, over, summary, columns: c };
  }

  // ---------- COD charges sheet ----------
  function checkCod(rows, lookup, cfg) {
    if (!rows.length) throw new Error('The sheet is empty');
    const keys = Object.keys(rows[0]);
    let cAwb = findCol(keys, /awb|tracking|waybill/i);
    if (!cAwb) cAwb = keys.find(k => rows.slice(0, 20).filter(r => /^\d{8,14}$/.test(String(r[k] || '').trim())).length >= 10);
    const cAmt = findCol(keys, /charge|fee/i) || findCol(keys, /cod.*amount|amount|amt/i) || keys.find(k => k !== cAwb && rows.slice(0, 20).every(r => toNum(r[k]) != null));
    const cVal = findCol(keys, /collect|cod.*value|declared|order.*value|amount collected/i), cDate = findCol(keys, /date|dt$/i);
    if (!cAwb || !cAmt) throw new Error('Could not find the AWB and charge columns');
    const fee = +cfg.cod_fee || 30, byAwb = (lookup && lookup.by_awb) || {}, seen = {}, out = [];
    rows.forEach((r, i) => {
      const awb = String(r[cAwb] || '').replace(/\D/g, ''); if (awb.length < 8) return;
      const amount = toNum(r[cAmt]) || 0, o = byAwb[awb];
      let issue = 'ok', extra = 0, note = '';
      if (seen[awb]) { issue = 'dup'; extra = amount; note = 'also on row ' + seen[awb]; }
      else if (o && o.payment && o.payment !== 'cod') { issue = 'prepaid'; extra = amount; note = `${o.order_name} was ${o.payment}`; }
      else if (!o) { issue = 'unknown'; note = 'AWB not in our shipments'; }
      else if (!near(amount, fee)) { issue = 'fee'; extra = round2(amount - fee); note = `charged ₹${amount}, agreed ₹${fee}`; }
      seen[awb] = seen[awb] || (i + 1);
      out.push({ row: i + 1, awb, date: cDate ? excelDate(r[cDate]) : null, amount, collected: cVal ? toNum(r[cVal]) : null, order: o && o.order_name, payment: o && o.payment, issue, extra, note });
    });
    const labels = { ok: 'OK', dup: 'AWB charged twice', prepaid: 'Charged on a prepaid order', unknown: 'AWB not in our shipments', fee: 'Fee differs from agreed rate' };
    const by = {}; out.forEach(l => { const b = (by[l.issue] ||= { issue: l.issue, label: labels[l.issue], n: 0, extra: 0 }); b.n++; b.extra = round2(b.extra + l.extra); });
    const flagged = out.filter(l => l.issue !== 'ok'), disputed = out.filter(l => ['dup', 'prepaid', 'fee'].includes(l.issue));
    const summary = { lines: out.length, total: round2(out.reduce((s, l) => s + l.amount, 0)), fee, flagged: flagged.length, disputed: disputed.length, extra: round2(disputed.reduce((s, l) => s + l.extra, 0)), by_issue: Object.values(by).sort((a, b) => b.extra - a.extra || b.n - a.n), unknown: by.unknown ? by.unknown.n : 0 };
    return { lines: out, flagged, summary, labels };
  }

  // ---------- Bluedart billing detail sheet (one row per AWB with every charge component) ----------
  const isBluedartDetail = rows => rows.length > 0 && 'CAWBNO' in rows[0] && 'NCHRGWT' in rows[0] && 'NFREIGHT' in rows[0];
  function parseBluedartDetail(rows) {
    const n = v => +v || 0;
    const lines = []; let invoice_no = null, invoice_date = null;
    rows.forEach((r, i) => {
      const awb = String(r.CAWBNO || '').replace(/\D/g, ''); if (awb.length < 8) return;
      if (!invoice_no && r.CINVOICENBR) invoice_no = String(r.CINVOICENBR).trim();
      if (!invoice_date && r.DINVDATE) invoice_date = excelDate(r.DINVDATE);
      const surch = n(r.PSS_CHARGE) + n(r.NFSAMT) + n(r.NCAFAMT) + n(r.NIDCCHGS) + n(r.EFSS_CHARGE);
      const other = ['NNFORMCHGS', 'NADDISRCHG', 'NAWBFEES', 'NDCCHRG', 'NDOCCHRG', 'NDODAMT', 'NDVCHARGE', 'NECCCHGS', 'NELRSKCHGS', 'NHVPCCHGS', 'NMISCCHG1', 'NODACHRG', 'NOWSPCHGS', 'NRISKHCHGS', 'NTDDCHRG', 'NVALCHGS'].reduce((s, k) => s + n(r[k]), 0);
      const dest = String(r.CDSTAREA || ''); const city = normCity(dest.includes('-') ? dest.slice(dest.indexOf('-') + 1) : dest);
      lines.push({ sno: i + 1, awb, ref: String(r.CCRCRDREF || '').trim(), date: excelDate(r.DBATCHDT), dest: city, dest_code: dest.split('-')[0], product: String(r.CPRODCODE || ''), cod_product: String(r.CPRODCODE || '') === 'AC', act_wt: n(r.NACTWGT), wt: n(r.NCHRGWT), decl_val: n(r.NDECLVAL), pcs: n(r.NPCS) || 1, freight: n(r.NFREIGHT), surch, surch_pct: n(r.NFREIGHT) ? surch / n(r.NFREIGHT) : 0, cod_fee: n(r.NFODCHRG), ras: n(r.NNEWRAS), topay: n(r.NTOPAYAMT), other, total: n(r.NTOTAMOUNT), gst: n(r.GST), grand: n(r['Gr  Total'] ?? r['Gr Total'] ?? r.GRTOTAL), pin: String(r.DESTPINCODE || ''), ret: n(r.NFODCHRG) < 0 });
    });
    const sum = k => round2(lines.reduce((s, l) => s + l[k], 0));
    return { kind: 'detail', invoice_no, invoice_date, product: 'Etail Air (billing detail)', lines, totals: { freight: sum('freight'), surcharges: sum('surch'), cod_fees: sum('cod_fee'), ras: sum('ras'), topay: sum('topay'), net: sum('total'), gst: sum('gst'), grand: sum('grand') }, unparsed: [] };
  }
  const DETAIL_ISSUES = { ok: 'OK', weight: 'Charged above our weight', fee50: '₹50 add-on (reverse-pickup fee) on a forward shipment', zone: 'Freight at a higher zone rate than the city', oda: 'Remote-area add-on ₹5 per slab — check', codfee: 'COD fee differs from ₹30 / % of declared value', prepaid: 'COD fee on an order that was prepaid', norate: 'No rate on file for this city', other: 'Other charge on the line — check', dup: 'AWB billed twice' };
  const DETAIL_ADDON = new Set(['fee50', 'oda', 'codfee', 'prepaid', 'other']);
  function checkDetail(parsed, cfg, lookup) {
    const tiers = cfg.tiers, slab = +cfg.slab_kg || 0.5, piece = +cfg.piece_kg || 0.38, codFee = +cfg.cod_fee || 30, codPct = (+cfg.cod_pct || 0) / 100;
    const by = (lookup && lookup.by_awb) || {}, byRef = (lookup && lookup.by_ref) || {};
    const baseTier = per => { for (const t of [1, 2, 3, 4, 5]) if (near(per, tiers[t])) return +t; return null; };
    const slabUp = kg => Math.ceil(kg / slab - 1e-9) * slab;
    const learned = {}, seen = {};
    for (const L of parsed.lines) {
      const o = by[L.awb] || (L.ref && byRef[L.ref.replace(/^#/, '')]);
      L.ours = !!o; if (o) { L.order = o.order_name; L.units = o.units; L.payment = o.payment; L.source = o.source; L.custom = !!o.custom; L.value = o.value; }
      const slabs = Math.max(1, Math.round(L.wt / slab)); const per = round2(L.freight / slabs);
      const billedTier = baseTier(per);
      let tier = tierFor(L.dest, cfg) || learned[L.dest] || null;
      if (!tier && billedTier) { learned[L.dest] = billedTier; tier = billedTier; }
      const rate = tier ? tiers[tier] : (billedTier ? tiers[billedTier] : per);
      // our weight: pieces we shipped × piece weight, never below Bluedart's own actual weight, up to the slab
      const ourKg = Math.max(L.units ? L.units * piece : 0, L.act_wt || 0, piece);
      const correct_wt = Math.min(L.wt, slabUp(ourKg)); const correctSlabs = Math.max(1, Math.round(correct_wt / slab));
      const notes = []; let issue = 'ok', extra = 0, impact = 0;
      const mult = (1 + L.surch_pct) * (1 + (L.total ? L.gst / L.total : 0.18)), gstMult = 1 + (L.total ? L.gst / L.total : 0.18);
      // 1. weight
      if (L.wt > correct_wt + 1e-9) { const e = round2((slabs - correctSlabs) * rate); issue = 'weight'; extra += e; impact += e * mult; notes.push(`charged ${L.wt} kg, ours ${correct_wt} kg (${L.units ? L.units + ' pc' : 'their actual ' + L.act_wt + ' kg'})`); }
      // 2. zone
      if (tier && billedTier && billedTier !== tier && tiers[billedTier] > tiers[tier]) { const e = round2((tiers[billedTier] - tiers[tier]) * correctSlabs); if (issue === 'ok') issue = 'zone'; extra += e; impact += e * mult; notes.push(`freight at ₹${tiers[billedTier]} (${cfg.tier_names ? cfg.tier_names[billedTier] : 'tier ' + billedTier}) instead of ₹${tiers[tier]}`); }
      else if (!billedTier) { if (issue === 'ok') issue = 'norate'; notes.push(`freight ₹${per} per slab matches no rate`); }
      // 3. the ₹50
      if (L.topay > 0 && !L.ret) { if (issue === 'ok') issue = 'fee50'; extra += L.topay; impact += L.topay * gstMult; notes.push(`₹${L.topay} to-pay add-on`); }
      // 4. remote-area add-on
      if (L.ras > 0) { if (issue === 'ok') issue = 'oda'; notes.push(`₹${L.ras} remote-area surcharge`); }
      // 5. COD fee
      if (L.cod_product && !L.ret) {
        const want = round2(Math.max(codFee, codPct * L.decl_val));
        if (L.payment && L.payment !== 'cod') { if (issue === 'ok') issue = 'prepaid'; extra += L.cod_fee; impact += L.cod_fee * gstMult; notes.push(`COD fee ₹${L.cod_fee} but ${L.order} was prepaid`); }
        else if (!near(L.cod_fee, want)) { if (issue === 'ok') issue = 'codfee'; const e = round2(L.cod_fee - want); if (e > 0) { extra += e; impact += e * gstMult; } notes.push(`COD fee ₹${L.cod_fee}, expected ₹${want} on declared ₹${L.decl_val}`); }
      }
      // 6. anything else on the line
      if (Math.abs(L.other) > 0.01) { if (issue === 'ok') issue = 'other'; extra += Math.max(0, L.other); impact += Math.max(0, L.other) * gstMult; notes.push(`other charges ₹${round2(L.other)}`); }
      const key = L.awb + (L.ret ? ':R' : ':F'); if (seen[key]) { issue = 'dup'; extra = L.total; impact = L.total * gstMult; notes.unshift(`also billed as S.no ${seen[key]}`); } else seen[key] = L.sno;
      Object.assign(L, { slabs, per, tier, base: rate, billed_tier: billedTier, correct_wt, our_kg: round2(ourKg), amount: round2(L.freight + L.cod_fee + L.ras + L.topay + L.other), expected: round2(L.freight + L.cod_fee + L.ras + L.topay + L.other - extra), diff: round2(extra), issue, extra: round2(extra), impact: round2(impact), note: notes.join(' · ') });
    }
    const lines = parsed.lines, T = parsed.totals;
    const byI = {}; for (const l of lines) { const b = (byI[l.issue] ||= { issue: l.issue, label: DETAIL_ISSUES[l.issue], n: 0, extra: 0, impact: 0, gst_only: DETAIL_ADDON.has(l.issue) }); b.n++; if (l.issue !== 'ok' && l.issue !== 'oda' && l.issue !== 'norate') { b.extra = round2(b.extra + l.extra); b.impact = round2(b.impact + l.impact); } }
    const disputed = lines.filter(l => l.extra > 0 && !['oda', 'norate'].includes(l.issue));
    const over = lines.filter(l => l.wt > l.correct_wt + 1e-9);
    const summary = {
      invoice_no: parsed.invoice_no, invoice_date: parsed.invoice_date, product: parsed.product, detail: true, lines: lines.length, returns: lines.filter(l => l.ret).length, cod_product_lines: lines.filter(l => l.cod_product).length,
      freight_lines: T.freight, freight_invoice: T.freight, freight_match: true, surcharges: T.surcharges, gst: T.gst, grand: T.grand, net: T.net, cod_fees: T.cod_fees, topay: T.topay, ras: T.ras,
      surcharge_pct: T.freight ? Math.round(T.surcharges / T.freight * 1000) / 10 : null, multiplier: T.freight ? round2((1 + T.surcharges / T.freight) * (1 + (T.net ? T.gst / T.net : 0.18)) * 100) / 100 : null, gst_mult: 1.18,
      flagged: lines.filter(l => l.issue !== 'ok').length, disputed: disputed.length, extra: round2(disputed.reduce((s, l) => s + l.extra, 0)), impact: round2(disputed.reduce((s, l) => s + l.impact, 0)),
      extra_addon: round2(disputed.reduce((s, l) => s + (DETAIL_ADDON.has(l.issue) ? l.extra : 0), 0)), impact_addon: round2(disputed.reduce((s, l) => s + (DETAIL_ADDON.has(l.issue) ? l.impact : 0), 0)),
      weight_over: over.length, kg_over: round2(over.reduce((s, l) => s + l.wt - l.correct_wt, 0)), weight_extra: round2(over.reduce((s, l) => s + (l.slabs - Math.round(l.correct_wt / slab)) * l.base, 0)),
      known_awb: lines.filter(l => l.ours).length, unknown_awb: lines.filter(l => !l.ours).length, learned: Object.keys(learned).length, by_issue: Object.values(byI).sort((a, b) => b.impact - a.impact || b.n - a.n),
    };
    summary.extra_freight = round2(summary.extra - summary.extra_addon); summary.impact_freight = round2(summary.impact - summary.impact_addon);
    return { lines, flagged: lines.filter(l => l.issue !== 'ok'), summary, learned, labels: DETAIL_ISSUES };
  }

  const RC = { isBluedartDetail, parseBluedartDetail, checkDetail, DETAIL_ISSUES, parseInvoicePdf, parseInvoiceSheet, checkInvoice, applyLookup, checkAudit, checkCod, ISSUES, normCity, excelDate };
  if (typeof module !== 'undefined' && module.exports) module.exports = RC; else root.RC = RC;
})(typeof window !== 'undefined' ? window : globalThis);
