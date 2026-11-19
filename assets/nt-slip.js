// Shared packing slip: the same 4×6 slip the rack scanner prints (template from settings key slip_template).
// Needs apiFetch(payload) and esc(s) from the page that loads it.
(function () {
var css = document.createElement('style');
css.textContent = '.inv{font-family:Arial,Helvetica,sans-serif;font-size:8px;color:#000;border:1.5px solid #000;width:100%;box-sizing:border-box}\n.inv table{border-collapse:collapse;width:100%}\n.inv td,.inv th{padding:2px 4px;border:1px solid #888;vertical-align:top;line-height:1.3}\n.inv .no-border td,.inv .no-border{border:none}\n.inv .top-row td{border:none;padding:4px 5px;vertical-align:middle}\n.inv .logo-cell{width:28%;border-right:1px solid #bbb!important}\n.inv .bc-cell{text-align:center}\n.inv .courier-name{font-size:8px;font-weight:700;letter-spacing:.05em;text-align:center;padding:2px 0;border-top:1px solid #bbb}\n.inv .ship-cell{padding:5px 6px;vertical-align:top;width:52%}\n.inv .meta-cell{padding:4px 5px;vertical-align:top;border-left:1.5px solid #000!important}\n.inv .ship-label{font-size:6px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#555;margin-bottom:1px}\n.inv .ship-name{font-size:10px;font-weight:700;margin-bottom:1px}\n.inv .ship-addr{font-size:7.5px;line-height:1.45}\n.inv .pin-code{font-size:10px;font-weight:900;margin-top:2px}\n.inv .meta-row{display:flex;justify-content:space-between;padding:1px 0;border-bottom:1px solid #eee;font-size:7px}\n.inv .meta-row:last-child{border-bottom:none}\n.inv .meta-lbl{color:#555;font-weight:700;text-transform:uppercase;font-size:6.5px;min-width:52px}\n.inv .meta-val{font-weight:700;text-align:right}\n.inv .cod-box{border:2px solid #000;padding:5px 6px;text-align:center;font-weight:700;font-size:9px}\n.inv .cod-words{font-size:6.5px;font-weight:400;color:#333;margin-top:2px}\n.inv .sec-hdr td{font-weight:700;font-size:7px;text-align:center;padding:2px 4px;border-bottom:1px solid #000}\n.inv .items-table th{font-size:6.5px;font-weight:700;text-align:center;padding:2px 3px;border-bottom:1px solid #000}\n.inv .items-table td{font-size:7px;text-align:center;padding:2px 3px}\n.inv .items-table td:first-child{text-align:left}\n.inv .disc-row td{font-size:7px;color:#c00;font-style:italic}\n.inv .total-row td{font-weight:700;font-size:8px}\n.inv .footer-row{border-top:1px solid #000;font-size:6.5px;padding:3px 5px}\n.inv .awb-num{font-size:9px;font-weight:900;font-family:monospace;letter-spacing:.06em}\n.inv .no-awb{font-size:7px;color:#c00;font-style:italic;padding:3px}';
document.head.appendChild(css);
})();
const TPL_SETTING_KEY = 'slip_template';
const TPL_DEFAULTS = {
  companyName: 'NukkadTales',
  website: 'nukkadtales.com',
  phone: '',
  address: '360 SPIN LAB, 323, Second Floor, Near Upkar Apartment, Chilla Village, East Delhi, DL 110091',
  gstin: '07ASVPR0563L1ZZ',
  logo: '',
};


let _tplCache = null;
async function getTpl() {
  if (_tplCache) return _tplCache;
  try {
    const res = await apiFetch({ action: 'get_setting', key: TPL_SETTING_KEY });
    _tplCache = res.value ? { ...TPL_DEFAULTS, ...res.value } : { ...TPL_DEFAULTS };
  } catch { _tplCache = { ...TPL_DEFAULTS }; }
  return _tplCache;
}
function amountInWords(n) {
  const ones = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
  const tens = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
  function below100(x){ return x<20?ones[x]:tens[Math.floor(x/10)]+(x%10?' '+ones[x%10]:''); }
  function below1000(x){ return x>=100?ones[Math.floor(x/100)]+' Hundred'+(x%100?' '+below100(x%100):''):below100(x); }
  const paise = Math.round((n % 1) * 100);
  const rupees = Math.floor(n);
  let parts=[];
  const cr=Math.floor(rupees/10000000); if(cr) parts.push(below1000(cr)+' Crore');
  const lac=Math.floor((rupees%10000000)/100000); if(lac) parts.push(below1000(lac)+' Lakh');
  const thou=Math.floor((rupees%100000)/1000); if(thou) parts.push(below1000(thou)+' Thousand');
  const rem=rupees%1000; if(rem) parts.push(below1000(rem));
  let words = (parts.join(' ')||'Zero')+' Rupees';
  if(paise) words += ' and '+below100(paise)+' Paise';
  return words + ' Only';
}
async function buildSlipHtml(slip) {
  const tpl = await getTpl();
  const addr = slip.shipping_address || {};
  const addrLine1 = [addr.address1, addr.address2].filter(Boolean).join(', ');
  const addrLine2 = [addr.city, addr.province].filter(Boolean).join(' ');
  const pinCode = addr.zip || '';
  const addrLine3 = addr.country || 'India';
  const orderDate = slip.created_at ? new Date(slip.created_at).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';
  const invoiceNo = slip.order_name || '—';
  const pieceCount = (slip.line_items||[]).reduce((s,li) => s + li.quantity, 0);

  const TAX_RATE = 0.05;
  const isCOD = slip.is_cod;
  const shipPrice = isCOD ? (slip.shipping_price > 0 ? slip.shipping_price : 100) : 0;
  const totalTax = slip.total_tax || 0;
  const totalPrice = slip.total_price || 0;
  const totalDiscounts = slip.total_discounts || 0;
  const discountCodes = slip.discount_codes || [];

  // items rows
  let itemsHtml = '';
  (slip.line_items || []).forEach(li => {
    const lineTotal = li.price * li.quantity;
    const unitBase = li.price / (1 + TAX_RATE);
    const productLabel = li.variant_title ? `${li.title} — ${li.variant_title}` : li.title;
    itemsHtml += `<tr>
      <td>${esc(productLabel)}</td>
      <td>${esc(li.sku||'—')}</td>
      <td>₹${unitBase.toFixed(2)}</td>
      <td>${li.quantity}</td>
      <td>IGST(5%)</td>
      <td>₹${lineTotal.toFixed(2)}</td>
    </tr>`;
  });

  const shippingRow = isCOD ? `<tr>
    <td>Shipping Charges</td><td>—</td>
    <td>₹${(shipPrice/(1+TAX_RATE)).toFixed(2)}</td>
    <td>1</td><td>IGST(5%)</td>
    <td>₹${shipPrice.toFixed(2)}</td>
  </tr>` : '';

  const discountRow = totalDiscounts > 0 ? `<tr class="disc-row">
    <td colspan="5" style="text-align:right">Discount${discountCodes.length ? ` (${discountCodes.map(d=>d.code).join(', ')})` : ''}</td>
    <td>−₹${totalDiscounts.toFixed(2)}</td>
  </tr>` : '';

  // logo + brand
  const logoHtml = tpl.logo
    ? `<img src="${tpl.logo}" style="max-height:24px;max-width:70px;object-fit:contain;display:block;margin-bottom:2px">`
    : '';
  const phoneHtml = tpl.phone ? `<div style="font-size:6px;color:#555">${esc(tpl.phone)}</div>` : '';

  // AWB block — barcode goes in bc-cell (top-right); AWB number + courier name below barcode
  const barcodeCell = slip.awb
    ? `<canvas id="slipBarcode" data-awb="${esc(slip.awb)}" style="display:block;max-width:100%"></canvas>
       <div class="awb-num" data-editable="1" style="margin-top:2px">${esc(slip.awb)}</div>`
    : `<div class="no-awb">AWB pending</div>`;
  const courierName = slip.awb
    ? `<div class="courier-name" data-editable="1">${esc(slip.courier||'Courier')}</div>` : '';

  const codBox = isCOD ? `<tr><td colspan="2" style="padding:3px 5px;border:none">
    <div class="cod-box">Collect Cash On Delivery &nbsp;₹${totalPrice.toFixed(2)}
      <div class="cod-words">${amountInWords(totalPrice)}</div>
    </div></td></tr>` : '';

  return `<div class="inv">
  <table>
    <!-- TOP: logo left | barcode right -->
    <tr class="top-row" style="border-bottom:1.5px solid #000">
      <td class="logo-cell" style="width:30%;border:none;border-right:1px solid #bbb;padding:4px 5px;vertical-align:middle">
        ${logoHtml}
        <div style="font-size:${tpl.logo?'8px':'11px'};font-weight:900;font-family:Georgia,serif;line-height:1.2">${esc(tpl.companyName)}</div>
        <div style="font-size:6px;color:#555">${esc(tpl.website)}</div>
        ${phoneHtml}
      </td>
      <td style="border:none;text-align:center;padding:4px 5px;vertical-align:middle">
        ${courierName}
        ${barcodeCell}
      </td>
    </tr>
    <!-- SHIP TO left | ORDER DETAILS right -->
    <tr style="border-bottom:1.5px solid #000">
      <td class="ship-cell" style="width:52%;border-right:1.5px solid #000">
        <div class="ship-label">Ship To</div>
        <div class="ship-name" data-editable="1">${esc(slip.customer_name)}</div>
        <div class="ship-addr" data-editable="1">${esc(addrLine1)}</div>
        <div class="ship-addr" data-editable="1">${esc(addrLine2)}</div>
        <div class="pin-code">${esc(pinCode)}</div>
        <div class="ship-addr">${esc(addrLine3)}</div>
        ${slip.phone ? `<div class="ship-addr" style="margin-top:1px" data-editable="1">Ph: ${esc(slip.phone)}</div>` : ''}
      </td>
      <td class="meta-cell" style="vertical-align:top;padding:4px 5px">
        <div class="meta-row"><span class="meta-lbl">Order Date</span><span class="meta-val">${orderDate}</span></div>
        <div class="meta-row"><span class="meta-lbl">Invoice No</span><span class="meta-val">${esc(invoiceNo)}</span></div>
        <div class="meta-row"><span class="meta-lbl">Order ID</span><span class="meta-val">${esc(String(slip.order_number||invoiceNo))}</span></div>
        <div class="meta-row"><span class="meta-lbl">Pieces</span><span class="meta-val">${pieceCount}</span></div>
        <div class="meta-row"><span class="meta-lbl">Payment</span><span class="meta-val" style="color:${isCOD?'#c00':'#060'};font-weight:900">${isCOD?'COD':'Pre-Paid'}</span></div>
      </td>
    </tr>
    ${codBox}
    <!-- ITEMS -->
    <tr class="sec-hdr"><td colspan="2">ITEMS</td></tr>
    <tr><td colspan="2" style="padding:0;border:none">
      <table class="items-table" style="width:100%">
        <thead><tr>
          <th style="text-align:left;width:36%">Product</th>
          <th>SKU</th><th>Unit Price</th><th>Qty</th><th>Tax</th><th>Amount</th>
        </tr></thead>
        <tbody>
          ${itemsHtml}
          ${shippingRow}
          ${discountRow}
          <tr><td colspan="5" style="text-align:right;font-weight:700">Taxes (IGST 5%)</td><td>₹${totalTax.toFixed(2)}</td></tr>
          <tr class="total-row"><td colspan="5" style="text-align:right">Total</td><td>₹${totalPrice.toFixed(2)}</td></tr>
        </tbody>
      </table>
    </td></tr>
    <!-- FOOTER -->
    <tr><td class="footer-row" colspan="2">
      <strong>Return Address:</strong> ${esc(tpl.address)} &nbsp;|&nbsp; <strong>GSTIN:</strong> ${esc(tpl.gstin)}
    </td></tr>
  </table>
</div>`;
}
function drawCode128(canvas, text, h) {
  // Code 128B encoder — produces scannable linear barcode (ISO/IEC 15417)
  const P = [
    [2,1,2,2,2,2],[2,2,2,1,2,2],[2,2,2,2,2,1],[1,2,1,2,2,3],[1,2,1,3,2,2],
    [1,3,1,2,2,2],[1,2,2,2,1,3],[1,2,2,3,1,2],[1,3,2,2,1,2],[2,2,1,2,1,3],
    [2,2,1,3,1,2],[2,3,1,2,1,2],[1,1,2,2,3,2],[1,2,2,1,3,2],[1,2,2,2,3,1],
    [1,1,3,2,2,2],[1,2,3,1,2,2],[1,2,3,2,2,1],[2,2,3,2,1,1],[2,2,1,1,3,2],
    [2,2,1,2,3,1],[2,1,3,2,1,2],[2,2,3,1,1,2],[3,1,2,1,3,1],[3,1,1,2,2,2],
    [3,2,1,1,2,2],[3,2,1,2,2,1],[3,1,2,2,1,2],[3,2,2,1,1,2],[3,2,2,2,1,1],
    [2,1,2,1,2,3],[2,1,2,3,2,1],[2,3,2,1,2,1],[1,1,1,3,2,3],[1,3,1,1,2,3],
    [1,3,1,3,2,1],[1,1,2,3,1,3],[1,3,2,1,1,3],[1,3,2,3,1,1],[2,1,1,3,1,3],
    [2,3,1,1,1,3],[2,3,1,3,1,1],[1,1,2,1,3,3],[1,1,2,3,3,1],[1,3,2,1,3,1],
    [1,1,3,1,2,3],[1,1,3,3,2,1],[1,3,3,1,2,1],[3,1,3,1,2,1],[2,1,1,3,3,1],
    [2,3,1,1,3,1],[2,1,3,1,1,3],[2,1,3,3,1,1],[2,1,3,1,3,1],[3,1,1,1,2,3],
    [3,1,1,3,2,1],[3,3,1,1,2,1],[3,1,2,1,1,3],[3,1,2,3,1,1],[3,3,2,1,1,1],
    [3,1,4,1,1,1],[2,2,1,4,1,1],[4,3,1,1,1,1],[1,1,1,2,2,4],[1,1,1,4,2,2],
    [1,2,1,1,2,4],[1,2,1,4,2,1],[1,4,1,1,2,2],[1,4,1,2,2,1],[1,1,2,2,1,4],
    [1,1,2,4,1,2],[1,2,2,1,1,4],[1,2,2,4,1,1],[1,4,2,1,1,2],[1,4,2,2,1,1],
    [2,4,1,2,1,1],[2,2,1,1,1,4],[4,1,3,1,1,1],[2,4,1,1,1,2],[1,3,4,1,1,1],
    [1,1,1,2,4,2],[1,2,1,1,4,2],[1,2,1,2,4,1],[1,1,4,2,1,2],[1,2,4,1,1,2],
    [1,2,4,2,1,1],[4,1,1,2,1,2],[4,2,1,1,1,2],[4,2,1,2,1,1],[2,1,2,1,4,1],
    [2,1,4,1,2,1],[4,1,2,1,2,1],[1,1,1,1,4,3],[1,1,1,3,4,1],[1,3,1,1,4,1],
    [1,1,4,1,1,3],[1,1,4,3,1,1],[4,1,1,1,1,3],[4,1,1,3,1,1],[1,1,3,1,4,1],
    [1,1,4,1,3,1],[3,1,1,1,4,1],[4,1,1,1,3,1],[2,1,1,4,1,2],[2,1,1,2,1,4],
    [2,1,1,2,3,2] // 105 = START C (also used as index 105)
  ];
  const START_B = 104, STOP_PAT = [2,3,3,1,1,1,2];
  const codes = [START_B];
  for (let i = 0; i < text.length; i++) {
    const v = text.charCodeAt(i) - 32;
    if (v >= 0 && v <= 95) codes.push(v);
  }
  let chk = START_B;
  for (let i = 1; i < codes.length; i++) chk = (chk + i * codes[i]) % 103;
  codes.push(chk);
  const allPats = codes.map(c => P[c]);
  allPats.push(STOP_PAT);
  const U = 3; // pixels per unit — 3px gives better print quality on thermal labels
  const totalUnits = allPats.reduce((s,p) => s + p.reduce((a,b)=>a+b,0), 0);
  canvas.width = totalUnits * U;
  canvas.height = h || 50;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  let x = 0, bar = true;
  allPats.forEach(pat => pat.forEach(w => {
    if (bar) ctx.fillRect(x * U, 0, w * U, canvas.height);
    x += w; bar = !bar;
  }));
}
async function ntPrintSlips(slips) {
  const html = (await Promise.all(slips.map(buildSlipHtml))).map((h, i) => `<div style="width:101.6mm;height:152.4mm;overflow:hidden;padding:2mm 3mm;box-sizing:border-box;${i ? 'break-before:page;' : ''}">${h}</div>`).join('');
  const box = document.createElement('div'); box.innerHTML = html;
  box.querySelectorAll('canvas[data-awb]').forEach(bc => { drawCode128(bc, bc.dataset.awb, 72); const img = document.createElement('img'); img.src = bc.toDataURL('image/png'); img.style.cssText = 'display:block;width:100%'; bc.parentNode.replaceChild(img, bc); });
  return box.innerHTML;
}
