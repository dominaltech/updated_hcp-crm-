import { amountToWordsIndian, formatCurrency, formatDateTime, cleanVoucherNumber } from '../utils/formatters';
export { cleanVoucherNumber };
import html2pdf from 'html2pdf.js';

// Preload and decode print assets ahead of time so browser print preview opens instantaneously
const PRELOAD_PRINT_ASSETS = [
  '/HCP New Logo Png_witought-name.png',
  '/hcp-logo-with-name.png',
  '/hcp-logo-with-name-transparent.png',
  '/phone-call.png',
  '/hcp-logo-without-name.png'
];

if (typeof window !== 'undefined' && typeof Image !== 'undefined') {
  PRELOAD_PRINT_ASSETS.forEach(src => {
    try {
      const img = new Image();
      img.src = src;
      if (img.decode) {
        img.decode().catch(() => {});
      }
    } catch (_) {}
  });
}

/**
 * Temporarily disables dark mode on <html> and <body> during window.print()
 * so browser print engine renders crisp, pure-white paper sheets with zero dark patches.
 */
function enterPrintThemeIsolation() {
  if (typeof document === 'undefined') return () => {};
  const prevThemeAttr = document.documentElement.getAttribute('data-theme');
  const wasHtmlDark = document.documentElement.classList.contains('dark-theme');
  const wasBodyDark = document.body.classList.contains('dark-theme');

  document.documentElement.setAttribute('data-theme', 'light');
  document.documentElement.classList.remove('dark-theme');
  document.body.classList.remove('dark-theme');

  let restored = false;
  return function exitPrintThemeIsolation() {
    if (restored) return;
    restored = true;
    if (prevThemeAttr) {
      document.documentElement.setAttribute('data-theme', prevThemeAttr);
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    if (wasHtmlDark) document.documentElement.classList.add('dark-theme');
    if (wasBodyDark) document.body.classList.add('dark-theme');
  };
}

/**
 * Dispatches 80mm thermal slip HTML to a hidden iframe for instant silent printing,
 * with popup window fallback if iframe printing is blocked.
 */
export function printSlipWindow(slipHtml) {
  try {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow.document;
    doc.open();
    doc.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Print Slip</title>
        <style>
          @page { size: 80mm auto; margin: 0; }
          body {
            font-family: 'Courier New', Courier, monospace, sans-serif;
            width: 72mm;
            margin: 4mm auto;
            font-size: 12px;
            color: #000;
            line-height: 1.25;
          }
          .slip-header { text-align: center; margin-bottom: 8px; }
          .slip-header h2 { font-size: 16px; margin: 0 0 2px; }
          .slip-header p { margin: 0; font-size: 10px; }
          .divider { border-top: 1px dashed #000; margin: 6px 0; }
          .double-divider { border-top: 2px solid #000; margin: 6px 0; }
          .flex-row { display: flex; justify-content: space-between; }
          .items-table { width: 100%; border-collapse: collapse; margin: 6px 0; font-size: 11px; }
          .items-table th, .items-table td { text-align: left; padding: 2px 0; }
          .items-table th:last-child, .items-table td:last-child { text-align: right; }
          .text-center { text-align: center; }
          .text-bold { font-weight: bold; }
          .tag-box { border: 1px solid #000; padding: 2px 6px; font-weight: bold; display: inline-block; }
        </style>
      </head>
      <body>
        ${slipHtml}
      </body>
      </html>
    `);
    doc.close();

    setTimeout(() => {
      let printSuccess = false;
      try {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
        printSuccess = true;
      } catch (printErr) {
        console.warn('Iframe print error, attempting popup fallback:', printErr);
      }

      if (!printSuccess) {
        try {
          const w = window.open('', '_blank', 'width=380,height=550');
          if (w) {
            w.document.write(`
              <!DOCTYPE html><html><head><title>Print Slip</title><style>@page{size:80mm auto;margin:0;}body{font-family:'Courier New',monospace;width:72mm;margin:4mm auto;font-size:12px;}</style></head><body>${slipHtml}<script>window.onload=function(){window.print();window.close();};</script></body></html>
            `);
            w.document.close();
          }
        } catch (popupErr) {
          console.warn('Popup print fallback error:', popupErr);
        }
      }

      setTimeout(() => {
        try {
          iframe.remove();
        } catch (e) {}
      }, 5000);
    }, 250);
  } catch (err) {
    console.warn('Error creating print slip:', err);
  }
}

/**
 * 80mm Thermal KOT Slip
 */
export function printKOTSlip(kot, tableNumber, waiterName, notes) {
  const items = (kot && Array.isArray(kot.items)) ? kot.items : (Array.isArray(kot) ? kot : []);
  const tStr = String(tableNumber || '');
  const isRS = tStr.startsWith('RS-');
  const isParcel = tStr.startsWith('P-');
  const displayLoc = isRS ? `Room: ${tStr.replace(/^RS-/i, '').trim()} [Room Service]` : isParcel ? `Parcel #${tStr.replace(/^P-/i, '').trim()} [Takeaway]` : `Table: ${tStr}`;

  const rows = items
    .map(
      (it) => `
    <tr>
      <td style="width: 25px;">${it.quantity || it.qty || 1}x</td>
      <td><strong>${escapeHtml(it.name)}</strong>${it.is_parcel ? ' <small>[PARCEL]</small>' : ''}</td>
    </tr>
  `
    )
    .join('');

  const html = `
    <div class="slip-header">
      <h2>** K.O.T. **</h2>
      <p>HOTEL CITY PARK - KITCHEN</p>
    </div>
    <div class="divider"></div>
    <div class="flex-row">
      <span><strong>${escapeHtml(displayLoc)}</strong></span>
      <span class="tag-box">TOKEN ${kot.tokenNumber || kot.token_number || 1}</span>
    </div>
    <div class="flex-row" style="margin-top: 2px;">
      <span>KOT #${kot.kotNumber || kot.kot_number || 1}</span>
      <span>${formatDateTime(new Date())}</span>
    </div>
    ${waiterName ? `<div style="font-size: 10px; margin-top: 2px;">Captain: ${escapeHtml(waiterName)}</div>` : ''}
    <div class="divider"></div>
    <table class="items-table">
      <thead>
        <tr>
          <th>QTY</th>
          <th>ITEM DESCRIPTION</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
    ${
      notes
        ? `
      <div class="divider"></div>
      <div style="font-size: 11px;"><strong>NOTE:</strong> ${escapeHtml(notes)}</div>
    `
        : ''
    }
    <div class="divider"></div>
    <div class="text-center" style="font-size: 10px;">-- Kitchen Copy --</div>
  `;

  printSlipWindow(html);
}

/**
 * 80mm Thermal BOT Slip (Bar Order Token)
 */
export function printBOTSlip(bot, tableNumber, waiterName, notes) {
  const items = (bot && Array.isArray(bot.items)) ? bot.items : (Array.isArray(bot) ? bot : []);
  const tStr = String(tableNumber || '');
  const isRS = tStr.startsWith('RS-');
  const isParcel = tStr.startsWith('P-');
  const displayLoc = isRS ? `Room: ${tStr.replace(/^RS-/i, '').trim()} [Room Service]` : isParcel ? `Parcel #${tStr.replace(/^P-/i, '').trim()} [Takeaway]` : `Table: ${tStr}`;

  const rows = items
    .map(
      (it) => `
    <tr>
      <td style="width: 25px;">${it.quantity || it.qty || 1}x</td>
      <td><strong>${escapeHtml(it.name)}</strong></td>
    </tr>
  `
    )
    .join('');

  const html = `
    <div class="slip-header">
      <h2>** B.O.T. **</h2>
      <p>HOTEL CITY PARK - BAR & LOUNGE</p>
    </div>
    <div class="divider"></div>
    <div class="flex-row">
      <span><strong>${escapeHtml(displayLoc)}</strong></span>
      <span class="tag-box">TOKEN ${bot.tokenNumber || bot.token_number || 1}</span>
    </div>
    <div class="flex-row" style="margin-top: 2px;">
      <span>BOT #${bot.botNumber || bot.bot_number || 1}</span>
      <span>${formatDateTime(new Date())}</span>
    </div>
    ${waiterName ? `<div style="font-size: 10px; margin-top: 2px;">Bartender/Captain: ${escapeHtml(waiterName)}</div>` : ''}
    <div class="divider"></div>
    <table class="items-table">
      <thead>
        <tr>
          <th>QTY</th>
          <th>ITEM DESCRIPTION</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
    ${
      notes
        ? `
      <div class="divider"></div>
      <div style="font-size: 11px;"><strong>NOTE:</strong> ${escapeHtml(notes)}</div>
    `
        : ''
    }
    <div class="divider"></div>
    <div class="text-center" style="font-size: 10px;">-- Bar Dispense Copy --</div>
  `;

  printSlipWindow(html);
}

/**
 * 80mm Thermal Pre-Bill Slip (Check before payment)
 */
export function printPreBillSlip(table, cart, waiterName) {
  const items = Array.isArray(cart) ? cart : [];
  const tableObj = (typeof table === 'object' && table !== null) ? table : { table_number: String(table || '') };
  const tNum = String(tableObj.table_number || tableObj.number || '');
  const isRS = tableObj.table_type === 'room_service' || tNum.startsWith('RS-');
  const isParcel = tableObj.table_type === 'parcel' || tableObj.is_parcel || tNum.startsWith('P-');

  const headerDept = isRS ? 'Room Service Food & Beverage' : isParcel ? 'Takeaway & Delivery Counter' : 'Restaurant & Dining Floor';
  const displayLocation = isRS ? `Room: <strong>${tNum.replace(/^RS-/i, '').trim()}</strong>` : isParcel ? `Parcel: <strong>#${tNum.replace(/^P-/i, '').trim()}</strong>` : `Table: <strong>${escapeHtml(tNum)}</strong>`;

  const subtotal = items.reduce((sum, it) => sum + ((Number(it.price) || 0) * (it.quantity || it.qty || 1)), 0);
  const discountAmount = Number(tableObj.discount_amount || tableObj.discountAmount || 0);
  const taxableAmount = Math.max(0, subtotal - discountAmount);
  const cgstRate = 2.5;
  const sgstRate = 2.5;
  const cgstAmount = Math.round(taxableAmount * 0.025);
  const sgstAmount = Math.round(taxableAmount * 0.025);
  const tax = cgstAmount + sgstAmount;
  const grandTotal = taxableAmount + tax;
  const gstEnabled = true;

  const rows = items
    .map((it) => {
      const q = it.quantity || it.qty || 1;
      const p = Number(it.price) || 0;
      return `
    <tr>
      <td>${escapeHtml(it.name)}</td>
      <td style="text-align: center;">${q}</td>
      <td style="text-align: right;">${p.toFixed(2)}</td>
      <td style="text-align: right;">${(p * q).toFixed(2)}</td>
    </tr>
  `;
    })
    .join('');

  const html = `
    <div class="slip-header">
      <img src="/hcp-logo-with-name.png" alt="Hotel CityPaark" style="height: 38px; width: auto; object-fit: contain; margin: 0 auto 4px; display: block;" />
      <p style="font-size: 8px; font-weight: bold; color: #333; margin: 0 0 2px;"><span style="font-weight: normal; text-transform: lowercase;">by</span> JMG HOSPITALITY AND INFRA LLP</p>
      <p style="font-size: 9px; line-height: 1.25;">119, Murarji Peth, Char Hutatma Chowk, Solapur - 413 001</p>
      <p style="font-size: 8.5px; margin: 2px 0 0;"><img src="/phone-call.png" alt="" style="width: 10px; height: 10px; vertical-align: -1px; display: inline-block;" /> : 0217-2725388, +91 9960013388</p>
      <p>${escapeHtml(headerDept)}</p>
      <p style="font-weight: bold; margin-top: 2px;">*** PRE-BILL / CHECK ***</p>
    </div>
    <div class="divider"></div>
    <div class="flex-row">
      <span>${displayLocation}</span>
      <span>Token: <strong>${tableObj.token_number || tableObj.tokenNumber || 1}</strong></span>
    </div>
    <div class="flex-row">
      <span>Date: ${formatDateTime(new Date())}</span>
    </div>
    ${waiterName ? `<div>Captain: ${escapeHtml(waiterName)}</div>` : ''}
    ${tableObj.special_notes ? `<div>Guest/Notes: ${escapeHtml(tableObj.special_notes)}</div>` : ''}
    <div class="divider"></div>
    <table class="items-table">
      <thead>
        <tr>
          <th>Item</th>
          <th style="text-align: center;">Qty</th>
          <th style="text-align: right;">Rate</th>
          <th style="text-align: right;">Amt</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
    <div class="divider"></div>
    <div class="flex-row">
      <span>Subtotal:</span>
      <span>₹ ${subtotal.toFixed(2)}</span>
    </div>
    ${discountAmount > 0 ? `
      <div class="flex-row" style="color: #166534; font-weight: bold;">
        <span>Discount:</span>
        <span>-₹ ${discountAmount.toFixed(2)}</span>
      </div>
    ` : ''}
    ${gstEnabled ? `
      <div class="flex-row">
        <span>CGST (${cgstRate}%):</span>
        <span>₹ ${cgstAmount.toFixed(2)}</span>
      </div>
      <div class="flex-row">
        <span>SGST (${sgstRate}%):</span>
        <span>₹ ${sgstAmount.toFixed(2)}</span>
      </div>
    ` : ''}
    <div class="double-divider"></div>
    <div class="flex-row" style="font-size: 14px; font-weight: bold;">
      <span>ESTIMATED TOTAL:</span>
      <span>₹ ${grandTotal.toFixed(2)}</span>
    </div>
    <div class="divider"></div>
    <div class="text-center" style="font-size: 10px; margin-top: 6px;">
      <p style="margin: 0;">This is a pre-bill check, not a tax invoice.</p>
      <p style="margin: 2px 0 0;">Thank you! Visit Again.</p>
    </div>
  `;

  printSlipWindow(html);
}

/**
 * 80mm Thermal Bill Slip (Settled Tax Invoice)
 */
export function printThermalBillSlip(order, deptTitle = 'TAX INVOICE') {
  return printCheckoutSlip(order, deptTitle);
}

/**
 * 80mm Thermal Checkout / Settlement Bill Slip
 */
export function printCheckoutSlip(rawOrder, customDeptTitle) {
  if (!rawOrder) return;
  const order = (rawOrder && rawOrder.order) ? rawOrder.order : rawOrder;

  const items = (order.items && Array.isArray(order.items))
    ? order.items
    : (Array.isArray(order.cart)
      ? order.cart
      : (typeof order.items_json === 'string' ? (JSON.parse(order.items_json || '[]') || []) : (order.items_json || [])));
  const subtotal = Number(order.subtotal !== undefined ? order.subtotal : (order.taxable_amount || 0)) ||
    items.reduce((sum, it) => sum + ((Number(it.price || it.rate) || 0) * (Number(it.quantity || it.qty) || 1)), 0);
  const discountAmt = Number(order.discount_amount || order.discountAmount || 0);
  const tax = Number(order.tax_amount !== undefined ? order.tax_amount : (order.tax !== undefined ? order.tax : (order.gst || Math.round((subtotal - discountAmt) * 0.05)))) || 0;
  const grandTotal = Number(order.grand_total !== undefined ? order.grand_total : (order.grandTotal !== undefined ? order.grandTotal : (order.total !== undefined ? order.total : (subtotal - discountAmt + tax)))) || 0;
  const taxable = subtotal;
  const total = grandTotal;

  const tStr = String(order.table_number || order.tableNumber || '');
  const isRS = tStr.startsWith('RS-') || order.order_type === 'room' || order.orderType === 'room';
  const isParcel = tStr.startsWith('P-') || order.order_type === 'parcel' || order.orderType === 'parcel';
  const displayLocation = isRS ? `Room: <strong>${tStr.replace(/^RS-/i, '').trim()}</strong> [Room Service]` : isParcel ? `Parcel: <strong>#${tStr.replace(/^P-/i, '').trim()}</strong>` : `Table: <strong>${escapeHtml(tStr || 'Counter/Takeaway')}</strong>`;

  const deptTitle = customDeptTitle || order.department_title || (order.is_bar ? 'HOTEL CITY PARK - BAR & LOUNGE' : 'HOTEL CITY PARK - RESTAURANT');

  const rows = items
    .map(it => {
      const q = Number(it.quantity || it.qty || 1);
      const p = Number(it.price || it.rate || 0);
      return `
        <tr>
          <td>${escapeHtml(it.name || it.item_name)}</td>
          <td style="text-align: center;">${q}</td>
          <td style="text-align: right;">${p.toFixed(2)}</td>
          <td style="text-align: right;">${(p * q).toFixed(2)}</td>
        </tr>
      `;
    })
    .join('');

  const guestName = order.customer_name || order.customerName;

  const html = `
    <div class="slip-header">
      <img src="/hcp-logo-with-name.png" alt="Hotel CityPaark" style="height: 42px; width: auto; object-fit: contain; margin: 0 auto 4px; display: block;" />
      <p style="font-size: 8px; font-weight: bold; color: #333; margin: 0 0 2px;"><span style="font-weight: normal; text-transform: lowercase;">by</span> JMG HOSPITALITY AND INFRA LLP</p>
      <p style="font-size: 9px; line-height: 1.25;">119, Murarji Peth, Char Hutatma Chowk, Solapur - 413 001</p>
      <p style="font-size: 9px;"><img src="/phone-call.png" alt="" style="width: 10px; height: 10px; vertical-align: -1px; display: inline-block;" /> : 0217-2725388, +91 99600 13388 • GSTIN: 27AAAAA0000A1Z5</p>
      <p class="text-bold" style="margin-top: 3px; font-size: 11px; letter-spacing: 0.04em;">${escapeHtml(deptTitle)}</p>
    </div>
    <div class="divider"></div>
    <div class="flex-row">
      <span>Bill #: <strong>${escapeHtml(order.orderNumber || order.order_number || order.bill_number || `ORD-${order.id}`)}</strong></span>
      <span>Token: <strong>${order.token_number || 1}</strong></span>
    </div>
    <div class="flex-row">
      <span>${displayLocation}</span>
      <span>${formatDateTime(order.settled_at || new Date())}</span>
    </div>
    ${guestName ? `<div>Guest: ${escapeHtml(guestName)}</div>` : ''}
    ${order.waiter_name ? `<div>Captain/Bartender: ${escapeHtml(order.waiter_name)}</div>` : ''}
    ${(order.cashier_name || order.cashierName) ? `<div>Cashier: <strong>${escapeHtml(order.cashier_name || order.cashierName)}</strong></div>` : ''}
    <div class="divider"></div>
    <table class="items-table">
      <thead>
        <tr>
          <th>Item</th>
          <th style="text-align: center;">Qty</th>
          <th style="text-align: right;">Rate</th>
          <th style="text-align: right;">Amt</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
    <div class="divider"></div>
    <div class="flex-row">
      <span>Subtotal:</span>
      <span>₹${subtotal.toFixed(2)}</span>
    </div>
    ${
      discountAmt > 0
        ? `
      <div class="flex-row">
        <span>Discount:</span>
        <span>-₹${discountAmt.toFixed(2)}</span>
      </div>
    `
        : ''
    }
    <div class="flex-row">
      <span>GST (5%):</span>
      <span>₹${tax.toFixed(2)}</span>
    </div>
    <div class="double-divider"></div>
    <div class="flex-row" style="font-size: 14px; font-weight: bold;">
      <span>Grand Total:</span>
      <span>₹${grandTotal.toFixed(2)}</span>
    </div>
    <div class="divider"></div>
    <div class="flex-row" style="font-size: 11px;">
      <span>Payment Mode:</span>
      <span style="font-weight: bold; text-transform: uppercase;">${escapeHtml(order.payment_mode || 'Cash')}</span>
    </div>
    ${
      (() => {
        try {
          const breakdown = formatPaymentBreakdown(order);
          if (breakdown && breakdown.toLowerCase() !== String(order.payment_mode || 'cash').toLowerCase()) {
            return `<div style="font-size: 10px; color: #334155; margin-top: 2px; text-align: right; font-weight: 600;">${escapeHtml(breakdown)}</div>`;
          }
        } catch (e) {}
        return '';
      })()
    }
    ${
      (Number(order.card_surcharge || order.cardSurcharge || 0) > 0)
        ? `
      <div class="flex-row" style="font-size: 11px; color: #854d0e; font-weight: bold;">
        <span>Card Fee (2.5%):</span>
        <span>+₹${Number(order.card_surcharge || order.cardSurcharge).toFixed(2)}</span>
      </div>
    `
        : ''
    }
    ${
      (Number(order.upi_tax || order.upiTax || 0) > 0)
        ? `
      <div class="flex-row" style="font-size: 11px; color: #0284c7; font-weight: bold;">
        <span>UPI Tax (0.4% > ₹2k):</span>
        <span>+₹${Number(order.upi_tax || order.upiTax).toFixed(2)}</span>
      </div>
    `
        : ''
    }
    ${
      (Number(order.card_surcharge || order.cardSurcharge || 0) > 0 || Number(order.upi_tax || order.upiTax || 0) > 0)
        ? `
      <div class="flex-row" style="font-size: 13px; font-weight: bold; border-top: 1px dashed #000; padding-top: 3px; margin-top: 3px;">
        <span>Total Settled:</span>
        <span>₹${(grandTotal + (Number(order.card_surcharge || order.cardSurcharge) || 0) + (Number(order.upi_tax || order.upiTax) || 0)).toFixed(2)}</span>
      </div>
    `
        : ''
    }
    ${
      order.resettle_count > 0
        ? `
      <div style="font-size: 10px; color: #666; margin-top: 2px;">
        * Bill Resettled (${order.resettle_count} times)
      </div>
    `
        : ''
    }
    <div class="divider"></div>
    <div class="text-center" style="font-size: 11px; margin-top: 6px;">
      Thank you for visiting us!<br>
      Please visit us again.
    </div>
  `;

  printSlipWindow(html);
}

/**
 * Helper to format payment mode with full breakdown:
 * - If UPI/Online: includes UTR reference number
 * - If Cheque: includes Cheque number and Bank name
 * - If Cash: includes Cash
 * - If Split: combines all active modes with amounts and references
 */
export function formatPaymentBreakdown(receipt) {
  const parts = [];
  let splitDetails = receipt.split_details || {};
  if (!splitDetails || typeof splitDetails !== 'object') {
    try {
      if (typeof receipt.split_details_json === 'string') splitDetails = JSON.parse(receipt.split_details_json);
    } catch (e) {}
  }
  const splitCash = Number(receipt.split_cash !== undefined ? receipt.split_cash : (receipt.splitCash !== undefined ? receipt.splitCash : splitDetails.cash)) || 0;
  const splitOnline = Number(receipt.split_online !== undefined ? receipt.split_online : (receipt.splitOnline !== undefined ? receipt.splitOnline : splitDetails.online)) || 0;
  const splitCard = Number(receipt.split_card !== undefined ? receipt.split_card : (receipt.splitCard !== undefined ? receipt.splitCard : splitDetails.card)) || 0;
  const splitCheque = Number(receipt.split_cheque !== undefined ? receipt.split_cheque : (receipt.splitCheque !== undefined ? receipt.splitCheque : splitDetails.cheque)) || 0;
  const utr = (receipt.utr_number || receipt.online_utr || receipt.onlineUtr || receipt.utr || '').trim();
  const chqNo = (receipt.cheque_no || receipt.chequeNo || '').trim();
  const bankName = (receipt.bank_name || receipt.chequeBank || receipt.bank || '').trim();
  const cardSurcharge = Number(receipt.card_surcharge || receipt.cardSurcharge) || (splitCard > 0 ? Math.round(splitCard * 0.025) : 0);
  const explicitUpiTax = Number(receipt.upi_tax !== undefined ? receipt.upi_tax : receipt.upiTax);
  const upiTax = (!isNaN(explicitUpiTax) && explicitUpiTax > 0)
    ? explicitUpiTax
    : (splitOnline > 2000 ? Math.round(splitOnline * 0.004) : 0);

  const hasSplitData = (splitCash > 0 || splitOnline > 0 || splitCard > 0 || splitCheque > 0);

  if (hasSplitData) {
    if (splitCash > 0) {
      parts.push(`Cash: ₹${parseFloat(splitCash).toLocaleString('en-IN')}`);
    }
    if (splitOnline > 0) {
      const finalOnline = splitOnline + upiTax;
      parts.push(`UPI: ₹${finalOnline.toLocaleString('en-IN')}${upiTax > 0 ? ` (₹${splitOnline.toLocaleString('en-IN')} + ₹${upiTax} Fee)` : ''}${utr ? ` (UTR: ${utr})` : ''}`);
    }
    if (splitCheque > 0) {
      parts.push(`Cheque: ₹${parseFloat(splitCheque).toLocaleString('en-IN')}${chqNo ? ` (No: ${chqNo}${bankName ? `, ${bankName}` : ''})` : ''}`);
    }
    if (splitCard > 0) {
      const finalCard = splitCard + cardSurcharge;
      parts.push(`Card: ₹${finalCard.toLocaleString('en-IN')}${cardSurcharge > 0 ? ` (₹${splitCard.toLocaleString('en-IN')} + ₹${cardSurcharge} Fee)` : ''}`);
    }
    if (parts.length > 0) return parts.join(' | ');
  }

  const rawMode = String(receipt.payment_mode || receipt.paymentMode || receipt.mode || 'Cash');
  const modeLower = rawMode.toLowerCase();
  const amt = Number(receipt.base_amount !== undefined ? receipt.base_amount : (receipt.amount !== undefined ? receipt.amount : (receipt.total || 0))) || 0;
  const singleCardSurcharge = cardSurcharge > 0 ? cardSurcharge : (amt > 0 ? Math.round(amt * 0.025) : 0);
  const singleUpiTax = upiTax > 0 ? upiTax : (amt > 2000 ? Math.round(amt * 0.004) : 0);

  if (modeLower.includes('upi') || modeLower.includes('online')) {
    const finalAmt = amt + singleUpiTax;
    return `Online UPI: ₹${finalAmt.toLocaleString('en-IN')}${singleUpiTax > 0 ? ` (₹${amt.toLocaleString('en-IN')} + ₹${singleUpiTax} Fee)` : ''}${utr ? ` (UTR: ${utr})` : ''}`;
  }
  if (modeLower.includes('cheque') || modeLower.includes('check')) {
    return `Cheque${chqNo ? ` No: ${chqNo}` : ''}${bankName ? ` (${bankName})` : ''}`;
  }
  if (modeLower.includes('card')) {
    const finalAmt = amt + singleCardSurcharge;
    return `Card POS Swipe: ₹${finalAmt.toLocaleString('en-IN')}${singleCardSurcharge > 0 ? ` (₹${amt.toLocaleString('en-IN')} + ₹${singleCardSurcharge} Fee)` : ''}`;
  }
  if (modeLower.includes('cash')) {
    return amt > 0 ? `Cash: ₹${amt.toLocaleString('en-IN')}` : 'Cash';
  }

  // If already formatted with details
  return rawMode;
}

/**
 * Formats receipt number with dynamic payment mode prefix:
 * Cash -> CR260920-596
 * UPI / Online -> UPI260920-596
 * Card / POS -> POS260920-596
 * Cheque -> CHQ260920-596
 * BTC -> BTC260920-596
 */
export function formatReceiptNumberWithMode(rawNo, mode) {
  if (rawNo === undefined || rawNo === null || rawNo === '') return '';
  const m = String(mode || 'cash').toLowerCase();
  let prefix = 'CR';
  if (m.includes('upi') || m.includes('online')) prefix = 'UPI';
  else if (m.includes('card') || m.includes('pos')) prefix = 'POS';
  else if (m.includes('cheque') || m.includes('check')) prefix = 'CHQ';
  else if (m.includes('btc') || m.includes('company')) prefix = 'BTC';

  const cleanStr = String(rawNo).trim();
  // Strip any existing prefix: CR, UPI, POS, CHQ, BTC, RCP-, etc.
  const cleanBase = cleanStr
    .replace(/^(CR|UPI|POS|CHQ|BTC|RCP-?)/i, '')
    .replace(/^20(\d{6}-\d+)$/, '$1');
  return `${prefix}${cleanBase}`;
}

export function formatReceiptDateTime(dateVal) {
  const d = dateVal ? new Date(dateVal) : new Date();
  if (isNaN(d.getTime())) return new Date().toLocaleDateString('en-IN');
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'pm' : 'am';
  hours = hours % 12;
  hours = hours ? hours : 12;
  const hh = String(hours).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} - ${hh}:${minutes} ${ampm}`;
}

export function getActiveCashierName() {
  if (typeof window === 'undefined' || !window.localStorage) return '';
  try {
    const rawSingle = localStorage.getItem('hotel_staff_user');
    if (rawSingle) {
      const u = JSON.parse(rawSingle);
      if (u && (u.full_name || u.name || u.username)) {
        return (u.full_name || u.name || u.username).trim();
      }
    }
    const rawDept = localStorage.getItem('hotel_department_staff');
    if (rawDept) {
      const d = JSON.parse(rawDept);
      const active = d.hospitality || d.manager || d.restaurant || d.bar;
      if (active && (active.full_name || active.name || active.username)) {
        return (active.full_name || active.name || active.username).trim();
      }
    }
  } catch (e) {}
  return '';
}

/**
 * 2-per-A4 Customer Payment Receipt (RECEIPT)
 * Matches physical paper slip used at Hotel City Paark:
 * Centered RECEIPT, Diamond Logo + Hotel CityPaark branding,
 * Red serial No., guest name, sum in words, payment mode breakdown with UTR/Cheque/Cash,
 * multi-row table grid, Rs. box, Cheques subject to realization, For Hotel City Paark signature.
 */
export function printCashReceipt(receipt) {
  if (!receipt) return;
  const baseAmount = Number(receipt.amount !== undefined ? receipt.amount : receipt.total !== undefined ? receipt.total : receipt.advance_amount) || 0;
  const modeLower = String(receipt.payment_mode || receipt.paymentMode || receipt.mode || (receipt.split_online > 0 ? 'upi' : receipt.split_card > 0 ? 'card' : receipt.split_cheque > 0 ? 'cheque' : 'cash')).toLowerCase();

  const cardSurcharge = Number(receipt.card_surcharge || receipt.cardSurcharge) || (modeLower.includes('card') ? Math.round(baseAmount * 0.025) : 0);
  const upiTax = Number(receipt.upi_tax || receipt.upiTax) || (modeLower.includes('upi') || modeLower.includes('online') ? (baseAmount > 2000 ? Math.round(baseAmount * 0.004) : 0) : 0);

  let finalTotalAmount = baseAmount;
  if (modeLower.includes('card') && cardSurcharge > 0) {
    finalTotalAmount = baseAmount + cardSurcharge;
  } else if ((modeLower.includes('upi') || modeLower.includes('online')) && upiTax > 0) {
    finalTotalAmount = baseAmount + upiTax;
  }

  // Resolve cashier name: dynamically pick active cashier instead of generic 'Front Desk Cashier'
  let cashierName = receipt.cashier_name || receipt.cashier || receipt.collected_by || receipt.staff_name || receipt.logged_by || receipt.created_by || receipt.checked_in_by;
  if (!cashierName || cashierName.trim() === '' || cashierName === 'Front Desk Cashier' || cashierName === 'Front Desk') {
    const activeStaff = getActiveCashierName();
    cashierName = activeStaff || (cashierName && cashierName !== 'Front Desk Cashier' ? cashierName : 'Cashier');
  }

  // Sanitize particulars to eliminate "Room #" -> "Room "
  let particularsText = receipt.particulars || receipt.purpose || receipt.notes || receipt.description || (receipt.booking_id ? `Room Booking ${receipt.booking_id}` : 'Official Payment Receipt');
  if (typeof particularsText === 'string') {
    particularsText = particularsText.replace(/Room\s*#\s*/gi, 'Room ');
  }

  const rawRoom = receipt.room_numbers || receipt.room_number || receipt.roomNumber || receipt.room || '-';
  const cleanRoom = String(rawRoom).replace(/Room\s*#\s*/gi, 'Room ').replace(/^#/, '');

  const normalized = {
    receipt_no: receipt.receipt_no || receipt.receipt_number || receipt.id || '500',
    receipt_date: receipt.receipt_date || receipt.created_at || receipt.date || new Date(),
    guest_name: receipt.guest_name || receipt.guestName || receipt.payee || receipt.paid_to || receipt.customer_name || 'Valued Guest',
    amount: finalTotalAmount,
    base_amount: baseAmount,
    payment_mode: receipt.payment_mode || receipt.paymentMode || receipt.mode || 'Cash',
    cheque_no: receipt.cheque_no || receipt.chequeNo || '',
    bank_name: receipt.bank_name || receipt.chequeBank || receipt.bank || '',
    utr_number: receipt.utr_number || receipt.online_utr || receipt.onlineUtr || receipt.utr || '',
    split_cash: receipt.split_cash,
    split_online: receipt.split_online,
    split_card: receipt.split_card,
    split_cheque: receipt.split_cheque,
    card_surcharge: cardSurcharge,
    upi_tax: upiTax,
    room_numbers: cleanRoom,
    particulars: particularsText,
    cashier_name: cashierName
  };
  return printAdvanceMoneyReceipt(normalized);
}

export function buildMoneyReceiptHTML(receipt) {
  let cashierName = receipt.cashier_name || receipt.cashier || receipt.collected_by || receipt.staff_name || receipt.logged_by || receipt.created_by || receipt.checked_in_by;
  if (!cashierName || cashierName.trim() === '' || cashierName === 'Front Desk Cashier' || cashierName === 'Front Desk') {
    const activeStaff = getActiveCashierName();
    cashierName = activeStaff || (cashierName && cashierName !== 'Front Desk Cashier' ? cashierName : 'Cashier');
  }
  const formattedDateTimeStr = formatReceiptDateTime(receipt.receipt_date || receipt.created_at || receipt.date);
  const formattedDate = formattedDateTimeStr;

  const rawMode = String(receipt.payment_mode || receipt.paymentMode || receipt.mode || (receipt.split_online > 0 ? 'upi' : receipt.split_card > 0 ? 'card' : receipt.split_cheque > 0 ? 'cheque' : 'cash')).toLowerCase();
  const utr = (receipt.utr_number || receipt.online_utr || receipt.onlineUtr || receipt.utr || '').trim();
  const chqNo = (receipt.cheque_no || receipt.chequeNo || '').trim();
  const bankName = (receipt.bank_name || receipt.chequeBank || receipt.bank || '').trim();

  const baseAmt = receipt.base_amount !== undefined ? Number(receipt.base_amount) : (Number(receipt.amount) || 0);

  // Dynamic Card surcharge & UPI tax calculation
  let cardSurcharge = Number(receipt.card_surcharge || receipt.cardSurcharge) || 0;
  if (!cardSurcharge && (rawMode.includes('card') || rawMode.includes('pos'))) {
    cardSurcharge = baseAmt > 0 ? Math.round(baseAmt * 0.025) : 0;
  }
  let upiTax = Number(receipt.upi_tax !== undefined ? receipt.upi_tax : receipt.upiTax) || 0;
  if (!upiTax && (rawMode.includes('upi') || rawMode.includes('online'))) {
    upiTax = baseAmt > 2000 ? Math.round(baseAmt * 0.004) : 0;
  }

  let finalDisplayAmount = baseAmt;
  let dynamicModeLabel = 'by Cash';
  let dynamicModeValue = `₹ ${baseAmt.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

  if (rawMode.includes('upi') || rawMode.includes('online')) {
    dynamicModeLabel = 'by Online UPI';
    finalDisplayAmount = baseAmt + upiTax;
    const feeInfo = upiTax > 0 ? ` (₹${baseAmt.toLocaleString('en-IN')} + ₹${upiTax} Fee)` : '';
    const utrInfo = utr ? ` [UTR: ${utr}]` : '';
    dynamicModeValue = `₹ ${finalDisplayAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}${feeInfo}${utrInfo}`;
  } else if (rawMode.includes('card') || rawMode.includes('pos')) {
    dynamicModeLabel = 'by Card POS';
    finalDisplayAmount = baseAmt + cardSurcharge;
    const feeInfo = cardSurcharge > 0 ? ` (₹${baseAmt.toLocaleString('en-IN')} + ₹${cardSurcharge} Fee)` : '';
    dynamicModeValue = `₹ ${finalDisplayAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}${feeInfo}`;
  } else if (rawMode.includes('cheque') || rawMode.includes('check')) {
    dynamicModeLabel = 'by Cheque';
    finalDisplayAmount = baseAmt;
    dynamicModeValue = `Cheque No: ${chqNo || '-'}${bankName ? ` (${bankName})` : ''} — ₹ ${baseAmt.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  } else if (rawMode.includes('btc') || rawMode.includes('company')) {
    dynamicModeLabel = 'by Corporate (BTC)';
    finalDisplayAmount = baseAmt;
    dynamicModeValue = `Company Credit Ledger — ₹ ${baseAmt.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  } else {
    // Cash: Strictly single mode without "Cash / Cheque"
    dynamicModeLabel = 'by Cash';
    finalDisplayAmount = baseAmt;
    dynamicModeValue = `₹ ${baseAmt.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  }

  const amtWords = amountToWordsIndian(finalDisplayAmount);

  // Sanitize particulars to eliminate "Room #" -> "Room "
  const rawParticulars = receipt.particulars || receipt.purpose || receipt.notes || receipt.description || (receipt.booking_id ? `Room Booking ${receipt.booking_id}` : 'Official Payment Receipt');
  const cleanParticulars = String(rawParticulars).replace(/Room\s*#\s*/gi, 'Room ');

  const tableRows = [];
  if (rawMode.includes('card') && cardSurcharge > 0) {
    tableRows.push({
      desc: `${cleanParticulars} (Card POS: ₹${finalDisplayAmount.toLocaleString('en-IN')} [₹${baseAmt.toLocaleString('en-IN')} + ₹${cardSurcharge} Fee])`,
      amt: finalDisplayAmount
    });
  } else if ((rawMode.includes('upi') || rawMode.includes('online')) && upiTax > 0) {
    tableRows.push({
      desc: `${cleanParticulars} (Online UPI: ₹${finalDisplayAmount.toLocaleString('en-IN')} [₹${baseAmt.toLocaleString('en-IN')} + ₹${upiTax} Fee]${utr ? ` - UTR: ${utr}` : ''})`,
      amt: finalDisplayAmount
    });
  } else if (rawMode.includes('cheque') || rawMode.includes('check')) {
    tableRows.push({
      desc: `${cleanParticulars} (Cheque #${chqNo || '-'}${bankName ? ` - ${bankName}` : ''})`,
      amt: finalDisplayAmount
    });
  } else {
    tableRows.push({
      desc: `${cleanParticulars} (Cash Payment)`,
      amt: finalDisplayAmount
    });
  }

  while (tableRows.length < 2) {
    tableRows.push({ desc: '&nbsp;', amt: null });
  }

  const tableRowsHtml = tableRows
    .map(
      (r) => `
      <tr>
        <td style="padding: 4px 8px; border-right: 1.5px solid #000; border-bottom: 1.5px solid #000;">${r.desc}</td>
        <td style="padding: 4px 8px; border-bottom: 1.5px solid #000; text-align: right; font-weight: ${r.amt !== null ? '900' : 'normal'};">
          ${r.amt !== null ? `₹ ${parseFloat(r.amt).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '&nbsp;'}
        </td>
      </tr>
    `
    )
    .join('');

  const rawReceiptNo = receipt.receipt_no || receipt.receipt_number || (() => {
    const now = new Date();
    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const ymd = `${yy}${mm}${dd}`;
    return receipt.id ? `${ymd}-${String(receipt.id).padStart(3, '0')}` : `${ymd}-001`;
  })();

  const formattedReceiptNo = formatReceiptNumberWithMode(rawReceiptNo, rawMode);

  const renderReceiptCard = (copyLabel) => `
    <div class="half-a4-receipt-card" style="position: relative; overflow: hidden;">
      <!-- Elegant Watermark Crest (Without Name) -->
      <div class="receipt-watermark" style="position: absolute; top: 52%; left: 50%; transform: translate(-50%, -50%); opacity: 0.055; pointer-events: none; z-index: 0; text-align: center;">
        <img src="/hcp-logo-without-name.png" alt="" style="width: 145px; height: auto;" loading="eager" decoding="sync" />
      </div>

      <!-- Header Row -->
      <div class="receipt-header-row" style="position: relative; z-index: 1;">
        <!-- Center / Left: Doc Title & Serial No / Date (Stacked vertically: Date below No.) -->
        <div style="flex: 1; display: flex; flex-direction: column; justify-content: space-between; padding-right: 16px;">
          <div style="display: flex; align-items: baseline; gap: 14px;">
            <h2 class="receipt-doc-title">RECEIPT</h2>
            <div class="receipt-copy-tag">${copyLabel}</div>
          </div>
          <div style="display: flex; flex-direction: column; gap: 4px; margin-top: 5px;">
            <div class="receipt-no-badge" style="display: flex; align-items: center;">
              <span style="color: #000000; font-size: 13pt; font-weight: 900; margin-right: 4px;">No.</span>
              <span class="receipt-no-highlight">${escapeHtml(formattedReceiptNo)}</span>
            </div>
            <div style="font-size: 9.5pt; font-weight: 900; display: flex; align-items: center; gap: 5px; margin-top: 1px;">
              <span style="color: #000000;">Date:</span>
              <span class="receipt-date-highlight" style="min-width: 150px; text-align: center;">${escapeHtml(formattedDateTimeStr)}</span>
            </div>
          </div>
        </div>

        <!-- Right: Logo With Name (Enlarged by 50%) + Full Solapur Address -->
        <div class="receipt-brand" style="text-align: right; display: flex; flex-direction: column; align-items: flex-end;">
          <img src="/hcp-logo-with-name.png" alt="Hotel CityPaark" class="receipt-brand-logo-img" style="height: 54px; max-height: 54px; width: auto; max-width: 195px; object-fit: contain; display: block;" loading="eager" decoding="sync" />
          <div style="font-size: 8pt; color: #1e3a8a; margin: 1px 0;"><span style="text-transform: lowercase; font-weight: 600;">by</span> <strong style="letter-spacing: 0.5px;">JMG HOSPITALITY AND INFRA LLP</strong></div>
          <div class="receipt-address-text">
            119, Murarji Peth, Char Hutatma Chowk, Solapur - 413 001<br>
            <img src="/phone-call.png" alt="" style="width: 10px; height: 10px; object-fit: contain; vertical-align: -1px; display: inline-block;" loading="eager" decoding="sync" /> : 0217-2729791, 92, 93, 9960013388<br>
            E-mail : hcitypark@rediffmail.com • website : hotelcityparksolapur.com
          </div>
        </div>
      </div>

      <!-- Printed Underlined Body Lines -->
      <div class="receipt-body-content">
        <div class="receipt-line-row">
          <span class="receipt-lbl">Received with thanks from</span>
          <span class="receipt-fill-line">${escapeHtml(receipt.guest_name || '-')}</span>
        </div>

        <div class="receipt-line-row">
          <span class="receipt-lbl">the sum of Rupees</span>
          <span class="receipt-fill-line" style="font-style: italic;">${escapeHtml(amtWords)}</span>
        </div>

        <div class="receipt-line-row">
          <span class="receipt-lbl">${escapeHtml(dynamicModeLabel)}</span>
          <span class="receipt-fill-line">${escapeHtml(dynamicModeValue)}</span>
          <span class="receipt-lbl" style="margin-left: 14px;">Room No.</span>
          <span class="receipt-fill-line" style="max-width: 110px; text-align: center;">${escapeHtml(String(receipt.room_numbers || '-').replace(/Room\s*#\s*/gi, 'Room ').replace(/^#/, ''))}</span>
        </div>

        <!-- Multi-Row Ruled Table Grid -->
        <div class="receipt-table-section">
          <table class="receipt-mini-table">
            <thead>
              <tr>
                <th style="width: 60%; font-weight: 900;">Bill No</th>
                <th style="width: 40%; font-weight: 900; text-align: right;">Amount</th>
              </tr>
            </thead>
            <tbody>
              ${tableRowsHtml}
            </tbody>
          </table>
        </div>

        <!-- Footer Section -->
        <div class="receipt-footer-row">
          <div class="receipt-amount-badge-box">
            <div class="receipt-rs-box">
              <span style="font-size: 11pt; font-weight: 900; margin-right: 6px;">Rs.</span>
              <span style="font-size: 14pt; font-weight: 950;">₹ ${parseFloat(finalDisplayAmount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
            </div>
            <div class="receipt-disclaimer">* Cheques subject to realization</div>
          </div>
          <div class="receipt-signature-box">
            <div class="receipt-cashier-name">${escapeHtml(cashierName)}</div>
            <div class="receipt-sig-line"></div>
            <div class="receipt-sig-label">For HOTEL CITY PARK</div>
          </div>
        </div>
      </div>
    </div>
  `;

  return `
    ${renderReceiptCard('ORIGINAL (GUEST COPY)')}
    <div class="two-per-a4-perforation">
      - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - ✂ PERFORATION CUT LINE ✂ - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
    </div>
    ${renderReceiptCard('HOTEL ACCOUNTS COPY')}
  `;
}

export function printAdvanceMoneyReceipt(receipt) {
  const sheet = document.getElementById('print-money-receipt-sheet');
  if (!sheet) {
    console.warn('print-money-receipt-sheet element not found in DOM');
    return;
  }

  const exitThemeIsolation = enterPrintThemeIsolation();

  sheet.innerHTML = buildMoneyReceiptHTML(receipt);

  sheet.style.display = 'flex';
  sheet.classList.add('print-active');
  document.body.classList.add('print-sheet-active');

  const cleanup = () => {
    sheet.classList.remove('print-active');
    sheet.style.display = 'none';
    document.body.classList.remove('print-sheet-active');
    window.removeEventListener('afterprint', cleanup);
    exitThemeIsolation();
  };
  window.addEventListener('afterprint', cleanup, { once: true });

  requestAnimationFrame(() => {
    setTimeout(() => {
      window.print();
      setTimeout(cleanup, 2500);
    }, 40);
  });
}

/**
 * 2-per-A4 Petty Cash / Cash Voucher
 * Matches physical debit slip used at Hotel City Paark:
 * Diamond logo + Hotel CityPaark Solapur 413001,
 * Petty Cash / Cash Voucher No. & Date,
 * Debit _____ A/c., Rupees (in words), Paid to, Being,
 * Particulars ruled table with Rs. and Ps. columns + Total,
 * Cash / Cheques No. _____ Bank _____,
 * 4 signatures: Accountant | Manager | Managing Director | Receivers Signature (stamp box).
 */
export function printPettyCashVoucher(voucher) {
  if (!voucher) return;
  const formattedDate = voucher.expense_date || voucher.created_at
    ? new Date(voucher.expense_date || voucher.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : new Date().toLocaleDateString('en-IN');
  const amount = Number(voucher.amount) || 0;
  const amtWords = amountToWordsIndian(amount);
  const rupees = Math.floor(amount);
  const paise = Math.round((amount - rupees) * 100).toString().padStart(2, '0');

  const sheet = document.getElementById('print-petty-cash-sheet');
  if (!sheet) {
    console.warn('print-petty-cash-sheet element not found in DOM');
    return;
  }

  const isRefund = voucher.category === 'refund' || (voucher.title && String(voucher.title).toLowerCase().includes('refund')) || (voucher.description && String(voucher.description).toLowerCase().includes('refund'));
  
  // Format petty cash voucher number starting sequentially from PCV-1 (e.g. PCV-1, PCV-2, PCV-3...)
  let voucherNo = voucher.voucher_no || voucher.voucher_number || voucher.voucherNo || '';
  if (!voucherNo) {
    voucherNo = voucher.id ? `PCV-${voucher.id}` : 'PCV-1';
  } else if (typeof voucherNo === 'string' && voucherNo.startsWith('PCV-')) {
    // Already in PCV-X format
  } else if (/^\d{8}-\d+$/.test(String(voucherNo).trim())) {
    const parts = String(voucherNo).trim().split('-');
    const seq = parts[1] ? parseInt(parts[1], 10) : (voucher.id || 1);
    voucherNo = `PCV-${seq}`;
  } else if (/^\d+$/.test(String(voucherNo).trim())) {
    voucherNo = `PCV-${parseInt(voucherNo, 10)}`;
  } else if (/^PCV?-?(\d+)$/i.test(String(voucherNo).trim())) {
    const match = String(voucherNo).trim().match(/^PCV?-?(\d+)$/i);
    voucherNo = `PCV-${parseInt(match[1], 10)}`;
  } else if (/^REF-?(\d+)$/i.test(String(voucherNo).trim())) {
    const match = String(voucherNo).trim().match(/^REF-?(\d+)$/i);
    voucherNo = `PCV-${parseInt(match[1], 10)}`;
  } else {
    voucherNo = `PCV-${voucherNo}`;
  }

  const debitAc = voucher.debit_account || voucher.debitAccount || (isRefund ? 'Guest Refund' : (voucher.category || 'Petty Cash'));
  const paidTo = voucher.paid_to || voucher.paidTo || voucher.payee || voucher.guest_name || '-';
  const being = voucher.purpose_details || voucher.purpose || voucher.description || voucher.title || voucher.notes || (isRefund ? 'Guest Stay / Booking Refund' : 'General Expense');
  
  const mode = String(voucher.payment_mode || voucher.paymentMode || 'cash').toLowerCase();
  const isCash = mode === 'cash';
  const isUpi = mode === 'online' || mode === 'upi';
  const isCheque = mode === 'cheque';
  const utrNo = voucher.utr_number || voucher.utrNumber || voucher.utr || (isUpi ? (voucher.cheque_no || voucher.chequeNo || '') : '');
  const chqNo = voucher.cheque_no || voucher.chequeNo || '';
  const bankName = voucher.bank_name || voucher.bankName || voucher.bank || '-';

  const renderVoucherCard = (copyLabel) => `
    <div class="half-a4-voucher-card" style="position: relative; overflow: hidden;">
      <!-- Elegant Watermark Crest (Without Name) -->
      <div class="voucher-watermark" style="position: absolute; top: 52%; left: 50%; transform: translate(-50%, -50%); opacity: 0.055; pointer-events: none; z-index: 0; text-align: center;">
        <img src="/hcp-logo-without-name.png" alt="" style="width: 145px; height: auto;" loading="eager" decoding="sync" />
      </div>

      <!-- Voucher Header -->
      <div class="voucher-header-row" style="position: relative; z-index: 1;">
        <!-- Left: Official Crest (Without Name) + HOTEL CityPaark typography + Solapur 413001 Address -->
        <div class="voucher-brand-col">
          <div class="voucher-hotel-logo" style="display: flex; align-items: center; gap: 8px;">
            <img src="/HCP New Logo Png_witought-name.png" alt="Hotel CityPaark" class="voucher-brand-logo-img" style="height: 38px; width: auto; object-fit: contain;" loading="eager" decoding="sync" />
            <div class="hotel-title-text" style="line-height: 1;">
              <span class="hotel-sub" style="font-size: 7.5pt; letter-spacing: 0.22em; font-weight: 800; display: block;">HOTEL</span>
              <span class="hotel-main" style="font-size: 17pt; font-weight: 900; font-family: Georgia, serif;">CityPaark</span>
              <span style="font-size: 7pt; color: #1e3a8a; display: block; margin-top: 1px;"><span style="text-transform: lowercase; font-weight: 600;">by</span> <strong style="letter-spacing: 0.5px;">JMG HOSPITALITY AND INFRA LLP</strong></span>
            </div>
          </div>
          <div class="voucher-address-top" style="font-size: 7.5pt; font-weight: 800; margin-top: 4px; color: #000000;">
            ■ 119, MURARJI PETH, CHAR HUTATMA CHOWK, SOLAPUR - 413 001.
          </div>
        </div>

        <!-- Right: Cash Voucher No. & Date with Highlights -->
        <div class="voucher-title-col">
          <div class="voucher-heading-badge">
            Cash Voucher No. <span class="voucher-no-highlight">${escapeHtml(voucherNo)}</span>
          </div>
          <div class="voucher-date-text">
            Date: <span class="voucher-date-highlight">${formattedDate}</span>
            <span class="voucher-copy-tag">${copyLabel}</span>
          </div>
        </div>
      </div>

      <!-- Underlined Body Lines -->
      <div class="voucher-body-content">
        <div class="voucher-line-row">
          <span class="voucher-lbl">Debit</span>
          <span class="voucher-fill-line">${escapeHtml(debitAc)}</span>
          <span class="voucher-lbl">A/c.</span>
        </div>
        <div class="voucher-line-row">
          <span class="voucher-lbl">Rupees</span>
          <span class="voucher-fill-line" style="font-style: italic;">${escapeHtml(amtWords)}</span>
        </div>
        <div class="voucher-line-row">
          <span class="voucher-lbl">Paid to</span>
          <span class="voucher-fill-line">${escapeHtml(paidTo)}</span>
        </div>
        <div class="voucher-line-row">
          <span class="voucher-lbl">Being</span>
          <span class="voucher-fill-line">${escapeHtml(being)}</span>
        </div>

        <!-- Ruled Particulars Table with Rs. and Ps. columns -->
        <div class="voucher-table-wrap">
          <table class="voucher-mini-table">
            <thead>
              <tr>
                <th rowspan="2" style="width: 72%; font-weight: 900; vertical-align: middle;">Particulars / Purpose</th>
                <th colspan="2" style="width: 28%; font-weight: 900; text-align: center; border-bottom: 1px solid #000;">Amount</th>
              </tr>
              <tr>
                <th style="width: 19%; text-align: right; font-weight: 900;">Rs.</th>
                <th style="width: 9%; text-align: center; font-weight: 900;">Ps.</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style="font-weight: 750;">${escapeHtml(being)}</td>
                <td style="font-weight: 900; text-align: right;">${rupees.toLocaleString('en-IN')}</td>
                <td style="text-align: center; font-weight: 800;">${paise}</td>
              </tr>
              <tr class="voucher-total-row">
                <td style="font-weight: 900; text-align: right;">Total</td>
                <td style="font-weight: 950; text-align: right;">${rupees.toLocaleString('en-IN')}</td>
                <td style="text-align: center; font-weight: 900;">${paise}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Payment Details Line: No Cheque No if cash, UTR for UPI, Cheque & Bank for Cheque -->
        <div class="voucher-chq-row">
          ${isCash ? `
            <span>Payment Mode: <span class="voucher-underlined" style="font-weight: 900; padding: 0 16px;">CASH</span></span>
          ` : isUpi ? `
            <span>Payment Mode: <span class="voucher-underlined" style="font-weight: 850;">ONLINE / UPI</span></span>
            <span style="margin-left: 24px;">UTR No. <span class="voucher-underlined" style="font-weight: 900;">${escapeHtml(utrNo || '-')}</span></span>
          ` : isCheque ? `
            <span>Cheque No. <span class="voucher-underlined" style="font-weight: 900;">${escapeHtml(chqNo || '-')}</span></span>
            <span style="margin-left: 24px;">Bank <span class="voucher-underlined" style="font-weight: 900;">${escapeHtml(bankName)}</span></span>
          ` : `
            <span>Payment Mode: <span class="voucher-underlined" style="font-weight: 850;">${escapeHtml(mode.toUpperCase())}</span></span>
            ${chqNo ? `<span style="margin-left: 24px;">Ref No. <span class="voucher-underlined">${escapeHtml(chqNo)}</span></span>` : ''}
          `}
        </div>

        <!-- 4 Signatures Grid -->
        <div class="voucher-sig-grid">
          <div class="voucher-sig-item">
            <div class="sig-line"></div>
            <span>Accountant</span>
          </div>
          <div class="voucher-sig-item">
            <div class="sig-line"></div>
            <span>Manager</span>
          </div>
          <div class="voucher-sig-item">
            <div class="sig-line"></div>
            <span>Managing Director</span>
          </div>
          <div class="voucher-sig-item">
            <div class="voucher-square-box"></div>
            <span>Receivers Signature</span>
          </div>
        </div>
      </div>
    </div>
  `;

  const exitThemeIsolation = enterPrintThemeIsolation();

  sheet.innerHTML = `
    ${renderVoucherCard('ORIGINAL COPY')}
    <div class="two-per-a4-perforation">
      - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - ✂ PERFORATION CUT LINE ✂ - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
    </div>
    ${renderVoucherCard('ACCOUNTS DUPLICATE')}
  `;

  sheet.style.display = 'flex';
  sheet.classList.add('print-active');
  document.body.classList.add('print-sheet-active');

  const cleanup = () => {
    sheet.classList.remove('print-active');
    sheet.style.display = 'none';
    document.body.classList.remove('print-sheet-active');
    window.removeEventListener('afterprint', cleanup);
    exitThemeIsolation();
  };
  window.addEventListener('afterprint', cleanup, { once: true });

  requestAnimationFrame(() => {
    setTimeout(() => {
      window.print();
      setTimeout(cleanup, 2500);
    }, 40);
  });
}

/**
 * Full A4 Guest Registration Card & Check-In Form Print
 * Generates an official, beautiful A4 registration document with:
 * - Top official Logo (with name) & Solapur contact information
 * - Subtle background light watermark (without name)
 * - Monthly sequence voucher / form number (YYYYMMDD-SR) and highlighted bill date
 * - Primary guest details with auto-calculated age from DOB, Aadhar/ID number, photo and ID scans
 * - Combined room details ("people lived in"), total occupants, extra beds
 * - Other room members / companions list with scanned front/back document thumbnails
 * - Itemized billing breakdown (tariff net, discount, 5% GST, grand total, advance paid, remaining due)
 * - Split payment tracking with UPI UTR number enforcement
 * - Legal declaration and guest / cashier signatures
 */
export const getIdNumberLabel = (docType) => {
  const dt = (docType || '').toLowerCase().trim();
  if (dt.includes('passport')) return 'Passport No:';
  if (dt.includes('licen') || dt.includes('driving') || dt.includes('dl')) return 'Driving License No:';
  if (dt.includes('aadha') || dt.includes('adhar')) return 'Aadhaar No:';
  if (dt.includes('voter')) return 'Voter ID No:';
  if (dt.includes('pan')) return 'PAN No:';
  return `${docType || 'ID Document'} No:`;
};

export function buildGuestRegistrationHTML(data, options = { includePhotos: false }) {
  if (!data) return '';

  const includePhotos = Boolean(options?.includePhotos);

  const formatDT = (dt) => {
    if (!dt) return '-';
    try {
      const d = new Date(dt);
      if (isNaN(d.getTime())) return String(dt);
      return d.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      }) + ' ' + d.toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
    } catch (e) {
      return String(dt);
    }
  };

  const calculateAge = (dobStr) => {
    if (!dobStr) return '';
    try {
      const birthDate = new Date(dobStr);
      if (isNaN(birthDate.getTime())) return '';
      const today = new Date();
      let age = today.getFullYear() - birthDate.getFullYear();
      const m = today.getMonth() - birthDate.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
        age--;
      }
      return age > 0 ? `${age} Yrs` : '';
    } catch (e) {
      return '';
    }
  };

  // 1. Primary Guest Details
  const guestName = data.guestName || data.guest_name || 'Valued Guest';
  const mobile = data.mobile || data.guest_phone || data.phone || data.mobile_number || '-';
  const altMobile = data.altMobile || data.alt_mobile || data.booking_alt_mobile || data.mobile_alt || '';
  const fatherName = data.fatherName || data.father_name || '-';
  const dob = data.dob || data.date_of_birth || '';
  const calculatedAge = (data.age ? `${data.age} Yrs` : calculateAge(dob)) || '';
  const aadharNumber = (
    data.aadharNumber ||
    data.aadhar_number ||
    data.aadharNo ||
    data.aadhar_no ||
    data.idNumber ||
    data.id_number ||
    data.idNo ||
    data.id_no ||
    data.docNumber ||
    data.doc_number ||
    (data.room && (data.room.aadhar_number || data.room.aadharNumber || data.room.id_number || data.room.idNumber)) ||
    (data.guest && (data.guest.aadhar_number || data.guest.aadharNumber || data.guest.id_number || data.guest.idNumber)) ||
    ''
  ).trim();
  const docType = data.docType || data.doc_type || (data.room && data.room.doc_type) || (data.guest && data.guest.doc_type) || 'Aadhaar Card';
  const idLabel = getIdNumberLabel(docType);
  const address = (
    data.address ||
    data.guest_address ||
    data.guestAddress ||
    data.permanentAddress ||
    data.permanent_address ||
    data.residential_address ||
    data.full_address ||
    (data.room && (data.room.address || data.room.guest_address)) ||
    (data.guest && (data.guest.address || data.guest.guest_address)) ||
    '-'
  );
  const email = (
    data.email ||
    data.guest_email ||
    data.guestEmail ||
    data.emailAddress ||
    data.email_address ||
    (data.room && (data.room.email || data.room.guest_email)) ||
    (data.guest && (data.guest.email || data.guest.guest_email)) ||
    '-'
  );
  const bookingSource = data.bookingSource || data.booking_source || (data.room && (data.room.booking_source || data.room.source)) || 'Walk-in';
  const btcCompanyName = data.btcCompanyName || data.btc_company_name || (data.room && (data.room.btc_company_name || data.room.btcCompanyName)) || '';
  const btcApprovalRef = data.btcApprovalRef || data.btc_approval_ref || (data.room && (data.room.btc_approval_ref || data.room.btcApprovalRef)) || '';
  const companyName = String(data.companyName || data.company_name || (data.room && (data.room.company_name || data.room.companyName)) || '').trim();
  const gstNumber = String(data.gstNumber || data.gst_number || (data.room && (data.room.gst_number || data.room.gstNumber)) || '').trim();
  const btcCompanyAddress = String(
    data.btcCompanyAddress ||
    data.btc_address ||
    data.companyAddress ||
    data.company_address ||
    (data.room && (data.room.btc_address || data.room.btcCompanyAddress || data.room.company_address)) ||
    ''
  ).trim();
  const btcGstNumber = String(
    data.btcGstNumber ||
    data.btc_gst_number ||
    data.btcCompanyGst ||
    gstNumber ||
    (data.room && (data.room.btc_gst_number || data.room.gst_number || data.room.gstNumber)) ||
    ''
  ).trim();
  const btcPanNumber = String(
    data.btcPanNumber ||
    data.btc_pan_number ||
    data.panNumber ||
    data.pan_number ||
    (data.room && (data.room.btc_pan_number || data.room.pan_number)) ||
    ''
  ).trim();
  const btcContactPerson = String(
    data.btcContactPerson ||
    data.btc_contact_person ||
    data.contactPerson ||
    data.contact_person ||
    (data.room && (data.room.btc_contact_person || data.room.contact_person)) ||
    ''
  ).trim();
  const btcContactPhone = String(
    data.btcContactPhone ||
    data.btc_contact_phone ||
    data.contactPhone ||
    data.contact_phone ||
    (data.room && (data.room.btc_contact_phone || data.room.contact_phone)) ||
    ''
  ).trim();
  const btcContactEmail = String(
    data.btcContactEmail ||
    data.btc_contact_email ||
    data.contactEmail ||
    data.contact_email ||
    (data.room && (data.room.btc_contact_email || data.room.contact_email)) ||
    ''
  ).trim();
  const otaPlatform = data.otaPlatform || data.ota_platform || (data.room && (data.room.ota_platform || data.room.otaPlatform)) || '';
  const otaBookingId = String(
    data.otaBookingId ||
    data.ota_booking_id ||
    data.otaVoucherNo ||
    data.ota_voucher_no ||
    data.otaRef ||
    data.ota_ref ||
    (data.room && (data.room.ota_booking_id || data.room.otaBookingId || data.room.otaVoucherNo || data.room.ota_voucher_no)) ||
    ''
  ).trim();
  const rateType = data.rateType || data.rate_type || (data.room && (data.room.rate_type || data.room.rateType)) || '';

  const isOccupiedStay = Boolean(data.isOccupiedStay || data.stayStatus === 'OCCUPIED' || data.status === 'occupied' || (data.room && data.room.status === 'occupied'));
  const isOta = Boolean(bookingSource === 'OTA' || data.booking_source === 'OTA' || otaPlatform);
  const isBtc = Boolean(
    bookingSource.toLowerCase().includes('btc') ||
    bookingSource.toLowerCase().includes('corporate') ||
    btcCompanyName ||
    data.btc_company_id ||
    data.btcCompanyId ||
    data.is_btc_pending ||
    data.isBtcPending ||
    data.payment_status === 'pending_from_company' ||
    (data.room && (data.room.btc_company_id || data.room.is_btc_pending))
  );
  const isBtcPending = Boolean(
    data.is_btc_pending ||
    data.isBtcPending ||
    data.payment_status === 'pending_from_company' ||
    (isBtc && (data.payment_status !== 'settled' && data.payment_status !== 'paid'))
  );
  const effectiveBtcCompany = (btcCompanyName || companyName || 'CORPORATE CLIENT').trim();
  const isWebsite = Boolean(bookingSource.toLowerCase().includes('website') || bookingSource.toLowerCase().includes('web'));
  const isOtaPayAtHotel = isOta && (
    rateType === 'pay_at_hotel' ||
    rateType === 'postpaid' ||
    data.is_prepaid === 0 ||
    data.is_prepaid === '0' ||
    data.is_prepaid === false ||
    data.isPrepaid === false ||
    data.otaIsPrepaid === false ||
    (data.room && (data.room.is_prepaid === 0 || data.room.is_prepaid === '0' || data.room.is_prepaid === false))
  );
  const isOtaPrepaid = isOta && !isOtaPayAtHotel;

  // 2. Voucher / Form Number & Dates
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const yymmdd = `${yy}${mm}${dd}`;
  const rawVoucherNo = data.voucher_number || data.voucherNumber || data.voucher_no || data.voucherNo || `${yymmdd}-001`;
  const voucherNo = cleanVoucherNumber(rawVoucherNo);
  const checkinTime = data.checkinTime || data.checkin_time || now;
  const checkinFormatted = formatDT(checkinTime);
  const checkoutTime = data.approxCheckout || data.approx_checkout_time || data.actual_checkout_time || data.checkout_time || '';
  const checkoutFormatted = checkoutTime ? formatDT(checkoutTime) : 'Not specified';
  const stayNights = data.stayNights || data.stay_nights || 1;
  const isEarlyCheckin = Boolean(data.isEarlyCheckin || data.is_early_checkin);
  const originalCheckinTime = data.originalCheckinTime || data.original_checkin_time || '12:00 PM';
  const earlyCheckinTime = data.earlyCheckinTime || data.early_checkin_time || '';

  // 3. Combined Rooms & Occupants ("people lived in")
  const allAllocated = [data.room, ...(data.additionalRooms || [])].filter(Boolean);
  let roomsList = [];
  if (Array.isArray(data.all_group_rooms) && data.all_group_rooms.length > 0) {
    roomsList = data.all_group_rooms;
  } else if (Array.isArray(data.group_room_details) && data.group_room_details.length > 0) {
    roomsList = data.group_room_details;
  } else if (allAllocated.length > 0) {
    roomsList = allAllocated;
  } else {
    roomsList = [{ room_number: data.roomNumber || data.room_number, room_type: data.roomType || data.room_type }];
  }

  // User requirement: Clean room format e.g. "Rooms 101, 102, 103" or "Room 101"
  const roomNums = roomsList.map((r) => {
    if (typeof r === 'string' || typeof r === 'number') return String(r).replace(/^Room\s*#?/i, '').trim();
    return String(r.room_number || r.roomNumber || r.number || r.room || '-').replace(/^Room\s*#?/i, '').trim();
  }).filter(Boolean);

  const cleanRoomsText = roomNums.length > 1
    ? `Rooms ${roomNums.join(', ')}`
    : `Room ${roomNums[0] || '-'}`;

  const male = data.adultsMale !== undefined ? Number(data.adultsMale) : Number(data.adults_male || 1);
  const female = data.adultsFemale !== undefined ? Number(data.adultsFemale) : Number(data.adults_female || 0);
  const children = data.children !== undefined ? Number(data.children) : 0;
  const extraBeds = data.extraBeds !== undefined ? Number(data.extraBeds) : Number(data.extra_beds || 0);

  // OTA Booked (from OTA Voucher)
  const otaBookedAdults = isOta
    ? (data.otaBookedAdults !== undefined && data.otaBookedAdults !== null
        ? Number(data.otaBookedAdults)
        : (data.ota_booked_adults !== undefined && data.ota_booked_adults !== null
            ? Number(data.ota_booked_adults)
            : (data.room?.ota_booked_adults !== undefined && data.room?.ota_booked_adults !== null
                ? Number(data.room.ota_booked_adults)
                : 1)))
    : null;

  const otaBookedChildren = isOta
    ? (data.otaBookedChildren !== undefined && data.otaBookedChildren !== null
        ? Number(data.otaBookedChildren)
        : (data.ota_booked_children !== undefined && data.ota_booked_children !== null
            ? Number(data.ota_booked_children)
            : (data.room?.ota_booked_children !== undefined && data.room?.ota_booked_children !== null
                ? Number(data.room.ota_booked_children)
                : 0)))
    : null;

  const otaBookedExtraBeds = isOta
    ? (data.otaBookedExtraBeds !== undefined
        ? Number(data.otaBookedExtraBeds)
        : (data.ota_booked_extra_beds !== undefined
            ? Number(data.ota_booked_extra_beds)
            : (data.room?.ota_booked_extra_beds !== undefined
                ? Number(data.room.ota_booked_extra_beds)
                : 0)))
    : 0;

  // Hotel Extras (Booked / added at Hotel)
  const extraAdults = Number(data.extraAdults ?? data.extra_adults ?? data.room?.extra_adults ?? 0);
  const extraChildren = Number(data.extraChildren ?? data.extra_children ?? data.room?.extra_children ?? 0);

  const extraBedCharge = Number(data.extraBedCharge !== undefined ? data.extraBedCharge : (data.extra_bed_charge || (data.room && data.room.extra_bed_charge) || 0));
  const extraRoomsCharge = Number(data.extraRoomsCharge || data.extra_rooms_charge || (data.room && data.room.extra_rooms_charge) || 0);
  const extraBreakfastCharge = Number(data.extraBreakfastCharge || data.extra_breakfast_charge || (data.room && data.room.extra_breakfast_charge) || 0);

  const hotelChargedBeds = Number(
    data.hotelChargedBeds !== undefined
      ? data.hotelChargedBeds
      : (isOta
          ? (extraAdults > 0 ? extraAdults : (extraBedCharge > 0 ? Math.round(Number(extraBedCharge) / 500) : 0))
          : (extraBedCharge > 0 ? Math.round(Number(extraBedCharge) / 500) : 0))
  );

  const voucherIncludedBeds = Number(
    data.voucherIncludedBeds !== undefined
      ? data.voucherIncludedBeds
      : (isOta
          ? (otaBookedExtraBeds > 0 ? otaBookedExtraBeds : Math.max(0, extraBeds - hotelChargedBeds))
          : 0)
  );

  const totalAdults = male + female;

  // Extra member / extra person detection for accurate booking case categorization
  const hasExtraMembers = Boolean(
    extraBeds > 0 ||
    hotelChargedBeds > 0 ||
    extraAdults > 0 ||
    extraChildren > 0 ||
    data.hasExtraPersons ||
    data.has_extra_persons ||
    Number(data.extraAdults || 0) > 0 ||
    Number(data.extraChildren || 0) > 0 ||
    extraBedCharge > 0
  );

  // Meal Plan & Extra Bed description
  const rawMealPlan = String(data.mealPlan || data.meal_plan || (data.room && (data.room.meal_plan || data.room.mealPlan)) || 'room_only').toLowerCase();
  let mealPlanDisplay = 'Without Breakfast';
  if (rawMealPlan.includes('breakfast') || rawMealPlan === 'cp') {
    mealPlanDisplay = 'With Breakfast' + (isOta ? ' • OTA Pre-booked' : '');
  } else if (rawMealPlan.includes('map')) {
    mealPlanDisplay = 'Breakfast & Dinner' + (isOta ? ' • OTA Pre-booked' : '');
  } else if (rawMealPlan.includes('ap')) {
    mealPlanDisplay = 'All Meals Included' + (isOta ? ' • OTA Pre-booked' : '');
  }

  let stayBedDetailsText = 'Standard Room Allocation (No Extra Beds)';
  if (extraBeds > 0) {
    if (isOta) {
      if (hotelChargedBeds > 0 && voucherIncludedBeds > 0) {
        stayBedDetailsText = `${voucherIncludedBeds} Bed (OTA Included) + ${hotelChargedBeds} Bed (₹${extraBedCharge.toLocaleString('en-IN')} Hotel Added)`;
      } else if (hotelChargedBeds > 0) {
        stayBedDetailsText = `${hotelChargedBeds} Extra Bed${hotelChargedBeds > 1 ? 's' : ''} (₹${extraBedCharge.toLocaleString('en-IN')} Billed at Hotel • Not in OTA)`;
      } else {
        stayBedDetailsText = `${voucherIncludedBeds || extraBeds} Extra Bed${extraBeds > 1 ? 's' : ''} (Inclusive in OTA Package • ₹0 Extra)`;
      }
    } else {
      stayBedDetailsText = `${extraBeds} Extra Bed${extraBeds > 1 ? 's' : ''}${extraBedCharge > 0 ? ` (₹${extraBedCharge.toLocaleString('en-IN')})` : ''}`;
    }
  }

  // 4. Companion Room Members & Scanned Documents (Only for Digital PDF archive)
  let memberDocs = [];
  try {
    if (Array.isArray(data.memberDocuments)) memberDocs = data.memberDocuments;
    else if (Array.isArray(data.member_documents)) memberDocs = data.member_documents;
    else if (typeof data.member_documents_json === 'string' && data.member_documents_json.trim()) {
      memberDocs = JSON.parse(data.member_documents_json);
    }
  } catch (e) {
    memberDocs = [];
  }

  // 5. Billing & Payment Breakdown
  const tariffNet = Number(data.roomTariffNet !== undefined ? data.roomTariffNet : (data.netCharge !== undefined ? data.netCharge : (data.total_room_charge || 0)));
  const discountAmount = Number(data.discountAmount !== undefined ? data.discountAmount : (data.discount_amount || 0));
  const discountPct = Number(data.discountPct !== undefined ? data.discountPct : (data.discount_pct || 0));
  const taxAmount = Number(data.taxAmount !== undefined ? data.taxAmount : (data.tax_amount || Math.round(tariffNet * 0.05)));
  const foodTotal = Number(data.foodTotal !== undefined ? data.foodTotal : (data.summary?.foodTotal || 0));
  const barTotal = Number(data.barTotal !== undefined ? data.barTotal : (data.summary?.barTotal || 0));
  const fnbTotal = foodTotal + barTotal;
  const fnbPendingTotal = Number(data.foodPending !== undefined ? data.foodPending : (data.fnbPendingTotal !== undefined ? data.fnbPendingTotal : (data.summary?.fnbPendingTotal || 0)));

  const grandTotal = Number(data.totalDue !== undefined ? data.totalDue : (data.grandTotal !== undefined ? data.grandTotal : (tariffNet + taxAmount)));
  const totalPaid = Number(data.totalPaid !== undefined ? data.totalPaid : (data.initial_paid || data.advancePaid || 0));
  const balanceDue = Math.max(0, grandTotal - totalPaid);

  // Pre-booked OTA calculation & Hotel Extra Booking breakdown
  const otaPrebookedAmount = Number(
    data.otaBillAmount || 
    data.ota_bill_amount || 
    data.otaManualAmount || 
    data.ota_manual_amount || 
    (isOta ? tariffNet : 0)
  );

  const extensionCharge = Number(data.extensionCharge || data.extension_charge || (data.room && data.room.extension_charge) || 0);
  const hotelDeskCollected = totalPaid;

  // Total Extra Booking done at Hotel (Extra Beds, F&B, Extension, Extra Rooms, Extra Breakfast)
  let hotelExtrasTotal = extraBedCharge + fnbTotal + extensionCharge + extraRoomsCharge + extraBreakfastCharge;
  if (isOtaPrepaid && hotelDeskCollected > 0 && hotelExtrasTotal < hotelDeskCollected) {
    hotelExtrasTotal = hotelDeskCollected;
  }

  // Description of hotel extras
  const hotelExtrasParts = [];
  if (extraBedCharge > 0) hotelExtrasParts.push(`Extra Bed: ₹${extraBedCharge.toLocaleString('en-IN')}`);
  else if (hotelChargedBeds > 0) hotelExtrasParts.push(`Extra Bed: ₹${(hotelChargedBeds * 500).toLocaleString('en-IN')}`);
  if (fnbTotal > 0) hotelExtrasParts.push(`F&B: ₹${fnbTotal.toLocaleString('en-IN')}`);
  if (extensionCharge > 0) hotelExtrasParts.push(`Extension: ₹${extensionCharge.toLocaleString('en-IN')}`);
  if (extraRoomsCharge > 0) hotelExtrasParts.push(`Extra Room: ₹${extraRoomsCharge.toLocaleString('en-IN')}`);
  if (extraBreakfastCharge > 0) hotelExtrasParts.push(`Breakfast: ₹${extraBreakfastCharge.toLocaleString('en-IN')}`);
  const explicitExtrasSum = (extraBedCharge || (hotelChargedBeds * 500)) + fnbTotal + extensionCharge + extraRoomsCharge + extraBreakfastCharge;
  if (isOtaPrepaid && hotelDeskCollected > explicitExtrasSum) {
    hotelExtrasParts.push(`Other Extras: ₹${(hotelDeskCollected - explicitExtrasSum).toLocaleString('en-IN')}`);
  }
  if (hotelExtrasParts.length === 0 && hotelExtrasTotal > 0) hotelExtrasParts.push(`Hotel Extras: ₹${hotelExtrasTotal.toLocaleString('en-IN')}`);
  const hotelExtrasDesc = hotelExtrasParts.length > 0 ? hotelExtrasParts.join(' • ') : 'No Extra Charges';

  // Effective Total Booking Value:
  let effectiveTotalBooking = grandTotal;
  if (isOta) {
    effectiveTotalBooking = otaPrebookedAmount + hotelExtrasTotal + (isOtaPayAtHotel ? taxAmount : 0);
  }

  const prebookedCollected = isOtaPrepaid ? otaPrebookedAmount : 0;
  const combinedTotalCollected = prebookedCollected + hotelDeskCollected;

  // Balance Due / Net Remaining Calculation:
  let effectiveBalanceDue = balanceDue;
  if (isOtaPrepaid) {
    effectiveBalanceDue = Math.max(0, hotelExtrasTotal - hotelDeskCollected);
  } else if (isOtaPayAtHotel) {
    effectiveBalanceDue = Math.max(0, effectiveTotalBooking - hotelDeskCollected);
  } else {
    effectiveBalanceDue = balanceDue;
  }

  const splitCash = Number(data.splitCash !== undefined ? data.splitCash : (data.split_cash || 0));
  const splitCard = Number(data.splitCard !== undefined ? data.splitCard : (data.split_card || 0));
  const splitOnline = Number(data.splitOnline !== undefined ? data.splitOnline : (data.split_online || 0));
  const splitCheque = Number(data.splitCheque !== undefined ? data.splitCheque : (data.split_cheque || 0));
  const onlineUtr = (data.onlineUtr || data.utrNumber || data.utr_number || data.advance_utr_number || '').trim();
  const chequeNo = (data.chequeNo || data.cheque_no || data.advance_cheque_no || '').trim();
  const chequeBank = (data.chequeBank || data.bank_name || data.advance_cheque_bank || '').trim();

  const cardSurcharge = Number(data.card_surcharge !== undefined ? data.card_surcharge : (data.cardSurcharge !== undefined ? data.cardSurcharge : (data.room?.card_surcharge || data.room?.advance_card_surcharge || 0)));
  const upiTax = Number(data.upi_tax !== undefined ? data.upi_tax : (data.upiTax !== undefined ? data.upiTax : (data.room?.upi_tax || data.room?.advance_upi_tax || 0)));

  // If Card POS is used, calculate card fee (2.5%) if not already stored
  const effectiveCardFee = cardSurcharge > 0 ? cardSurcharge : (splitCard > 0 ? Math.round(splitCard * 0.025) : 0);

  // If Online UPI is used, UPI tax (0.4% default) applies if explicit or when splitOnline > 2000
  const effectiveUpiTax = upiTax > 0
    ? upiTax
    : (splitOnline > 2000 ? Math.round(splitOnline * 0.004) : 0);

  const splitBadges = [];
  if (splitCash > 0) {
    splitBadges.push(`<span style="background: #f0fdf4; border: 1.5px solid #86efac; color: #166534; padding: 3px 8px; border-radius: 4px; font-weight: 850; font-size: 9.5pt;">Cash: ₹ ${splitCash.toLocaleString('en-IN')}</span>`);
  }
  if (splitCard > 0) {
    const finalCard = splitCard + effectiveCardFee;
    splitBadges.push(`<span style="background: #fefce8; border: 1.5px solid #fde047; color: #854d0e; padding: 3px 8px; border-radius: 4px; font-weight: 850; font-size: 9.5pt;">Card POS: ₹ ${finalCard.toLocaleString('en-IN')}${effectiveCardFee > 0 ? ` (₹${splitCard.toLocaleString('en-IN')} + ₹${effectiveCardFee.toLocaleString('en-IN')} Fee)` : ''}</span>`);
  }
  if (splitOnline > 0) {
    const finalOnline = splitOnline + effectiveUpiTax;
    splitBadges.push(`<span style="background: #eff6ff; border: 1.5px solid #93c5fd; color: #1e40af; padding: 3px 8px; border-radius: 4px; font-weight: 850; font-size: 9.5pt;">Online UPI: ₹ ${finalOnline.toLocaleString('en-IN')}${effectiveUpiTax > 0 ? ` (₹${splitOnline.toLocaleString('en-IN')} + ₹${effectiveUpiTax.toLocaleString('en-IN')} Fee)` : ''}${onlineUtr ? ` [UTR: <strong>${escapeHtml(onlineUtr)}</strong>]` : ''}</span>`);
  }
  if (splitCheque > 0) {
    splitBadges.push(`<span style="background: #faf5ff; border: 1.5px solid #d8b4fe; color: #6b21a8; padding: 3px 8px; border-radius: 4px; font-weight: 850; font-size: 9.5pt;">Cheque: ₹ ${splitCheque.toLocaleString('en-IN')} (#${escapeHtml(chequeNo || '-')}${chequeBank ? ` ${escapeHtml(chequeBank)}` : ''})</span>`);
  }
  if (splitBadges.length === 0 && totalPaid > 0) {
    const rawMode = String(data.paymentMode || data.payment_mode || '').toLowerCase();
    if (rawMode.includes('card')) {
      const fee = effectiveCardFee > 0 ? effectiveCardFee : Math.round(totalPaid * 0.025);
      const finalCard = totalPaid + fee;
      splitBadges.push(`<span style="background: #fefce8; border: 1.5px solid #fde047; color: #854d0e; padding: 3px 8px; border-radius: 4px; font-weight: 850; font-size: 9.5pt;">Card POS: ₹ ${finalCard.toLocaleString('en-IN')}${fee > 0 ? ` (₹${totalPaid.toLocaleString('en-IN')} + ₹${fee.toLocaleString('en-IN')} Fee)` : ''}</span>`);
    } else if (rawMode.includes('upi') || rawMode.includes('online')) {
      const fee = totalPaid > 2000 ? (effectiveUpiTax > 0 ? effectiveUpiTax : Math.round(totalPaid * 0.004)) : 0;
      const finalOnline = totalPaid + fee;
      splitBadges.push(`<span style="background: #eff6ff; border: 1.5px solid #93c5fd; color: #1e40af; padding: 3px 8px; border-radius: 4px; font-weight: 850; font-size: 9.5pt;">Online UPI: ₹ ${finalOnline.toLocaleString('en-IN')}${fee > 0 ? ` (₹${totalPaid.toLocaleString('en-IN')} + ₹${fee.toLocaleString('en-IN')} Fee)` : ''}${onlineUtr ? ` [UTR: <strong>${escapeHtml(onlineUtr)}</strong>]` : ''}</span>`);
    } else {
      splitBadges.push(`<span style="background: #f0fdf4; border: 1.5px solid #86efac; color: #166534; padding: 3px 8px; border-radius: 4px; font-weight: 850; font-size: 9.5pt;">Cash: ₹ ${totalPaid.toLocaleString('en-IN')}</span>`);
    }
  }

  // Case Banner styling & content (with comprehensive extra member handling)
  let caseBannerBorder = '#1e293b';
  let caseBannerBg = '#f8fafc';
  let caseBannerTextColor = '#0f172a';
  let caseBannerIcon = '🚶';
  let caseBannerTitle = '';
  let caseBannerSubtitle = '';
  let caseBannerRefHtml = `<span style="background: #e2e8f0; color: #1e293b; border: 1px solid #cbd5e1; padding: 4px 10px; border-radius: 4px; font-weight: 850;">Folio: #${escapeHtml(voucherNo)}</span>`;
  let caseHeaderLabel = '';

  if (isOtaPrepaid) {
    const platform = otaPlatform || 'MakeMyTrip';
    caseBannerBorder = '#166534';
    caseBannerBg = '#f0fdf4';
    caseBannerTextColor = '#166534';
    caseBannerIcon = '🌐';
    caseBannerTitle = `OTA PRE-PAID RESERVATION (${platform.toUpperCase()})${hasExtraMembers ? ' WITH EXTRA MEMBER' : ''}`;
    caseBannerRefHtml = otaBookingId
      ? `<span style="background: #dcfce7; color: #166534; border: 1.5px solid #86efac; padding: 4px 10px; border-radius: 4px; font-weight: 900;">Voucher Ref: #${escapeHtml(otaBookingId)}</span>`
      : `<span style="background: #dcfce7; color: #166534; border: 1.5px solid #86efac; padding: 4px 10px; border-radius: 4px; font-weight: 900;">OTA Voucher Ref: Not Specified</span>`;
    caseHeaderLabel = `OTA Pre-Paid (${platform})${hasExtraMembers ? ' with Extra Member' : ''}`;
  } else if (isOtaPayAtHotel) {
    const platform = otaPlatform || 'OTA';
    caseBannerBorder = '#b45309';
    caseBannerBg = '#fffbeb';
    caseBannerTextColor = '#b45309';
    caseBannerIcon = '🌐';
    caseBannerTitle = `OTA RESERVATION (${platform.toUpperCase()}) • PAY AT HOTEL${hasExtraMembers ? ' WITH EXTRA MEMBER' : ''}`;
    caseBannerSubtitle = 'Booked via OTA channel. Entire room stay tariff + hotel incidentals must be collected directly from guest at Front Desk.';
    caseBannerRefHtml = otaBookingId
      ? `<span style="background: #fef3c7; color: #92400e; border: 1.5px solid #fcd34d; padding: 4px 10px; border-radius: 4px; font-weight: 900;">OTA Ref: #${escapeHtml(otaBookingId)}</span>`
      : `<span style="background: #fef3c7; color: #92400e; border: 1.5px solid #fcd34d; padding: 4px 10px; border-radius: 4px; font-weight: 900;">OTA Ref: Pay at Hotel</span>`;
    caseHeaderLabel = `OTA Pay-at-Hotel (${platform})${hasExtraMembers ? ' with Extra Member' : ''}`;
  } else if (isBtc) {
    const company = btcCompanyName ? btcCompanyName.toUpperCase() : 'CORPORATE CLIENT';
    caseBannerBorder = '#6b21a8';
    caseBannerBg = '#faf5ff';
    caseBannerTextColor = '#6b21a8';
    caseBannerIcon = '🏢';
    caseBannerTitle = `CORPORATE BILL TO COMPANY (BTC) — ${company}${hasExtraMembers ? ' WITH EXTRA MEMBER' : ''}`;
    caseBannerSubtitle = 'Room stay tariff & approved taxes are debited to Company Credit Ledger. Personal incidentals & F&B are payable by guest upon checkout.';
    caseBannerRefHtml = `<span style="background: #f3e8ff; color: #6b21a8; border: 1.5px solid #d8b4fe; padding: 4px 10px; border-radius: 4px; font-weight: 900;">Approval: #${escapeHtml(btcApprovalRef || 'CREDIT')}</span>`;
    caseHeaderLabel = `Corporate BTC (${btcCompanyName || 'Client'})${hasExtraMembers ? ' with Extra Member' : ''}`;
  } else if (isWebsite) {
    caseBannerBorder = '#0369a1';
    caseBannerBg = '#f0f9ff';
    caseBannerTextColor = '#0369a1';
    caseBannerIcon = '💻';
    caseBannerTitle = `HOTEL OFFICIAL WEBSITE DIRECT RESERVATION${hasExtraMembers ? ' WITH EXTRA MEMBER' : ''}`;
    caseBannerSubtitle = 'Direct online reservation through hotel booking engine. Standard room tariff and hotel policies apply.';
    caseBannerRefHtml = `<span style="background: #e0f2fe; color: #0369a1; border: 1.5px solid #7dd3fc; padding: 4px 10px; border-radius: 4px; font-weight: 900;">Web ID: #${escapeHtml(voucherNo)}</span>`;
    caseHeaderLabel = `Website Direct${hasExtraMembers ? ' with Extra Member' : ''}`;
  } else {
    caseBannerBorder = '#1e293b';
    caseBannerBg = '#f8fafc';
    caseBannerTextColor = '#0f172a';
    caseBannerIcon = '🚶';
    caseBannerTitle = `DIRECT WALK-IN GUEST${hasExtraMembers ? ' WITH EXTRA MEMBER' : ''}`;
    caseBannerSubtitle = '';
    caseBannerRefHtml = `<span style="background: #e2e8f0; color: #1e293b; border: 1px solid #cbd5e1; padding: 4px 10px; border-radius: 4px; font-weight: 850;">Folio: #${escapeHtml(voucherNo)}</span>`;
    caseHeaderLabel = `Direct Walk-in${hasExtraMembers ? ' with Extra Member' : ''}`;
  }

  // 6. Scans Collection (For Annexure Page 2+: Leader scans first, then extra proofs, then all companions)
  const guestPhoto = data.guestPhoto || data.guest_photo || data.photo || data.live_photo || '';
  const docFront = data.docFront || data.doc_front || data.idFront || data.id_front || data.front_image || '';
  const docBack = data.docBack || data.doc_back || data.idBack || data.id_back || data.back_image || '';
  const cashierName = data.checkedInBy || data.checked_in_by || getActiveCashierName() || 'Cashier';

  const scanItems = [];
  if (docFront) {
    scanItems.push({
      tag: 'LEADER ID (FRONT)',
      personName: guestName,
      docType: docType,
      idNumber: aadharNumber,
      image: docFront,
      title: `${guestName} - ${docType} (Front)`
    });
  }
  if (docBack) {
    scanItems.push({
      tag: 'LEADER ID (BACK)',
      personName: guestName,
      docType: docType,
      idNumber: aadharNumber,
      image: docBack,
      title: `${guestName} - ${docType} (Back)`
    });
  }

  // Additional doc proofs if stored in doc_proofs_json
  let extraProofs = [];
  try {
    if (Array.isArray(data.docProofs)) extraProofs = data.docProofs;
    else if (Array.isArray(data.doc_proofs)) extraProofs = data.doc_proofs;
    else if (typeof data.doc_proofs_json === 'string' && data.doc_proofs_json.trim()) {
      extraProofs = JSON.parse(data.doc_proofs_json);
    }
  } catch (e) {
    extraProofs = [];
  }
  extraProofs.forEach((p, pIdx) => {
    if (!p) return;
    const pImg = p.image || p.url || p.data || p.docFront || (typeof p === 'string' ? p : '');
    if (pImg) {
      scanItems.push({
        tag: `LEADER EXTRA DOC #${pIdx + 1}`,
        personName: p.name || guestName,
        docType: p.docType || 'Document Proof',
        idNumber: p.idNumber || '',
        image: pImg,
        title: `${p.name || guestName} - Extra Document #${pIdx + 1}`
      });
    }
  });

  // Companions (supports 1, 2, up to 15+ members and scans)
  memberDocs.forEach((m, idx) => {
    if (!m) return;
    if (typeof m === 'string' && (m.startsWith('data:') || m.startsWith('http') || m.startsWith('/'))) {
      scanItems.push({
        tag: `COMPANION #${idx + 1}`,
        personName: `Companion #${idx + 1}`,
        docType: 'ID Document',
        idNumber: '',
        image: m,
        title: `Companion #${idx + 1} Document`
      });
      return;
    }
    const memberName = m.name || m.full_name || `Companion #${idx + 1}`;
    const memberDocType = m.docType || m.doc_type || 'ID Document';
    const memberIdNo = m.idNumber || m.aadharNumber || m.id_number || m.aadhar_number || '';
    const frontImg = m.docFront || m.doc_front || m.front || m.image || m.document || m.url || '';
    const backImg = m.docBack || m.doc_back || m.back || '';
    const photoImg = m.photo || m.guestPhoto || m.guest_photo || '';

    if (frontImg) {
      scanItems.push({
        tag: `COMPANION #${idx + 1} (FRONT)`,
        personName: memberName,
        docType: memberDocType,
        idNumber: memberIdNo,
        image: frontImg,
        title: `${memberName} - ${memberDocType} (Front)`
      });
    }
    if (backImg) {
      scanItems.push({
        tag: `COMPANION #${idx + 1} (BACK)`,
        personName: memberName,
        docType: memberDocType,
        idNumber: memberIdNo,
        image: backImg,
        title: `${memberName} - ${memberDocType} (Back)`
      });
    }
    if (photoImg && photoImg !== frontImg && photoImg !== backImg) {
      scanItems.push({
        tag: `COMPANION #${idx + 1} (PHOTO)`,
        personName: memberName,
        docType: 'Photo',
        idNumber: memberIdNo,
        image: photoImg,
        title: `${memberName} - Photo`
      });
    }
  });

  // Chunk scanned documents into groups of exactly 4 per A4 paper (2 columns x 2 rows)
  const scanPages = [];
  for (let i = 0; i < scanItems.length; i += 4) {
    scanPages.push(scanItems.slice(i, i + 4));
  }
  // Ensure at least 1 annexure sheet if Leader live photo is present with no other scans
  if (scanPages.length === 0 && guestPhoto) {
    scanPages.push([]);
  }

  const page1Html = `
    <div class="full-a4-registration-card registration-page-1" style="position: relative; width: 100%; height: 268mm; max-height: 272mm; box-sizing: border-box; font-family: Arial, Helvetica, sans-serif; color: #000; border: 3.5px solid #1e3a8a; padding: 8px 12px; background: #fff; line-height: 1.25; display: flex; flex-direction: column; justify-content: space-between; page-break-inside: avoid; break-inside: avoid; page-break-after: avoid; break-after: avoid; overflow: hidden;">
      <!-- Top-Right Voucher / Reg No & Check-in Date Box (Top & Right Overlapped with Main Border) -->
      <div style="position: absolute; top: -3.5px; right: -3.5px; z-index: 10;">
        <table style="border-collapse: collapse; border: 1.5px solid #1e3a8a; border-top: 3.5px solid #1e3a8a; border-right: 3.5px solid #1e3a8a; font-size: 8pt; background: #ffffff;">
          <tbody>
            <tr>
              <td style="padding: 2.5px 7px; font-size: 7.5pt; font-weight: 850; background: #eff6ff; border-bottom: 1.5px solid #93c5fd; border-right: 1.5px solid #93c5fd; white-space: nowrap; color: #1e40af;">
                Voucher / Reg No:
              </td>
              <td style="padding: 2.5px 8px; font-weight: 900; font-size: 9.5pt; color: #1e3a8a; border-bottom: 1.5px solid #93c5fd; white-space: nowrap; letter-spacing: 0.03em;">
                ${escapeHtml(voucherNo)}
              </td>
            </tr>
            <tr>
              <td style="padding: 2.5px 7px; font-size: 7.5pt; font-weight: 850; background: #eff6ff; border-right: 1.5px solid #93c5fd; white-space: nowrap; color: #1e40af;">
                Check-in Date:
              </td>
              <td style="padding: 2.5px 8px; font-weight: 850; font-size: 8.5pt; color: #0f172a; white-space: nowrap;">
                ${checkinFormatted}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Watermark: centered, prominent background logo without name, darkened for crisp visibility -->
      <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); opacity: 0.38; filter: contrast(130%) brightness(88%); pointer-events: none; z-index: 0; text-align: center;">
        <img src="/HCP New Logo Png_witought-name.png" alt="" style="width: 440px; height: auto;" loading="eager" decoding="sync" />
      </div>

      <div style="position: relative; z-index: 1; display: flex; flex-direction: column; flex: 1; justify-content: space-between;">
        <div>
          <!-- HEADER -->
          <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #1e3a8a; padding-bottom: 4px; margin-bottom: 4px; padding-right: 215px; min-height: 108px;">
            <!-- Logo + Hotel Info -->
            <div style="display: flex; align-items: center; gap: 14px;">
              <img src="/hcp-logo-with-name.png" alt="Hotel CityPaark" style="height: 108px; max-height: 108px; width: auto; object-fit: contain;" loading="eager" decoding="sync" />
              <div>
                <h1 style="margin: 0; font-size: 19pt; font-weight: 900; font-family: Georgia, serif; letter-spacing: 0.5px; color: #1e3a8a; line-height: 1.1;">HOTEL CityPaark</h1>
                <div style="margin: 2px 0 0; font-size: 8.5pt; font-weight: 850; color: #1e3a8a; letter-spacing: 0.5px; text-transform: uppercase;">
                  by JMG HOSPITALITY AND INFRA LLP
                </div>
                <p style="margin: 2px 0 0; font-size: 8.2pt; font-weight: 750; color: #1e293b; white-space: nowrap;">
                  119, Murarji Peth, Char Hutatma Chowk, Solapur - 413 001 (Maharashtra)
                </p>
                <p style="margin: 2px 0 0; font-size: 8.2pt; color: #0284c7; font-weight: 600; display: flex; align-items: center; gap: 4px; flex-wrap: wrap;">
                  <img src="/phone-call.png" alt="" style="width: 12px; height: 12px; object-fit: contain; vertical-align: middle;" loading="eager" decoding="sync" />
                  <span style="font-weight: 750; color: #0284c7;">: 0217-2729791, 92, 93, +91 9960013388, 9370013388</span>
                  <span style="margin: 0 4px; color: #64748b;">•</span>
                  <span style="color: #475569;">hcitypark@rediffmail.com</span>
                </p>
              </div>
            </div>
          </div>

          <!-- ACCURATE CASE BANNER -->
          <div style="border: 1.5px solid ${caseBannerBorder}; background: ${caseBannerBg}; border-radius: 5px; padding: 4px 10px; margin-bottom: 5px; display: flex; justify-content: space-between; align-items: center; box-sizing: border-box;">
            <div style="display: flex; flex-direction: column; gap: 1px;">
              <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                <span style="font-size: 9pt; font-weight: 950; color: ${caseBannerTextColor}; letter-spacing: 0.3px; text-transform: uppercase;">
                  ${caseBannerIcon} BOOKING CASE: ${escapeHtml(caseBannerTitle)}
                </span>
                ${roomsList.length > 1 ? `
                  <span style="background: #1e40af; color: #ffffff; font-size: 7.5pt; font-weight: 900; padding: 1px 6px; border-radius: 3px; text-transform: uppercase; letter-spacing: 0.5px;">
                    👥 GROUP (${roomsList.length} ROOMS)
                  </span>
                ` : ''}
              </div>
              ${caseBannerSubtitle ? `
                <div style="font-size: 8pt; font-weight: 700; color: #334155;">
                  ${escapeHtml(caseBannerSubtitle)}
                </div>
              ` : ''}
            </div>
            <div style="text-align: right; white-space: nowrap; font-size: 8.5pt; font-weight: 850; color: #1e293b; margin-left: 8px;">
              ${caseBannerRefHtml}
            </div>
          </div>

          <!-- PRIMARY GUEST & CORPORATE BTC DETAILS TABLE -->
          <div style="margin-bottom: 5px;">
            ${isBtc ? `
              <!-- CORPORATE BILL TO COMPANY (BTC) FULL DETAILS TABLE -->
              <table style="width: 100%; border-collapse: collapse; font-size: 9pt; border: 2px solid #1e3a8a; background: rgba(255, 255, 255, 0.75);">
                <tbody>
                  <tr style="background: linear-gradient(135deg, #4c1d95 0%, #1e3a8a 100%);">
                    <th colspan="4" style="padding: 3px 8px; font-size: 9pt; font-weight: 950; text-align: left; text-transform: uppercase; border-bottom: 2px solid #1e3a8a; color: #ffffff; letter-spacing: 0.4px;">
                      🏢 CORPORATE BILL TO COMPANY (BTC) &amp; GUEST DETAILS
                    </th>
                  </tr>
                  <tr>
                    <td style="padding: 3px 6px; font-weight: bold; width: 20%; border-bottom: 1.5px solid #94a3b8; border-right: 1.5px solid #94a3b8; background: rgba(245, 243, 255, 0.9); color: #581c87;">Company Name:</td>
                    <td style="padding: 3px 6px; font-weight: 950; font-size: 10.5pt; width: 32%; border-bottom: 1.5px solid #94a3b8; border-right: 1.5px solid #94a3b8; color: #4c1d95;">
                      🏢 ${escapeHtml(effectiveBtcCompany)}
                    </td>
                    <td style="padding: 3px 6px; font-weight: bold; width: 20%; border-bottom: 1.5px solid #94a3b8; border-right: 1.5px solid #94a3b8; background: rgba(245, 243, 255, 0.9); color: #581c87;">Company GSTIN:</td>
                    <td style="padding: 3px 6px; font-weight: 950; width: 28%; border-bottom: 1.5px solid #94a3b8; letter-spacing: 0.05em; color: #0369a1; font-size: 10pt;">
                      ${escapeHtml(btcGstNumber || '-')}
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 3px 6px; font-weight: bold; width: 20%; border-bottom: 1.5px solid #94a3b8; border-right: 1.5px solid #94a3b8; background: rgba(245, 243, 255, 0.9); color: #581c87;">Company Address:</td>
                    <td style="padding: 3px 6px; font-weight: 850; width: 32%; border-bottom: 1.5px solid #94a3b8; border-right: 1.5px solid #94a3b8; font-size: 9pt; color: #0f172a;">
                      ${escapeHtml(btcCompanyAddress || address || '-')}
                    </td>
                    <td style="padding: 3px 6px; font-weight: bold; width: 20%; border-bottom: 1.5px solid #94a3b8; border-right: 1.5px solid #94a3b8; background: rgba(245, 243, 255, 0.9); color: #581c87;">Company PAN / Ref:</td>
                    <td style="padding: 3px 6px; font-weight: 900; width: 28%; border-bottom: 1.5px solid #94a3b8; font-size: 9pt; color: #0f172a;">
                      ${escapeHtml(btcPanNumber || btcApprovalRef || '-')}
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 3px 6px; font-weight: bold; width: 20%; border-bottom: 1.5px solid #94a3b8; border-right: 1.5px solid #94a3b8; background: rgba(245, 243, 255, 0.9); color: #581c87;">Corporate Contact:</td>
                    <td style="padding: 3px 6px; font-weight: 850; width: 32%; border-bottom: 1.5px solid #94a3b8; border-right: 1.5px solid #94a3b8; font-size: 9pt; color: #0f172a;">
                      ${escapeHtml(btcContactPerson || 'Corporate Liaison')}${btcContactPhone ? ` (${escapeHtml(btcContactPhone)})` : ''}${btcContactEmail ? ` • ${escapeHtml(btcContactEmail)}` : ''}
                    </td>
                    <td style="padding: 3px 6px; font-weight: bold; width: 20%; border-bottom: 1.5px solid #94a3b8; border-right: 1.5px solid #94a3b8; background: rgba(245, 243, 255, 0.9); color: #581c87;">Approval / PO Ref:</td>
                    <td style="padding: 3px 6px; font-weight: 900; width: 28%; border-bottom: 1.5px solid #94a3b8; font-size: 9pt; color: #6b21a8;">
                      ${escapeHtml(btcApprovalRef || 'CORPORATE CREDIT')}
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 3px 6px; font-weight: bold; width: 20%; border-bottom: 1.5px solid #94a3b8; border-right: 1.5px solid #94a3b8; background: rgba(239, 246, 255, 0.75); color: #1e40af;">Deputed Guest Name:</td>
                    <td style="padding: 3px 6px; font-weight: 950; font-size: 10.5pt; width: 32%; border-bottom: 1.5px solid #94a3b8; border-right: 1.5px solid #94a3b8; color: #0f172a;">
                      👤 ${escapeHtml(guestName)}
                    </td>
                    <td style="padding: 3px 6px; font-weight: bold; width: 20%; border-bottom: 1.5px solid #94a3b8; border-right: 1.5px solid #94a3b8; background: rgba(239, 246, 255, 0.75); color: #1e40af;">Guest Mobile No:</td>
                    <td style="padding: 3px 6px; font-weight: 950; width: 28%; border-bottom: 1.5px solid #94a3b8; font-size: 10pt; color: #0f172a;">
                      ${escapeHtml(mobile)}${altMobile ? ` / ${escapeHtml(altMobile)}` : ''}
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 3px 6px; font-weight: bold; width: 20%; border-right: 1.5px solid #94a3b8; background: rgba(239, 246, 255, 0.75); color: #1e40af;">Guest ID (${escapeHtml(docType)}):</td>
                    <td style="padding: 3px 6px; font-weight: 950; width: 32%; border-right: 1.5px solid #94a3b8; letter-spacing: 0.05em; color: #0369a1; font-size: 9.5pt;">
                      ${escapeHtml(aadharNumber || '-')}
                    </td>
                    <td style="padding: 3px 6px; font-weight: bold; width: 20%; border-right: 1.5px solid #94a3b8; background: rgba(239, 246, 255, 0.75); color: #1e40af;">Billing Status:</td>
                    <td style="padding: 3px 6px; font-weight: 950; width: 28%; font-size: 9.5pt; color: #6b21a8; background: rgba(250, 245, 255, 0.85);">
                      🏢 Bill to Company
                    </td>
                  </tr>
                </tbody>
              </table>
            ` : `
              <!-- STANDARD PRIMARY GUEST PERSONAL INFORMATION TABLE -->
              <table style="width: 100%; border-collapse: collapse; font-size: 9pt; border: 2px solid #1e3a8a; background: rgba(255, 255, 255, 0.75);">
                <tbody>
                  <tr style="background: linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%);">
                    <th colspan="4" style="padding: 3px 8px; font-size: 9pt; font-weight: 950; text-align: left; text-transform: uppercase; border-bottom: 2px solid #1e3a8a; color: #ffffff; letter-spacing: 0.4px;">
                      PRIMARY GUEST PERSONAL INFORMATION
                    </th>
                  </tr>
                  <tr>
                    <td style="padding: 3px 6px; font-weight: bold; width: 20%; border-bottom: 1.5px solid #94a3b8; border-right: 1.5px solid #94a3b8; background: rgba(239, 246, 255, 0.75); color: #1e40af;">Guest Full Name:</td>
                    <td style="padding: 3px 6px; font-weight: 950; font-size: 11pt; width: 32%; border-bottom: 1.5px solid #94a3b8; border-right: 1.5px solid #94a3b8; color: #0f172a;">${escapeHtml(guestName)}</td>
                    <td style="padding: 3px 6px; font-weight: bold; width: 20%; border-bottom: 1.5px solid #94a3b8; border-right: 1.5px solid #94a3b8; background: rgba(239, 246, 255, 0.75); color: #1e40af;">Mobile No:</td>
                    <td style="padding: 3px 6px; font-weight: 950; width: 28%; border-bottom: 1.5px solid #94a3b8; font-size: 10pt; color: #0f172a;">${escapeHtml(mobile)}${altMobile ? ` / ${escapeHtml(altMobile)}` : ''}</td>
                  </tr>
                  <tr>
                    <td style="padding: 3px 6px; font-weight: bold; width: 20%; border-bottom: 1.5px solid #94a3b8; border-right: 1.5px solid #94a3b8; background: rgba(239, 246, 255, 0.75); color: #1e40af;">DOB &amp; Age:</td>
                    <td style="padding: 3px 6px; font-weight: 850; width: 32%; border-bottom: 1.5px solid #94a3b8; border-right: 1.5px solid #94a3b8; font-size: 9pt; color: #0f172a;">
                      ${escapeHtml(dob || '-')}${calculatedAge ? ` (${calculatedAge})` : ''}
                    </td>
                    <td style="padding: 3px 6px; font-weight: bold; width: 20%; border-bottom: 1.5px solid #94a3b8; border-right: 1.5px solid #94a3b8; background: rgba(239, 246, 255, 0.75); color: #1e40af;">Booking Source:</td>
                    <td style="padding: 3px 6px; font-weight: 900; width: 28%; border-bottom: 1.5px solid #94a3b8; font-size: 9pt; color: #0f172a;">
                      <span style="background: #e0f2fe; color: #0369a1; padding: 1px 6px; border-radius: 3px; font-weight: 850;">${escapeHtml(bookingSource)}</span>${btcCompanyName ? ` (${escapeHtml(btcCompanyName)})` : ''}
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 3px 6px; font-weight: bold; width: 20%; border-bottom: 1.5px solid #94a3b8; border-right: 1.5px solid #94a3b8; background: rgba(239, 246, 255, 0.75); color: #1e40af;">ID Proof Type:</td>
                    <td style="padding: 3px 6px; font-weight: 850; width: 32%; border-bottom: 1.5px solid #94a3b8; border-right: 1.5px solid #94a3b8; font-size: 9pt; color: #0f172a;">${escapeHtml(docType)}</td>
                    <td style="padding: 3px 6px; font-weight: bold; width: 20%; border-bottom: 1.5px solid #94a3b8; border-right: 1.5px solid #94a3b8; background: rgba(239, 246, 255, 0.75); color: #1e40af;">${escapeHtml(idLabel)}</td>
                    <td style="padding: 3px 6px; font-weight: 950; width: 28%; border-bottom: 1.5px solid #94a3b8; letter-spacing: 0.05em; color: #0369a1; font-size: 10pt;">
                      ${escapeHtml(aadharNumber || '-')}
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 3px 6px; font-weight: bold; width: 20%; border-bottom: 1.5px solid #94a3b8; border-right: 1.5px solid #94a3b8; background: rgba(239, 246, 255, 0.75); color: #1e40af;">Email Address:</td>
                    <td style="padding: 3px 6px; width: 32%; border-bottom: 1.5px solid #94a3b8; border-right: 1.5px solid #94a3b8; font-weight: 750; font-size: 9pt; color: #0f172a;">${escapeHtml(email)}</td>
                    <td style="padding: 3px 6px; font-weight: bold; width: 20%; border-bottom: 1.5px solid #94a3b8; border-right: 1.5px solid #94a3b8; background: rgba(239, 246, 255, 0.75); color: #1e40af;">Document Verification:</td>
                    <td style="padding: 3px 6px; width: 28%; font-size: 9.5pt; color: #15803d; font-weight: 950; border-bottom: 1.5px solid #94a3b8; background: rgba(240, 253, 244, 0.65);">
                      ✓ ${escapeHtml(docType)}${includePhotos && scanPages.length > 0 ? ' • Copies Attached (Page 2)' : ''}
                    </td>
                  </tr>
                  ${(companyName || gstNumber) ? `
                    <tr>
                      <td style="padding: 3px 6px; font-weight: bold; width: 20%; border-bottom: 1.5px solid #94a3b8; border-right: 1.5px solid #94a3b8; background: rgba(239, 246, 255, 0.75); color: #1e40af;">Company Name:</td>
                      <td style="padding: 3px 6px; font-weight: 850; width: 32%; border-bottom: 1.5px solid #94a3b8; border-right: 1.5px solid #94a3b8; font-size: 9pt; color: #0f172a;">${escapeHtml(companyName || '-')}</td>
                      <td style="padding: 3px 6px; font-weight: bold; width: 20%; border-bottom: 1.5px solid #94a3b8; border-right: 1.5px solid #94a3b8; background: rgba(239, 246, 255, 0.75); color: #1e40af;">Company GSTIN:</td>
                      <td style="padding: 3px 6px; font-weight: 950; width: 28%; border-bottom: 1.5px solid #94a3b8; letter-spacing: 0.05em; color: #0369a1; font-size: 9.5pt;">${escapeHtml(gstNumber || '-')}</td>
                    </tr>
                  ` : ''}
                  <tr>
                    <td style="padding: 3px 6px; font-weight: bold; width: 20%; border-right: 1.5px solid #94a3b8; background: rgba(239, 246, 255, 0.75); color: #1e40af;">Permanent Address:</td>
                    <td colspan="3" style="padding: 3px 6px; font-size: 9pt; color: #0f172a; font-weight: 750;">${escapeHtml(address)}</td>
                  </tr>
                </tbody>
              </table>
            `}
          </div>

          <!-- STAY DETAILS (Clean table without emojis, key-value people lived in) -->
          <div style="border: 2px solid #0f766e; margin-bottom: 5px; background: rgba(255, 255, 255, 0.75);">
            <div style="background: linear-gradient(135deg, #0f766e 0%, #0d9488 100%); padding: 3px 10px; font-size: 9pt; font-weight: 950; border-bottom: 2px solid #0f766e; text-transform: uppercase; color: #ffffff; display: flex; justify-content: space-between; align-items: center; letter-spacing: 0.4px;">
              <span>STAY DETAILS</span>
              <span style="font-size: 8pt; font-weight: 900; background: rgba(255, 255, 255, 0.2); padding: 1px 6px; border-radius: 3px;">
                ${roomsList.length} ROOM${roomsList.length > 1 ? 'S' : ''} ALLOCATED
              </span>
            </div>
            <table style="width: 100%; border-collapse: collapse; font-size: 9pt;">
              <tbody>
                <tr>
                  <td style="padding: 3px 6px; font-weight: bold; width: 22%; border-bottom: 1.5px solid #94a3b8; border-right: 1.5px solid #94a3b8; background: rgba(240, 253, 250, 0.75); color: #0f766e;">Allocated Room(s):</td>
                  <td style="padding: 3px 6px; font-weight: 950; font-size: 11pt; border-bottom: 1.5px solid #94a3b8; border-right: 1.5px solid #94a3b8; color: #0f766e;">
                    ${escapeHtml(cleanRoomsText)}
                  </td>
                  <td style="padding: 3px 6px; font-weight: bold; width: 18%; border-bottom: 1.5px solid #94a3b8; border-right: 1.5px solid #94a3b8; background: rgba(240, 253, 250, 0.75); color: #0f766e;">People Lived In:</td>
                  <td style="padding: 3px 6px; border-bottom: 1.5px solid #94a3b8; color: #0f172a;">
                    <div style="display: flex; flex-direction: column; gap: 2px;">
                      <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap; font-size: 9pt;">
                        <div><span style="color: #0284c7; font-weight: 800;">Male:</span> <strong style="color: #0f172a; font-size: 10pt;">${male}</strong></div>
                        <div><span style="color: #db2777; font-weight: 800;">Female:</span> <strong style="color: #0f172a; font-size: 10pt;">${female}</strong></div>
                        <div><span style="color: #d97706; font-weight: 800;">Children:</span> <strong style="color: #0f172a; font-size: 10pt;">${children}</strong></div>
                        <div><span style="color: #7c3aed; font-weight: 800;">Extra Bed:</span> <strong style="color: #0f172a; font-size: 10pt;">${extraBeds}</strong></div>
                      </div>
                      ${isOta ? `
                        <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-size: 7.5pt; margin-top: 1px; padding-top: 1px; border-top: 1px dashed #cbd5e1;">
                          <span style="background: #f0fdf4; color: #166534; border: 1px solid #bbf7d0; padding: 1px 5px; border-radius: 3px; font-weight: 800;">
                            📦 OTA Booked: ${otaBookedAdults !== null ? `${otaBookedAdults} Adult${otaBookedAdults > 1 ? 's' : ''}` : '1 Adult'}${otaBookedChildren > 0 ? `, ${otaBookedChildren} Child` : ''}${voucherIncludedBeds > 0 ? `, ${voucherIncludedBeds} Bed (₹0)` : ''}
                          </span>
                          ${(extraAdults > 0 || extraChildren > 0 || hotelChargedBeds > 0) ? `
                            <span style="background: #eff6ff; color: #1e40af; border: 1px solid #bfdbfe; padding: 1px 5px; border-radius: 3px; font-weight: 800;">
                              🏨 Hotel Extra: ${extraAdults > 0 ? `+${extraAdults} Adult(s)` : ''}${extraChildren > 0 ? ` +${extraChildren} Child` : ''}${hotelChargedBeds > 0 ? ` +${hotelChargedBeds} Bed (+₹${extraBedCharge.toLocaleString('en-IN')})` : ''}
                            </span>
                          ` : `
                            <span style="color: #64748b; font-weight: 700;">(No Extra Hotel Pax)</span>
                          `}
                        </div>
                      ` : ''}
                    </div>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 3px 6px; font-weight: bold; border-bottom: 1.5px solid #94a3b8; border-right: 1.5px solid #94a3b8; background: rgba(240, 253, 250, 0.75); color: #0f766e;">Check-in Date/Time:</td>
                  <td style="padding: 3px 6px; font-weight: 850; border-bottom: 1.5px solid #94a3b8; border-right: 1.5px solid #94a3b8; font-size: 9pt; color: #0f172a;">
                    ${checkinFormatted}
                    ${isEarlyCheckin ? `
                      <div style="font-size: 7.5pt; color: #b45309; font-weight: 800; margin-top: 1px;">
                        Early Check-In: <strong>${escapeHtml(earlyCheckinTime || checkinFormatted)}</strong> (Scheduled: ${escapeHtml(originalCheckinTime)}) • Free
                      </div>
                    ` : ''}
                  </td>
                  <td style="padding: 3px 6px; font-weight: bold; border-bottom: 1.5px solid #94a3b8; border-right: 1.5px solid #94a3b8; background: rgba(240, 253, 250, 0.75); color: #0f766e;">
                    ${isOta ? 'Checkout Date/Time (Fixed):' : 'Expected Checkout:'}
                  </td>
                  <td style="padding: 3px 6px; font-weight: 950; color: #b91c1c; border-bottom: 1.5px solid #94a3b8; font-size: 9pt;">
                    ${checkoutFormatted} ${stayNights ? `(${stayNights} Night${stayNights > 1 ? 's' : ''})` : ''}
                    ${isOta ? '<span style="font-size: 7.5pt; color: #0369a1; font-weight: 800; margin-left: 4px;">(Fixed &amp; Paid)</span>' : ''}
                  </td>
                </tr>
                <tr>
                  <td style="padding: 3px 6px; font-weight: bold; border-right: 1.5px solid #94a3b8; background: rgba(240, 253, 250, 0.75); color: #0f766e;">Meal Plan / Package:</td>
                  <td style="padding: 3px 6px; font-weight: 900; border-right: 1.5px solid #94a3b8; font-size: 9pt; color: #15803d;">
                    ${escapeHtml(mealPlanDisplay)}
                  </td>
                  <td style="padding: 3px 6px; font-weight: bold; border-right: 1.5px solid #94a3b8; background: rgba(240, 253, 250, 0.75); color: #0f766e;">Stay &amp; Extra Beds:</td>
                  <td style="padding: 3px 6px; font-weight: 850; font-size: 9pt; color: #854d0e;">
                    ${escapeHtml(stayBedDetailsText)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Companion Summary Bar on Page 1 (Clean text, no image clutter) -->
          ${memberDocs.length > 0 && includePhotos ? `
            <div style="border: 1.5px solid #1e3a8a; margin-bottom: 5px; background: rgba(255, 255, 255, 0.85); border-radius: 4px; overflow: hidden;">
              <div style="background: linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%); padding: 2.5px 8px; font-size: 8pt; font-weight: 950; text-transform: uppercase; color: #ffffff; display: flex; justify-content: space-between; align-items: center;">
                <span>👥 REGISTERED COMPANIONS (${memberDocs.length} Members)</span>
                <span style="font-size: 7.5pt; font-weight: 800; color: #86efac;">✓ Scanned Copies Preserved on Annexure Page 2</span>
              </div>
              <div style="padding: 3px 8px; font-size: 8pt; color: #1e293b; display: flex; gap: 8px; flex-wrap: wrap; align-items: center;">
                ${memberDocs.map((m, idx) => `
                  <span style="background: #eff6ff; border: 1px solid #bfdbfe; padding: 1.5px 6px; border-radius: 3px; font-weight: 750;">
                    👤 <strong>${escapeHtml(m.name || `Companion #${idx + 1}`)}</strong>${m.docType ? ` (${escapeHtml(m.docType)})` : ''}${m.idNumber || m.aadharNumber ? `: ${escapeHtml(m.idNumber || m.aadharNumber)}` : ''}
                  </span>
                `).join('')}
              </div>
            </div>
          ` : ''}

          <!-- PAYMENT SUMMARY (Table Manner with Crisp Borders & Prominent Typography) -->
          <div style="border: 2px solid #1e3a8a; margin-bottom: 4px; background: rgba(255, 255, 255, 0.75);">
            <div style="background: linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%); padding: 3px 8px; font-size: 9pt; font-weight: 950; border-bottom: 2px solid #1e3a8a; text-transform: uppercase; color: #ffffff; display: flex; justify-content: space-between; align-items: center; letter-spacing: 0.4px;">
              <span>PAYMENT SUMMARY</span>
              <span style="font-size: 7.5pt; font-weight: 800; color: #86efac; background: rgba(255, 255, 255, 0.2); padding: 1px 6px; border-radius: 3px;">
                ${isEarlyCheckin ? 'Early Check-In Surcharge: ₹0 • ' : ''}Standard 5% Hotel GST Included
              </span>
            </div>
            
            <table style="width: 100%; border-collapse: collapse; text-align: center;">
              <thead>
                <tr style="background: rgba(241, 245, 249, 0.85);">
                  <th style="padding: 3px 4px; font-size: 8pt; color: #334155; text-transform: uppercase; font-weight: 850; border-bottom: 1.5px solid #94a3b8; border-right: 1.5px solid #94a3b8; width: 20%;">
                    ${isOta ? 'Pre-Booked via OTA' : 'Room Tariff (Net)'}
                  </th>
                  <th style="padding: 3px 4px; font-size: 8pt; color: #334155; text-transform: uppercase; font-weight: 850; border-bottom: 1.5px solid #94a3b8; border-right: 1.5px solid #94a3b8; width: 20%;">
                    ${isOta ? 'Extra Booking @ Hotel' : `Discount ${discountPct > 0 ? `(${discountPct}%)` : ''}`}
                  </th>
                  <th style="padding: 3px 4px; font-size: 8pt; color: #334155; text-transform: uppercase; font-weight: 850; border-bottom: 1.5px solid #94a3b8; border-right: 1.5px solid #94a3b8; width: 16%;">
                    GST (5%)
                  </th>
                  <th style="padding: 3px 4px; font-size: 8pt; color: #1e40af; text-transform: uppercase; font-weight: 950; border-bottom: 1.5px solid #94a3b8; border-right: 1.5px solid #94a3b8; background: rgba(239, 246, 255, 0.85); width: 22%;">
                    ${isOta ? 'Total Booking Value' : 'Grand Total'}
                  </th>
                  <th style="padding: 3px 4px; font-size: 8pt; color: #166534; text-transform: uppercase; font-weight: 950; border-bottom: 1.5px solid #94a3b8; background: rgba(240, 253, 244, 0.85); width: 22%;">
                    ${isOta ? 'Amount Collected' : 'Advance Paid'}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style="padding: 4px 4px; font-size: 10.5pt; font-weight: 900; color: #0f172a; border-right: 1.5px solid #94a3b8; border-bottom: 1.5px solid #94a3b8;">
                    ₹ ${(isOta ? otaPrebookedAmount : tariffNet).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    ${isOta
                      ? (isOtaPrepaid
                          ? `<div style="font-size: 7pt; color: #166534; font-weight: 900; margin-top: 1px;">(OTA Pre-Paid)</div>`
                          : `<div style="font-size: 7pt; color: #b45309; font-weight: 900; margin-top: 1px;">(Pay at Hotel)</div>`)
                      : ''
                    }
                  </td>
                  <td style="padding: 4px 4px; font-size: 10.5pt; font-weight: 900; color: ${(!isOta && discountAmount > 0) ? '#15803d' : '#0f172a'}; border-right: 1.5px solid #94a3b8; border-bottom: 1.5px solid #94a3b8;">
                    ₹ ${(isOta ? hotelExtrasTotal : discountAmount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    ${isOta ? `<div style="font-size: 7pt; color: #475569; font-weight: 750; margin-top: 1px;">${escapeHtml(hotelExtrasDesc)}</div>` : ''}
                  </td>
                  <td style="padding: 4px 4px; font-size: 10.5pt; font-weight: 900; color: #0f172a; border-right: 1.5px solid #94a3b8; border-bottom: 1.5px solid #94a3b8;">
                    ₹ ${(isOtaPrepaid ? 0 : taxAmount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    ${isOta ? `<div style="font-size: 7pt; color: #64748b; margin-top: 1px;">${isOtaPrepaid ? '(In Voucher)' : '(Standard)'}</div>` : ''}
                  </td>
                  <td style="padding: 4px 4px; font-size: 11pt; font-weight: 950; color: #1e40af; border-right: 1.5px solid #94a3b8; border-bottom: 1.5px solid #94a3b8; background: rgba(239, 246, 255, 0.85);">
                    ₹ ${(isOta ? effectiveTotalBooking : grandTotal).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    ${isOta ? `<div style="font-size: 7pt; color: #1e40af; margin-top: 1px; font-weight: 800;">Prebooked + Extras</div>` : ''}
                  </td>
                  <td style="padding: 4px 4px; font-size: 11pt; font-weight: 950; color: #166534; border-bottom: 1.5px solid #94a3b8; background: rgba(240, 253, 244, 0.85);">
                    ₹ ${(isOta ? combinedTotalCollected : totalPaid).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    ${isOta ? `
                      <div style="font-size: 7pt; color: #166534; font-weight: 850; margin-top: 1px;">
                        ${isOtaPrepaid
                          ? `₹${prebookedCollected.toLocaleString('en-IN')} Prepaid${hotelDeskCollected > 0 ? ` + ₹${hotelDeskCollected.toLocaleString('en-IN')} Desk` : ''}`
                          : `₹${hotelDeskCollected.toLocaleString('en-IN')} Desk Advance`
                        }
                      </div>
                    ` : ''}
                  </td>
                </tr>
                ${isOta ? `
                <tr>
                  <td colspan="5" style="padding: 3px 8px; background: rgba(248, 250, 252, 0.9); border-top: 1.5px solid #94a3b8; border-bottom: 1.5px solid #94a3b8; text-align: left;">
                    <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 4px; font-size: 8pt;">
                      <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
                        <span style="font-weight: 950; color: #1e3a8a; text-transform: uppercase;">
                          🏨 HOTEL INCIDENTALS BREAKDOWN: CALCULATION OF BOOKING &amp; RECONCILIATION @ HOTEL
                        </span>
                        <span>Pre-booked OTA (${escapeHtml(otaPlatform || 'OTA')}): <strong>₹ ${otaPrebookedAmount.toLocaleString('en-IN')}</strong> ${isOtaPrepaid ? '<span style="color:#166534; font-weight:900;">[PREPAID] (Voucher Covered)</span>' : '<span style="color:#b45309; font-weight:900;">[PAY AT HOTEL]</span>'}</span>
                        <span>Extra Booking @ Hotel: <strong>₹ ${hotelExtrasTotal.toLocaleString('en-IN')}</strong>${extraBedCharge > 0 ? ` (Extra Bed(s): <strong>₹ ${extraBedCharge.toLocaleString('en-IN')}</strong>)` : ''}${fnbTotal > 0 ? ` (F&amp;B Orders: <strong>₹ ${fnbTotal.toLocaleString('en-IN')}</strong>)` : ''}</span>
                      </div>
                      <div style="font-size: 8pt; font-weight: 950; color: #0f172a;">
                        <span style="color: #475569; font-weight: 750;">Total Settled:</span>
                        <strong style="color: #166534;">₹ ${combinedTotalCollected.toLocaleString('en-IN')}</strong>
                        ${isOtaPrepaid ? `<span style="font-size: 7.5pt; color: #166534; font-weight: 800;">(₹${prebookedCollected.toLocaleString('en-IN')} Prepaid + ₹${hotelDeskCollected.toLocaleString('en-IN')} Desk)</span>` : ''}
                      </div>
                    </div>
                  </td>
                </tr>
                ` : (extraBedCharge > 0 || fnbTotal > 0) ? `
                <tr>
                  <td colspan="5" style="padding: 3px 8px; background: rgba(248, 250, 252, 0.9); border-top: 1.5px solid #94a3b8; border-bottom: 1.5px solid #94a3b8; text-align: left;">
                    <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 4px; font-size: 8pt;">
                      <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
                        <span style="font-weight: 950; color: #1e3a8a; text-transform: uppercase;">
                          🏨 HOTEL INCIDENTALS BREAKDOWN: SERVICES &amp; EXTRAS
                        </span>
                        ${extraBedCharge > 0 ? `<span>Extra Bed(s): <strong>₹ ${extraBedCharge.toLocaleString('en-IN')}</strong></span>` : ''}
                        ${fnbTotal > 0 ? `<span>F&amp;B Orders: <strong>₹ ${fnbTotal.toLocaleString('en-IN')}</strong>${fnbPendingTotal > 0 ? ` (<span style="color:#b91c1c; font-weight:800;">₹ ${fnbPendingTotal.toLocaleString('en-IN')} Pending</span>)` : ' (Paid)'}</span>` : ''}
                      </div>
                    </div>
                  </td>
                </tr>
                ` : ''}
                ${(splitBadges.length > 0 || !isBtc) ? `
                  <tr>
                    <td colspan="5" style="padding: 3px 8px; background: rgba(241, 245, 249, 0.95); text-align: left;">
                      <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                        <span style="font-weight: 950; text-transform: uppercase; font-size: 8pt; color: #1e3a8a;">Payment Modes:</span>
                        ${splitBadges.length > 0 ? splitBadges.join(' ') : '<span style="color: #64748b; font-weight: 700; font-size: 8pt;">None recorded</span>'}
                      </div>
                    </td>
                  </tr>
                ` : ''}
              </tbody>
            </table>
          </div>
        </div>

        <!-- SIGNATURES (CLEAN CLEARANCE FOR PHYSICAL SIGNING AND CASHIER RUBBER STAMP ON A4) -->
        <div style="margin-top: auto; padding-top: 4px; page-break-inside: avoid; break-inside: avoid;">
          <!-- Extra Space for physical signature and cashier seal/stamp -->
          <div style="height: 36px;"></div>

          <div style="display: flex; justify-content: space-between; align-items: flex-end;">
            <div style="text-align: center; width: 220px;">
              <div style="border-top: 2px solid #1e3a8a; padding-top: 3px; font-size: 10pt; font-weight: 950; color: #1e3a8a;">
                Guest Signature
              </div>
            </div>
            <div style="text-align: center; font-size: 8pt; color: #64748b; font-weight: 600;">
              Printed: ${new Date().toLocaleString('en-IN')}
            </div>
            <div style="text-align: center; width: 220px;">
              <div style="font-size: 9pt; font-weight: 850; color: #1e3a8a; margin-bottom: 2px;">
                ${escapeHtml(cashierName)}
              </div>
              <div style="border-top: 2px solid #1e3a8a; padding-top: 3px; font-size: 10pt; font-weight: 950; color: #1e40af;">
                Front Desk Cashier
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  // 7. Annexure Pages (Page 2+): 4 Scanned copies aligned per A4 paper (2x2 grid), with Leader Live Photo centered at top of Sheet 2
  let annexurePagesHtml = '';
  if (includePhotos && (scanPages.length > 0 || guestPhoto)) {
    const totalPages = 1 + scanPages.length;
    annexurePagesHtml = scanPages.map((pageScans, pageIdx) => {
      const pageNum = pageIdx + 2;
      const hasTopLeaderPhoto = (pageIdx === 0 && Boolean(guestPhoto));
      const rowHeight = hasTopLeaderPhoto ? '106mm' : '118mm';
      const imgBoxHeight = hasTopLeaderPhoto ? '93mm' : '105mm';

      const slotsHtml = pageScans.map((scan, slotIdx) => {
        return `
        <div style="border: 1.5px solid #cbd5e1; border-radius: 6px; background: #f8fafc; padding: 3px 5px; display: flex; flex-direction: column; justify-content: space-between; height: ${rowHeight}; box-sizing: border-box;">
          <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #e2e8f0; padding-bottom: 1.5px; margin-bottom: 1.5px;">
            <span style="font-size: 7.5pt; font-weight: 900; color: #1e3a8a; background: #e0e7ff; padding: 1px 5px; border-radius: 3px; letter-spacing: 0.03em;">
              ${escapeHtml(scan.tag)}
            </span>
            <span style="font-size: 7pt; font-weight: 750; color: #64748b;">
              Slot ${slotIdx + 1} of 4
            </span>
          </div>
          <div style="flex: 1; display: flex; align-items: center; justify-content: center; background: #ffffff; border: 1.5px solid #cbd5e1; border-radius: 4px; overflow: hidden; padding: 2px; min-height: ${imgBoxHeight}; max-height: ${imgBoxHeight}; height: ${imgBoxHeight};">
            <img class="annexure-scan-img annexure-id-doc" src="${escapeHtml(scan.image)}" alt="${escapeHtml(scan.title)}" style="max-width: 100%; max-height: 100%; width: auto; height: auto; object-fit: contain; image-rendering: -webkit-optimize-contrast; image-rendering: crisp-edges;" />
          </div>
          <div style="margin-top: 1.5px; font-size: 7pt; color: #1e293b; line-height: 1.15; background: #ffffff; padding: 1.5px 5px; border-radius: 3px; border: 1px solid #e2e8f0;">
            <div style="font-weight: 850; color: #0f172a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
              ${escapeHtml(scan.personName)}
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 6.8pt; color: #64748b; margin-top: 1px;">
              <span>${escapeHtml(scan.docType || 'ID Document')}</span>
              <strong style="color: #1e40af;">${escapeHtml(scan.idNumber || '')}</strong>
            </div>
          </div>
        </div>
      `;
      }).join('');

      // Fill remaining empty slots up to 4 if page has fewer than 4 scans, keeping the 2x2 grid aligned
      const emptySlotsCount = 4 - pageScans.length;
      let emptySlotsHtml = '';
      for (let s = 0; s < emptySlotsCount; s++) {
        emptySlotsHtml += `
          <div style="border: 1.5px dashed #e2e8f0; border-radius: 6px; background: #fbfcfe; padding: 6px; display: flex; flex-direction: column; justify-content: center; align-items: center; height: ${rowHeight}; box-sizing: border-box; color: #94a3b8;">
            <div style="font-size: 9pt; font-weight: 700;">Blank Slot ${pageScans.length + s + 1} of 4</div>
            <div style="font-size: 7.5pt; margin-top: 2px;">Preserved for additional document annexure</div>
          </div>
        `;
      }

      return `
        <div class="html2pdf__page-break" style="height: 0; margin: 0; padding: 0; line-height: 0; font-size: 0; border: none;"></div>
        <div class="full-a4-registration-card annexure-sheet" style="position: relative; width: 100%; height: 268mm; max-height: 268mm; box-sizing: border-box; font-family: Arial, Helvetica, sans-serif; color: #000; border: 3.5px solid #1e3a8a; padding: 5px 10px; background: #fff; line-height: 1.35; display: flex; flex-direction: column; justify-content: space-between; page-break-inside: avoid; break-inside: avoid; page-break-before: always; break-before: page; page-break-after: avoid; break-after: avoid; overflow: hidden;">
          <!-- Annexure Header -->
          <div style="border-bottom: 2px solid #1e3a8a; padding-bottom: 3px; margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <img src="/hcp-logo-with-name.png" alt="Hotel CityPaark" style="height: 32px; width: auto; object-fit: contain;" />
              <div>
                <div style="font-size: 11pt; font-weight: 900; font-family: Georgia, serif; color: #1e3a8a; letter-spacing: 0.5px;">
                  HOTEL CityPaark — Document Verification Annexure
                </div>
                <div style="font-size: 7.5pt; font-weight: 750; color: #475569;">
                  Official Scanned Records &bull; Primary Guest Live Photo &bull; 4 Documents Aligned Per Sheet
                </div>
              </div>
            </div>
            <div style="text-align: right; font-size: 8pt;">
              <div style="font-weight: 900; color: #1e3a8a;">Voucher: ${escapeHtml(voucherNo)}</div>
              <div style="font-weight: 700; color: #64748b; font-size: 7.5pt;">Sheet ${pageNum} of ${totalPages}</div>
            </div>
          </div>

          ${hasTopLeaderPhoto ? `
            <!-- LEADER LIVE WEBCAM PHOTO (CENTERED ON TOP OF ANNEXURE SHEET 2) -->
            <div style="border: 1.5px solid #1e3a8a; border-radius: 5px; background: linear-gradient(135deg, #f8fafc 0%, #eff6ff 50%, #f8fafc 100%); padding: 2px 10px; margin-bottom: 4px; display: flex; align-items: center; justify-content: center; gap: 12px; box-sizing: border-box; height: 24mm;">
              <div style="height: 21mm; width: 29mm; min-width: 29mm; border: 1.5px solid #1e40af; border-radius: 4px; background: #ffffff; overflow: hidden; display: flex; align-items: center; justify-content: center; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                <img class="annexure-scan-img annexure-live-photo" src="${escapeHtml(guestPhoto)}" alt="Leader Live Photo" style="max-width: 100%; max-height: 100%; width: auto; height: auto; object-fit: contain; image-rendering: -webkit-optimize-contrast; image-rendering: crisp-edges;" />
              </div>
              <div style="display: flex; flex-direction: column; justify-content: center; gap: 1px;">
                <div style="display: flex; align-items: center; gap: 6px;">
                  <span style="font-size: 7.5pt; font-weight: 950; color: #1e3a8a; background: #dbeafe; border: 1px solid #bfdbfe; padding: 1px 6px; border-radius: 3px; letter-spacing: 0.03em;">
                    📸 PRIMARY GUEST / ROOM LEADER LIVE PHOTO
                  </span>
                  <span style="font-size: 6.8pt; font-weight: 850; color: #166534; background: #dcfce7; border: 1px solid #bbf7d0; padding: 1px 5px; border-radius: 3px;">
                    ✓ Live Webcam Verified
                  </span>
                </div>
                <div style="font-size: 9.5pt; font-weight: 950; color: #0f172a; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                  ${escapeHtml(guestName)}
                </div>
                <div style="font-size: 7.2pt; color: #475569; font-weight: 750;">
                  ID Proof: <strong style="color: #1e40af;">${escapeHtml(docType)}</strong>${aadharNumber ? ` &bull; Ref: <strong style="color: #0f172a;">${escapeHtml(aadharNumber)}</strong>` : ''} &bull; Room: <strong style="color: #0f766e;">${escapeHtml(cleanRoomsText)}</strong>
                </div>
                <div style="font-size: 6.8pt; color: #64748b;">
                  Captured at Front Desk Check-in &bull; Official Digital Verification Vault
                </div>
              </div>
            </div>
          ` : ''}

          <!-- 4-Grid (2 columns x 2 rows) -->
          <div style="display: grid; grid-template-columns: repeat(2, 1fr); grid-auto-rows: ${rowHeight}; gap: ${hasTopLeaderPhoto ? '4px' : '5px'}; flex: 1;">
            ${slotsHtml}
            ${emptySlotsHtml}
          </div>

          <!-- Annexure Footer -->
          <div style="margin-top: 3px; border-top: 1px solid #cbd5e1; padding-top: 2px; display: flex; justify-content: space-between; align-items: center; font-size: 7pt; color: #64748b;">
            <span>Digital Document Verification Vault &bull; Registered for ${escapeHtml(guestName)} (${escapeHtml(cleanRoomsText)})</span>
            <span>Annexure Sheet ${pageNum} of ${totalPages}</span>
          </div>
        </div>
      `;
    }).join('');
  }

  return page1Html + annexurePagesHtml;
}

/**
 * Print Guest Registration Card on A4 (Zero photos on paper print to save LaserJet toner)
 */
export function printGuestRegistrationA4(data, options = {}) {
  if (!data) return;

  const sheet = document.getElementById('print-registration-sheet');
  if (!sheet) {
    console.warn('print-registration-sheet element not found in DOM');
    return;
  }

  const exitThemeIsolation = enterPrintThemeIsolation();

  // By default, physical paper print has includePhotos: false (NO pictures on paper)
  const includePhotos = Boolean(options?.includePhotos);
  const prevTitle = document.title;
  if (options?.windowTitle) {
    document.title = options.windowTitle;
  }

  sheet.innerHTML = buildGuestRegistrationHTML(data, { includePhotos });

  sheet.style.display = 'block';
  sheet.classList.add('print-active');
  document.body.classList.add('print-sheet-active');

  const cleanup = () => {
    sheet.classList.remove('print-active');
    sheet.style.display = 'none';
    document.body.classList.remove('print-sheet-active');
    document.title = prevTitle;
    window.removeEventListener('afterprint', cleanup);
    exitThemeIsolation();
  };
  window.addEventListener('afterprint', cleanup, { once: true });

  const triggerPrint = () => {
    requestAnimationFrame(() => {
      setTimeout(() => {
        window.print();
        setTimeout(cleanup, 3000);
      }, 80);
    });
  };

  const imgs = Array.from(sheet.querySelectorAll('img'));
  const decodePromises = imgs.map(img => {
    if (img.complete && img.naturalWidth > 0) return Promise.resolve();
    if (img.decode) return img.decode().catch(() => Promise.resolve());
    return new Promise(res => {
      img.onload = () => res();
      img.onerror = () => res();
      setTimeout(res, 500);
    });
  });

  Promise.all(decodePromises).then(() => {
    triggerPrint();
  }).catch(() => {
    triggerPrint();
  });
}

/**
 * Auto-crops empty scanner white margins from scanned document images
 * so that the actual document content expands to fill the slot and is clearly visible.
 */
export function autoCropWhiteBorders(img) {
  try {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h || w < 80 || h < 80) return img.src;

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);

    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;

    // A pixel is background if it's white/light-gray flatbed with low saturation
    const isContentPixel = (r, g, b) => {
      const maxC = Math.max(r, g, b);
      const minC = Math.min(r, g, b);
      const saturation = maxC - minC;
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      // Content is either sufficiently dark (text/lines) or colorful (UIDAI header, emblem, photo)
      return lum < 192 || saturation >= 24;
    };

    let minY = 0, maxY = h - 1, minX = 0, maxX = w - 1;

    // Scan from top downwards (up to 45% of height)
    topLoop: for (let y = 0; y < Math.floor(h * 0.45); y++) {
      let contentPixels = 0;
      for (let x = 0; x < w; x += 3) {
        const idx = (y * w + x) * 4;
        if (isContentPixel(data[idx], data[idx + 1], data[idx + 2])) {
          contentPixels++;
          if (contentPixels > (w / 3) * 0.02) {
            minY = Math.max(0, y - 4);
            break topLoop;
          }
        }
      }
    }

    // Scan from bottom upwards (up to 45% of height)
    bottomLoop: for (let y = h - 1; y > Math.floor(h * 0.55); y--) {
      let contentPixels = 0;
      for (let x = 0; x < w; x += 3) {
        const idx = (y * w + x) * 4;
        if (isContentPixel(data[idx], data[idx + 1], data[idx + 2])) {
          contentPixels++;
          if (contentPixels > (w / 3) * 0.02) {
            maxY = Math.min(h - 1, y + 4);
            break bottomLoop;
          }
        }
      }
    }

    // Scan from left to right (up to 45% of width)
    leftLoop: for (let x = 0; x < Math.floor(w * 0.45); x++) {
      let contentPixels = 0;
      for (let y = minY; y <= maxY; y += 3) {
        const idx = (y * w + x) * 4;
        if (isContentPixel(data[idx], data[idx + 1], data[idx + 2])) {
          contentPixels++;
          if (contentPixels > ((maxY - minY) / 3) * 0.02) {
            minX = Math.max(0, x - 4);
            break leftLoop;
          }
        }
      }
    }

    // Scan from right to left (up to 45% of width)
    rightLoop: for (let x = w - 1; x > Math.floor(w * 0.55); x--) {
      let contentPixels = 0;
      for (let y = minY; y <= maxY; y += 3) {
        const idx = (y * w + x) * 4;
        if (isContentPixel(data[idx], data[idx + 1], data[idx + 2])) {
          contentPixels++;
          if (contentPixels > ((maxY - minY) / 3) * 0.02) {
            maxX = Math.min(w - 1, x + 4);
            break rightLoop;
          }
        }
      }
    }

    const cropWidth = maxX - minX;
    const cropHeight = maxY - minY;

    // Apply crop if a meaningful empty border was detected (at least 3% on any axis)
    if (cropWidth > 50 && cropHeight > 50 && (cropWidth < w * 0.97 || cropHeight < h * 0.97)) {
      const outCanvas = document.createElement('canvas');
      outCanvas.width = cropWidth;
      outCanvas.height = cropHeight;
      const outCtx = outCanvas.getContext('2d');
      outCtx.imageSmoothingEnabled = true;
      outCtx.imageSmoothingQuality = 'high';
      outCtx.drawImage(canvas, minX, minY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
      return outCanvas.toDataURL('image/png'); // Lossless PNG for maximum text clarity
    }
  } catch (e) {
    console.warn('autoCropWhiteBorders error:', e);
  }
  return img.src;
}

/**
 * Save / Download Complete Guest Registration PDF to Owner's Computer
 * (Includes ALL scanned copies, live photos, and complete details)
 */
export async function downloadGuestRegistrationPDF(data, options = { includePhotos: true }) {
  if (!data) return false;

  const includePhotos = options?.includePhotos !== false;
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const yymmdd = `${yy}${mm}${dd}`;
  const rawVoucherNo = data.voucher_number || data.voucherNumber || data.voucher_no || data.voucherNo || `${yymmdd}-001`;
  const voucherNo = cleanVoucherNumber(rawVoucherNo);
  const guestName = (data.guestName || data.guest_name || 'Guest').replace(/[^a-zA-Z0-9_-]/g, '_');
  const prefix = includePhotos ? 'Registration' : 'CheckIn_Form';
  const filename = options?.filename || `${prefix}_${voucherNo}_${guestName}.pdf`;

  const htmlContent = buildGuestRegistrationHTML(data, { includePhotos });

  // Outer offscreen sandbox: placed offscreen to hide from user during generation
  // 755px corresponds to 200mm inner printable width at 96 DPI, ensuring exact symmetrical margins
  const sandbox = document.createElement('div');
  sandbox.id = 'temp-pdf-sandbox';
  sandbox.style.position = 'fixed';
  sandbox.style.left = '-99999px';
  sandbox.style.top = '0';
  sandbox.style.width = '755px';
  sandbox.style.overflow = 'hidden';

  // Target element: has relative in-flow coordinates and full 100% opacity so deepCloneBasic preserves full opacity
  const targetEl = document.createElement('div');
  targetEl.id = 'temp-pdf-export-target';
  targetEl.style.position = 'relative';
  targetEl.style.width = '755px';
  targetEl.style.background = '#ffffff';
  targetEl.style.color = '#000000';
  targetEl.style.boxSizing = 'border-box';
  targetEl.innerHTML = htmlContent;

  sandbox.appendChild(targetEl);
  document.body.appendChild(sandbox);

  // Pre-load, decode, and auto-crop scanned images so they fill the slot and remove excess scanner margins
  try {
    const imgElements = Array.from(targetEl.querySelectorAll('img'));
    await Promise.all(imgElements.map(img => {
      return new Promise((resolve) => {
        const onReady = () => {
          try {
            if (img.classList.contains('annexure-id-doc')) {
              const cropped = autoCropWhiteBorders(img);
              if (cropped && cropped !== img.src) {
                img.src = cropped;
              }
            }
          } catch (e) {}
          resolve();
        };

        if (img.complete && img.naturalWidth !== 0) {
          onReady();
        } else {
          img.onload = onReady;
          img.onerror = () => resolve();
          setTimeout(resolve, 800);
        }
      });
    }));
  } catch (_) {}

  const opt = {
    margin: [8, 5, 5, 5],
    filename: filename,
    image: { type: 'jpeg', quality: 1.0 },
    html2canvas: {
      scale: 2.8,
      useCORS: true,
      logging: false,
      scrollY: 0,
      windowWidth: 755
    },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    pagebreak: {
      mode: ['legacy'],
      after: '.html2pdf__page-break'
    }
  };

  try {
    await html2pdf().set(opt).from(targetEl).save();
    return true;
  } catch (err) {
    console.warn('html2pdf direct save error, falling back to print window:', err);
    printGuestRegistrationA4(data, { includePhotos: true, windowTitle: filename });
    return false;
  } finally {
    if (document.body.contains(sandbox)) {
      document.body.removeChild(sandbox);
    }
  }
}

/**
 * Customer Payment Summary Statement (Single Page A4 Sheet)
 * Lists all payments, date & time, payment modes with details, amounts, cashier, and net total.
 */
export function buildGuestPaymentSummaryHTML(data) {
  if (!data) return '';

  const guestName = data.guest_name || data.guestName || data.primaryGuest?.name || data.customer_name || 'Valued Guest';
  const roomNo = data.room_numbers || data.room_number || data.roomNumber || data.room_name || data.room || '-';
  const roomType = data.room_type || data.roomType || '-';
  const rawVoucherNo = data.voucher_no || data.voucher_number || data.voucherNumber || (data.id ? `VCH-${data.id}` : '-');
  const voucherNo = cleanVoucherNumber(rawVoucherNo);
  const formatStayDateTime = (dateVal, timeVal) => {
    let combined = dateVal;
    if (!combined && timeVal) combined = timeVal;
    else if (dateVal && timeVal && typeof dateVal === 'string' && !dateVal.includes('T') && !dateVal.includes(' ') && typeof timeVal === 'string') {
      combined = `${dateVal}T${timeVal}`;
    }
    if (!combined) return '-';
    try {
      const d = new Date(combined);
      if (isNaN(d.getTime())) {
        return String(combined);
      }
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      let h = d.getHours();
      const m = String(d.getMinutes()).padStart(2, '0');
      const ampm = h >= 12 ? 'pm' : 'am';
      h = h % 12;
      if (h === 0) h = 12;
      const hStr = String(h).padStart(2, '0');
      return `${day}/${month}/${year}, ${hStr}:${m} ${ampm}`;
    } catch (e) {
      return String(combined);
    }
  };

  const rawCheckIn = data.checkin_time || data.checkinTime || data.check_in_time || data.check_in || data.checkin || data.check_in_date || data.checkInDate || data.checked_in_at || data.created_at;
  const checkIn = formatStayDateTime(rawCheckIn, data.checkinTime);

  const rawCheckOut = data.actual_checkout_time || data.actualCheckoutTime || data.checkout_time || data.checkoutTime || data.approx_checkout_time || data.approxCheckoutTime || data.check_out_time || data.check_out || data.checkout || data.check_out_date || data.checkOutDate || data.checked_out_at;
  const checkOut = formatStayDateTime(rawCheckOut, data.checkoutTime);

  const mobile = data.phone || data.mobile || data.mobile_number || data.phone_number || '-';
  const cashierName = data.cashier_name || data.cashier || data.staff_name || getActiveCashierName() || 'Cashier';
  const printDate = new Date().toLocaleString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });

  // Gather payments
  let payments = [];
  if (Array.isArray(data.payments) && data.payments.length > 0) {
    payments = [...data.payments];
  } else if (data.advance_amount > 0 || data.amount > 0 || data.total_paid > 0) {
    payments = [{
      id: data.id || 1,
      receipt_no: data.receipt_no || data.receipt_number || (data.voucher_no ? `RCP-${data.voucher_no}` : 'RCP-001'),
      amount: Number(data.advance_amount || data.amount || data.total_paid || 0),
      payment_mode: data.payment_mode || data.paymentMode || 'Cash',
      cheque_no: data.cheque_no || data.chequeNo || '',
      bank_name: data.bank_name || data.bank || '',
      utr_number: data.utr_number || data.utr || '',
      card_surcharge: data.card_surcharge || 0,
      upi_tax: data.upi_tax || 0,
      created_at: data.created_at || data.check_in || new Date(),
      purpose: data.particulars || 'paid while checkin : checkin',
      cashier: cashierName
    }];
  }

  // Calculate total settled
  const totalSettled = payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  const totalInWords = amountToWordsIndian(totalSettled);

  // Generate rows with clean single-line particulars and complete table cell borders
  const rowsHtml = payments.length > 0 ? payments.map((p, idx) => {
    const pDate = p.created_at || p.payment_date || p.date ? new Date(p.created_at || p.payment_date || p.date).toLocaleString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }) : '-';
    
    // Receipt No formatting (e.g. 260918-254)
    const rawRcp = p.receipt_no || p.receipt_number || p.receiptNo || (p.id ? `RCP-${p.id}` : `RCP-${idx + 1}`);
    const rcpFormatted = String(rawRcp).replace(/^20(\d{6}-\d+)$/, '$1');

    // Payment details breakdown
    const mode = String(p.payment_mode || p.mode || 'Cash').toUpperCase();
    const details = [];
    if (p.utr_number) details.push(`UTR: ${p.utr_number}`);
    if (p.cheque_no) details.push(`Chq: ${p.cheque_no}${p.bank_name ? ` (${p.bank_name})` : ''}`);
    if (p.card_surcharge > 0) details.push(`+₹${p.card_surcharge} Fee`);
    if (p.upi_tax > 0) details.push(`+₹${p.upi_tax} Tax`);
    const modeDetailStr = details.length > 0 ? `<div style="font-size: 7.8pt; color: #0284c7; margin-top: 2px;">${details.join(' • ')}</div>` : '';

    let rawPurpose = p.purpose || p.notes || p.description || p.particulars || 'Room Stay Payment';
    let purposeStr = rawPurpose;

    // Single-line particulars without redundant guest name in parentheses
    // "Advance payment at check-in for Room 101 (Md Yahya Ab Wahid Mundewadi)" -> "paid while checkin : checkin"
    if (/advance\s+payment\s+at\s+check-?in/i.test(rawPurpose)) {
      purposeStr = 'paid while checkin : checkin';
    } else if (/settlement\s+at\s+check-?out/i.test(rawPurpose)) {
      purposeStr = 'paid during checkout : settlement';
    } else {
      purposeStr = rawPurpose.replace(/\s*\([^)]*\)/g, '').trim();
    }

    const pCashier = p.cashier_name || p.cashier || p.staff_name || cashierName;
    const pAmt = Number(p.amount) || 0;

    return `
      <tr style="background: ${idx % 2 === 0 ? '#ffffff' : '#f8fafc'}; border-bottom: 1px solid #cbd5e1;">
        <td style="padding: 7px 6px; font-weight: 800; text-align: center; color: #475569; border-right: 1px solid #cbd5e1;">${idx + 1}</td>
        <td style="padding: 7px 8px; font-weight: 750; color: #0f172a; white-space: nowrap; border-right: 1px solid #cbd5e1;">${pDate}</td>
        <td style="padding: 7px 8px; font-weight: 900; color: #b91c1c; white-space: nowrap; text-align: center; border-right: 1px solid #cbd5e1;">
          <span style="border: 1px solid #b91c1c; background: #fee2e2; padding: 2px 7px; border-radius: 4px; font-size: 9pt;">${escapeHtml(rcpFormatted)}</span>
        </td>
        <td style="padding: 7px 8px; font-weight: 800; color: #1e3a8a; border-right: 1px solid #cbd5e1;">
          <div>${escapeHtml(mode)}</div>
          ${modeDetailStr}
        </td>
        <td style="padding: 7px 8px; font-size: 8.5pt; font-weight: 700; color: #334155; white-space: nowrap; border-right: 1px solid #cbd5e1;">
          ${escapeHtml(purposeStr)}
        </td>
        <td style="padding: 7px 8px; font-size: 8.5pt; font-weight: 700; color: #475569; text-align: center; border-right: 1px solid #cbd5e1;">
          ${escapeHtml(pCashier)}
        </td>
        <td style="padding: 7px 10px; font-weight: 950; font-size: 10.5pt; color: #15803d; text-align: right; white-space: nowrap;">
          ₹ ${pAmt.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
        </td>
      </tr>
    `;
  }).join('') : `
    <tr>
      <td colspan="7" style="padding: 24px; text-align: center; color: #64748b; font-weight: 750;">
        No payment records found for this stay.
      </td>
    </tr>
  `;

  return `
    <div class="full-a4-registration-card guest-payment-summary-sheet" style="position: relative; width: 100%; box-sizing: border-box; font-family: Arial, Helvetica, sans-serif; color: #000; border: 3.5px solid #1e3a8a; padding: 12px 16px; background: #fff; line-height: 1.35; display: flex; flex-direction: column; justify-content: space-between; min-height: 275mm; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important;">
      <!-- Watermark Crest -->
      <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); opacity: 0.04; pointer-events: none; z-index: 0; text-align: center; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important;">
        <img src="/HCP New Logo Png_witought-name.png" alt="" style="width: 440px; height: auto;" loading="eager" decoding="sync" />
      </div>

      <div style="position: relative; z-index: 1; display: flex; flex-direction: column; flex: 1; justify-content: space-between;">
        <div>
          <!-- HEADER -->
          <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #1e3a8a; padding-bottom: 8px; margin-bottom: 10px;">
            <!-- Logo + Hotel Info -->
            <div style="display: flex; align-items: center; gap: 14px;">
              <img src="/hcp-logo-with-name.png" alt="Hotel CityPaark" style="height: 68px; width: auto; object-fit: contain;" loading="eager" decoding="sync" />
              <div>
                <h1 style="margin: 0; font-size: 20pt; font-weight: 900; font-family: Georgia, serif; letter-spacing: 0.5px; color: #1e3a8a; line-height: 1.1;">HOTEL CityPaark</h1>
                <div style="margin: 2px 0 0; font-size: 8.5pt; font-weight: 850; color: #1e3a8a; letter-spacing: 0.5px; text-transform: uppercase;">
                  by JMG HOSPITALITY AND INFRA LLP
                </div>
                <p style="margin: 2px 0 0; font-size: 8.5pt; font-weight: 750; color: #1e293b; white-space: nowrap;">
                  119, Murarji Peth, Char Hutatma Chowk, Solapur - 413 001 (Maharashtra)
                </p>
                <p style="margin: 2px 0 0; font-size: 8.5pt; color: #0284c7; font-weight: 600; display: flex; align-items: center; gap: 4px; flex-wrap: wrap;">
                  <img src="/phone-call.png" alt="" style="width: 12px; height: 12px; object-fit: contain; vertical-align: middle;" loading="eager" decoding="sync" />
                  <span style="font-weight: 750; color: #0284c7;">: 0217-2729791, 92, 93, +91 9960013388, 9370013388</span>
                  <span style="margin: 0 4px; color: #64748b;">•</span>
                  <span style="color: #475569;">hcitypark@rediffmail.com</span>
                </p>
              </div>
            </div>

            <!-- Statement Badge Box -->
            <div style="text-align: right;">
              <div style="display: inline-block; background: #1e3a8a; color: #fff; padding: 4px 12px; border-radius: 4px; font-weight: 900; font-size: 11pt; letter-spacing: 0.04em;">
                PAYMENT SUMMARY STATEMENT
              </div>
              <div style="margin-top: 5px; font-size: 8.5pt; color: #475569; font-weight: 750;">
                Generated: <strong>${printDate}</strong>
              </div>
            </div>
          </div>

          <!-- GUEST & STAY INFORMATION CARD -->
          <div style="border: 1.5px solid #94a3b8; border-radius: 6px; background: #f8fafc; padding: 10px 14px; margin-bottom: 12px;">
            <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; font-size: 9pt;">
              <div>
                <span style="color: #64748b; font-size: 8pt; font-weight: 800; text-transform: uppercase; display: block;">Guest Name</span>
                <strong style="color: #0f172a; font-size: 10.5pt;">${escapeHtml(guestName)}</strong>
              </div>
              <div>
                <span style="color: #64748b; font-size: 8pt; font-weight: 800; text-transform: uppercase; display: block;">Room Assigned</span>
                <strong style="color: #1e3a8a; font-size: 10.5pt;">Room ${escapeHtml(roomNo)} ${roomType !== '-' ? `(${escapeHtml(roomType)})` : ''}</strong>
              </div>
              <div>
                <span style="color: #64748b; font-size: 8pt; font-weight: 800; text-transform: uppercase; display: block;">Check-In</span>
                <strong style="color: #0f172a;">${checkIn}</strong>
              </div>
              <div>
                <span style="color: #64748b; font-size: 8pt; font-weight: 800; text-transform: uppercase; display: block;">Check-Out</span>
                <strong style="color: #0f172a;">${checkOut}</strong>
              </div>
              <div>
                <span style="color: #64748b; font-size: 8pt; font-weight: 800; text-transform: uppercase; display: block;">Contact / Phone</span>
                <strong style="color: #0f172a;">${escapeHtml(mobile)}</strong>
              </div>
              <div>
                <span style="color: #64748b; font-size: 8pt; font-weight: 800; text-transform: uppercase; display: block;">Folio / Voucher Ref</span>
                <strong style="color: #0f172a;">${escapeHtml(voucherNo)}</strong>
              </div>
              <div>
                <span style="color: #64748b; font-size: 8pt; font-weight: 800; text-transform: uppercase; display: block;">Total Transactions</span>
                <strong style="color: #1e3a8a;">${payments.length} Payment(s)</strong>
              </div>
              <div>
                <span style="color: #64748b; font-size: 8pt; font-weight: 800; text-transform: uppercase; display: block;">Payment Status</span>
                <strong style="color: #15803d;">✓ Verified &amp; Settled</strong>
              </div>
            </div>
          </div>

          <!-- ITEMIZED PAYMENTS TABLE -->
          <div style="border: 1.5px solid #1e3a8a; border-radius: 6px; overflow: hidden; margin-bottom: 12px; background: #ffffff;">
            <div style="background: #1e3a8a; color: #fff; padding: 7px 12px; font-weight: 900; font-size: 9.5pt; letter-spacing: 0.03em; border-bottom: 1px solid #1e3a8a;">
              ITEMIZED PAYMENTS &amp; SETTLEMENT LOG
            </div>
            <table style="width: 100%; border-collapse: collapse; font-size: 8.8pt; margin: 0;">
              <thead>
                <tr style="background: #f1f5f9; text-transform: uppercase; font-size: 8pt; color: #1e293b; font-weight: 900; border-bottom: 1.5px solid #94a3b8;">
                  <th style="padding: 8px 6px; text-align: center; width: 6%; border-right: 1px solid #cbd5e1; white-space: nowrap;">No.</th>
                  <th style="padding: 8px 8px; text-align: left; width: 20%; border-right: 1px solid #cbd5e1; white-space: nowrap;">Date &amp; Time</th>
                  <th style="padding: 8px 8px; text-align: center; width: 15%; border-right: 1px solid #cbd5e1; white-space: nowrap;">Receipt No</th>
                  <th style="padding: 8px 8px; text-align: left; width: 12%; border-right: 1px solid #cbd5e1; white-space: nowrap;">Mode</th>
                  <th style="padding: 8px 8px; text-align: left; width: 26%; border-right: 1px solid #cbd5e1; white-space: nowrap;">Particulars</th>
                  <th style="padding: 8px 8px; text-align: center; width: 9%; border-right: 1px solid #cbd5e1; white-space: nowrap;">Cashier</th>
                  <th style="padding: 8px 10px; text-align: right; width: 12%; white-space: nowrap;">Amount (₹)</th>
                </tr>
              </thead>
              <tbody>
                ${rowsHtml}
              </tbody>
              <tfoot>
                <tr style="background: #f8fafc; border-top: 1.5px solid #94a3b8;">
                  <td colspan="6" style="padding: 9px 12px; font-weight: 900; font-size: 9.5pt; color: #0f172a; text-align: right; text-transform: uppercase; border-right: 1px solid #cbd5e1;">
                    Total Net Amount Settled &amp; Received:
                  </td>
                  <td style="padding: 9px 10px; font-weight: 950; font-size: 11pt; color: #15803d; text-align: right; white-space: nowrap;">
                    ₹ ${totalSettled.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <!-- AMOUNT IN WORDS -->
          <div style="background: #f8fafc; border: 1.5px solid #cbd5e1; border-radius: 6px; padding: 7px 12px; margin-bottom: 14px; font-size: 9pt;">
            <span style="color: #64748b; font-weight: 800; text-transform: uppercase; margin-right: 6px;">Amount in Words:</span>
            <strong style="color: #0f172a; font-style: italic;">Rupees ${escapeHtml(totalInWords)}</strong>
          </div>
        </div>

        <!-- FOOTER & SIGNATURES -->
        <div style="padding-top: 20px; border-top: 1.5px solid #cbd5e1; margin-top: auto;">
          <div style="display: flex; justify-content: space-between; align-items: flex-end; padding: 20px 20px 0;">
            <!-- Guest Signature -->
            <div style="text-align: center;">
              <div style="border-bottom: 1.5px solid #000; width: 175px; height: 35px; margin-bottom: 4px;"></div>
              <div style="font-size: 9pt; font-weight: 800; color: #0f172a;">Guest Signature</div>
            </div>

            <!-- Cashier / Authorized Signatory -->
            <div style="display: flex; flex-direction: column; align-items: center; min-width: 175px;">
              <div style="font-size: 8.5pt; font-weight: 850; color: #0f172a; margin-bottom: 2px;">
                ${escapeHtml(cashierName)}
              </div>
              <div style="border-bottom: 1.5px solid #000; width: 175px; margin-bottom: 3px;"></div>
              <div style="font-size: 9.5pt; font-weight: 900; color: #1e3a8a; text-align: center;">
                For HOTEL CITY PARK
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

export function printGuestPaymentSummary(data, options = {}) {
  if (!data) return;

  const sheet = document.getElementById('print-payment-summary-sheet');
  if (!sheet) {
    console.warn('print-payment-summary-sheet element not found in DOM');
    return;
  }

  const exitThemeIsolation = enterPrintThemeIsolation();

  const prevTitle = document.title;
  const guestName = (data.guest_name || data.guestName || 'Guest').replace(/[^a-zA-Z0-9_-]/g, '_');
  const roomNo = data.room_numbers || data.room_number || data.room || '';
  document.title = `Payment_Summary_Room_${roomNo}_${guestName}`;

  sheet.innerHTML = buildGuestPaymentSummaryHTML(data);

  sheet.style.display = 'block';
  sheet.classList.add('print-active');
  document.body.classList.add('print-sheet-active');

  const cleanup = () => {
    sheet.classList.remove('print-active');
    sheet.style.display = 'none';
    document.body.classList.remove('print-sheet-active');
    document.title = prevTitle;
    window.removeEventListener('afterprint', cleanup);
    exitThemeIsolation();
  };
  window.addEventListener('afterprint', cleanup, { once: true });

  requestAnimationFrame(() => {
    setTimeout(() => {
      window.print();
      setTimeout(cleanup, 2500);
    }, 40);
  });
}

/**
 * Save / Download Guest Payment Summary PDF to Owner's Computer
 */
export async function downloadGuestPaymentSummaryPDF(data, options = {}) {
  if (!data) return false;
  const guestName = (data.guest_name || data.guestName || data.primaryGuest?.name || 'Guest').replace(/[^a-zA-Z0-9_-]/g, '_');
  const roomNo = data.room_numbers || data.room_number || data.room || '';
  const filename = options?.filename || `Payment_Summary_Room_${roomNo}_${guestName}.pdf`;
  const htmlContent = buildGuestPaymentSummaryHTML(data);

  const sandbox = document.createElement('div');
  sandbox.id = 'temp-pdf-sandbox';
  sandbox.style.position = 'fixed';
  sandbox.style.left = '-99999px';
  sandbox.style.top = '0';
  sandbox.style.width = '755px';
  sandbox.style.overflow = 'hidden';

  const targetEl = document.createElement('div');
  targetEl.style.position = 'relative';
  targetEl.style.width = '755px';
  targetEl.style.background = '#ffffff';
  targetEl.style.color = '#000000';
  targetEl.style.boxSizing = 'border-box';
  targetEl.innerHTML = htmlContent;

  sandbox.appendChild(targetEl);
  document.body.appendChild(sandbox);

  const opt = {
    margin: [8, 5, 5, 5],
    filename: filename,
    image: { type: 'jpeg', quality: 1.0 },
    html2canvas: { scale: 2.5, useCORS: true, logging: false, scrollY: 0, windowWidth: 755 },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
  };

  try {
    await html2pdf().set(opt).from(targetEl).save();
    return true;
  } catch (err) {
    console.warn('html2pdf payment summary save error, falling back to print:', err);
    printGuestPaymentSummary(data, { windowTitle: filename });
    return false;
  } finally {
    if (document.body.contains(sandbox)) {
      document.body.removeChild(sandbox);
    }
  }
}

/**
 * Builds Full A4 Final Checkout Tax Invoice HTML
 * Matching authentic Hotel City Paark paper invoice:
 * - Hotel Address & Contact on Left, Logo Crest on Right
 * - Center "TAX INVOICE"
 * - Two-column Meta details (Guest info, Room, Invoice No, Reg No, Pax, Arrival/Departure Date & Time)
 * - Centered Background Watermark Logo with clean print opacity
 * - Table with SAC: 996311, Room Tariff, Discount, Effective Tariff, CGST @ 2.5%, SGST @ 2.5%, Extras, F&B, Round-off, Invoice Total
 * - Invoice Total in Words
 * - Right-aligned Settlement Summary (Gross Payable, Advance Received, Net Payable Amount & in words)
 * - Check-in by & Check-out by
 * - Stamp badge, GST No., PAN No., HDFC Bank account details, jurisdiction
 * - Signature of Guest & For Hotel City Paark Authorised Signatory
 */
export function buildFinalBillA4HTML(room = {}, calc = {}, settlement = {}) {
  // Normalize room and folioData
  const r = room?.room || room || {};
  const c = calc || {};
  const s = settlement || {};
  const summary = c?.summary || {};

  // Date and Time formatters
  const formatInvoiceDate = (dt) => {
    if (!dt) return '-';
    try {
      const d = new Date(dt);
      if (isNaN(d.getTime())) return String(dt).split(' ')[0] || String(dt);
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      return `${day}-${month}-${year}`;
    } catch (e) {
      return String(dt);
    }
  };

  const formatInvoiceTime = (dt) => {
    if (!dt) return '-';
    try {
      const d = new Date(dt);
      if (isNaN(d.getTime())) return String(dt).split(' ')[1] || String(dt);
      const hours = String(d.getHours()).padStart(2, '0');
      const minutes = String(d.getMinutes()).padStart(2, '0');
      const seconds = String(d.getSeconds()).padStart(2, '0');
      return `${hours}:${minutes}:${seconds}`;
    } catch (e) {
      return String(dt);
    }
  };

  const formatShortDate = (dt) => {
    if (!dt) return '';
    try {
      const d = new Date(dt);
      if (isNaN(d.getTime())) return '';
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      return `${day}/${month}`;
    } catch (e) {
      return '';
    }
  };

  // Guest details
  const guestName = (r.guest_name || r.guestName || c.guestName || c.guest_name || 'Valued Guest').toUpperCase();
  const rawAddress = r.address || c.address || r.city || '';
  const address = rawAddress.trim();
  const mobile = r.mobile || r.guest_phone || r.phone || c.mobile || c.phone || '';
  const guestGstin = r.gstin || r.guest_gstin || c.gstin || c.guestGstin || '';

  // Stay / Invoice metadata
  const bookingId = r.current_booking_id || r.booking_id || c.bookingId || c.booking_id || r.id || '';
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const fallbackVoucher = `${yy}${mm}${dd}-${String(bookingId || 1).padStart(3, '0')}`;

  const rawVoucher = r.voucher_number || r.voucher_no || c.voucher_no || c.voucher_number || s.voucher_no || s.voucher_number || r.checkin_voucher_no || s.invoiceNo || s.invoice_no || c.invoice_no || r.invoice_no || fallbackVoucher;
  const checkinFormNo = cleanVoucherNumber(rawVoucher);
  // User Requirement: "invoice number will be same as (check in form number)" & "wher ever is like this 20260920-520 should be 260920-520"
  const invoiceNo = checkinFormNo;
  const regNo = checkinFormNo;
  const roomNum = r.room_number || r.roomNumber || c.room_number || '310';
  const roomType = r.room_type || r.roomType || c.room_type || '';

  const adults = (Number(r.adults_male || 0) + Number(r.adults_female || 0) + Number(r.adults_other || 0)) || Number(r.adults || 0) || 1;
  const children = Number(r.children || 0);
  const paxStr = children > 0 ? `${adults + children}` : `${adults}`;

  const arrivalDt = r.checkin_time || r.checkinTime || c.checkin_time || c.checkinTime || new Date();
  const departureDt = s.settled_at || r.actual_checkout_time || r.checkout_time || new Date();
  const arrivalDate = formatInvoiceDate(arrivalDt);
  const arrivalTime = formatInvoiceTime(arrivalDt);
  const departureDate = formatInvoiceDate(departureDt);
  const departureTime = formatInvoiceTime(departureDt);

  const stayStartShort = formatShortDate(arrivalDt);
  const stayEndShort = formatShortDate(departureDt);
  const stayPeriodStr = (stayStartShort && stayEndShort) ? `${stayStartShort} - ${stayEndShort}` : (stayStartShort || '');

  // Duration & Billable Days
  const billableDays = Number(c.billableDays || c.chargedDays || summary.chargedDays || c.days || 1);

  // Financial Breakdown
  const discountPct = Number(c.discountPct || summary.discountPct || r.discount_pct || 0);
  const discountAmt = Number(c.discountAmount || summary.discountAmount || r.discount_amount || 0);

  let grossTariff = Number(c.grossTariff || summary.grossTariff || 0);
  let effectiveTariff = Number(c.roomTariffNet || 0);

  if (effectiveTariff <= 0) {
    const rawCharge = Number(c.roomCharge || summary.roomCharge || r.total_room_charge || r.room_rate || 0);
    const rawGst = Number(c.tariffTax5Pct || c.totalGst || summary.taxAmount || c.taxAmount || 0);
    if (rawGst > 0) {
      effectiveTariff = Math.max(0, rawCharge - rawGst);
    } else {
      // Assuming standard 5% GST hospitality factor
      effectiveTariff = Math.round((rawCharge / 1.05) * 100) / 100;
    }
  }

  if (grossTariff <= 0) {
    grossTariff = discountAmt > 0 ? (effectiveTariff + discountAmt) : effectiveTariff;
  }

  // Taxes (CGST 2.5% + SGST 2.5% = 5%)
  let cgst = 0;
  let sgst = 0;
  const explicitTax = Number(c.tariffTax5Pct || c.totalGst || summary.taxAmount || 0);
  if (explicitTax > 0) {
    cgst = Number((explicitTax / 2).toFixed(2));
    sgst = Number((explicitTax - cgst).toFixed(2));
  } else {
    cgst = Number((effectiveTariff * 0.025).toFixed(2));
    sgst = Number((effectiveTariff * 0.025).toFixed(2));
  }

  // Other Charges
  const extraCharges = Number(c.hotelExtrasCharge || summary.hotelExtrasCharge || r.extra_bed_charge || r.extra_rooms_charge || 0);
  const foodTotal = Number(c.foodTotal || summary.foodTotal || 0);
  const barTotal = Number(c.barTotal || summary.barTotal || 0);

  // Surcharges
  const cardSurcharge = Number(s.cardSurcharge || s.card_surcharge || r.final_card_surcharge || r.advance_card_surcharge || 0);
  const upiTax = Number(s.upiTax || s.upi_tax || r.final_upi_tax || r.advance_upi_tax || 0);

  // Subtotal & Round-off
  const unroundedTotal = effectiveTariff + cgst + sgst + extraCharges + foodTotal + barTotal + cardSurcharge + upiTax;
  const invoiceTotal = Math.round(unroundedTotal);
  const roundOff = Number((invoiceTotal - unroundedTotal).toFixed(2));

  // Words formatter matching physical paper invoice: "Rs. Four Thousand Two Hundred And Forty Eight Only"
  const formatWords = (amt) => {
    if (!amt || amt <= 0) return 'Zero Only';
    const w = amountToWordsIndian(amt);
    const cleaned = w.replace(/\s*Rupees Only$/i, '').trim();
    const titleCased = cleaned.replace(/\band\b/gi, 'And');
    return `${titleCased} Only`;
  };

  const invoiceTotalWords = formatWords(invoiceTotal);

  // Settlement Details
  const grossPayable = invoiceTotal;
  const advanceReceived = Number(r.initial_paid || r.total_paid || c.advancePaid || summary.advancePaid || 0);
  const settleAmt = Number(s.settleAmt || s.amount || 0);
  const refundAmt = Number(s.refundAmt || 0);
  const netPayable = Math.max(0, grossPayable - advanceReceived);
  const netPayableWords = formatWords(netPayable);

  // Staff & Badge
  const checkInBy = r.checked_in_by || r.checkedInBy || c.checked_in_by || 'bhuvi';
  const checkOutBy = s.checked_out_by || s.checkedOutBy || r.checked_out_by || r.checkedOutBy || 'bhuvi';
  const badgeNo = r.room_number || '909';

  return `
    <div class="full-a4-registration-card tax-invoice-a4-sheet" style="position: relative; width: 100%; box-sizing: border-box; font-family: 'Segoe UI', Arial, sans-serif; color: #000; border: none; padding: 14px 24px; background: #fff; line-height: 1.35; min-height: 275mm; display: flex; flex-direction: column; justify-content: space-between; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important;">
      
      <!-- Elegant Centered Watermark Background Logo (Authentic Transparent Mauve/Rose Tint with Name) -->
      <div style="position: absolute; top: 48%; left: 50%; transform: translate(-50%, -50%); opacity: 0.14; pointer-events: none; z-index: 0; text-align: center; width: 100%; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important;">
        <img src="/hcp-logo-with-name-transparent.png" alt="Hotel CityPaark Watermark" style="width: 520px; max-width: 85%; height: auto; filter: contrast(120%) saturate(120%);" loading="eager" decoding="sync" />
      </div>

      <div style="position: relative; z-index: 1; display: flex; flex-direction: column; flex: 1; justify-content: space-between; background: transparent;">
        <div>
          <!-- TOP HEADER: Address (Left) & Brand Logo with Name + by JMG HOSPITALITY AND INFRA LLP centered directly below (Right) -->
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px; background: transparent;">
            <!-- Left Hotel Address & Contact -->
            <div style="font-size: 9.2pt; color: #000; line-height: 1.42; max-width: 60%;">
              <div style="white-space: nowrap; font-size: 9.2pt; font-weight: 500;">119, Murarji Peth, Char Hutatma Chowk, Solapur - 413 001 (Maharashtra)</div>
              <div>Tel.: 0217-2729791, 92, 93 Mob.: 9960013388</div>
              <div>E-mail : hcitypark@rediffmail.com</div>
              <div>website : hotelcityparksolapur.com</div>
            </div>

            <!-- Right Brand Logo with Name (Increased 50% in size) & centered by JMG HOSPITALITY AND INFRA LLP directly below -->
            <div style="display: flex; flex-direction: column; align-items: center; text-align: center;">
              <img src="/hcp-logo-with-name-transparent.png" alt="Hotel CityPaark" style="height: 84px; width: auto; object-fit: contain;" loading="eager" decoding="sync" />
              <div style="font-size: 8pt; font-weight: 700; color: #000; letter-spacing: 0.5px; margin-top: 3px; white-space: nowrap; font-family: 'Segoe UI', Arial, sans-serif;">
                <span style="font-weight: 500; text-transform: lowercase;">by</span> <span style="font-weight: 750; text-transform: uppercase;">JMG HOSPITALITY AND INFRA LLP</span>
              </div>
            </div>
          </div>

          <!-- Thin horizontal divider line across the page below header (exact as in photo) -->
          <div style="border-bottom: 1.5px solid #000; margin-top: 6px; margin-bottom: 10px;"></div>

          <!-- CENTER TAX INVOICE (No line below, exact as in photo) -->
          <div style="text-align: center; margin-bottom: 10px;">
            <span style="font-size: 15pt; font-weight: 900; font-family: Georgia, 'Times New Roman', serif; letter-spacing: 2px; color: #000; text-transform: uppercase;">
              TAX INVOICE
            </span>
          </div>

          <!-- GUEST & STAY META DETAILS (Exact Two-Column Layout from Photo with Unbroken Rows) -->
          <div style="display: flex; justify-content: space-between; font-size: 10pt; margin-bottom: 8px; line-height: 1.45; background: transparent;">
            <!-- Left Column: Guest Info -->
            <div style="width: 42%;">
              <div>
                <span style="font-weight: 700; color: #000;">Guest Name :</span>
                <strong style="color: #000; font-size: 11pt; margin-left: 6px;">${escapeHtml(guestName)}</strong>
              </div>
              <div style="margin-top: 3px;">
                <span style="font-weight: 700; color: #000;">Address :</span>
                <div style="padding-left: 55px; color: #000; font-weight: 800; text-transform: uppercase;">
                  ${escapeHtml(address || 'PUNE')}
                </div>
              </div>
              ${guestGstin ? `
              <div style="margin-top: 3px;">
                <span style="font-weight: 700; color: #000;">GSTIN :</span>
                <span style="color: #000; font-weight: 800; margin-left: 6px; font-family: monospace;">${escapeHtml(guestGstin)}</span>
              </div>
              ` : ''}
            </div>

            <!-- Right Column: Stay & Invoice Meta (Exact 2-Row Dates Layout with Time) -->
            <div style="width: 56%;">
              <table style="width: 100%; border-collapse: collapse; font-size: 10pt; line-height: 1.45; background: transparent;">
                <tbody>
                  <tr>
                    <td style="padding: 1.5px 0; color: #000; font-weight: 700; width: 25%; white-space: nowrap;">Invoice No. :</td>
                    <td style="padding: 1.5px 0; font-weight: 850; color: #000; width: 25%; white-space: nowrap;">${escapeHtml(invoiceNo)}</td>
                    <td style="padding: 1.5px 0; color: #000; font-weight: 700; width: 20%; white-space: nowrap; padding-left: 8px;">Reg. No. :</td>
                    <td style="padding: 1.5px 0; font-weight: 850; color: #000; width: 30%; white-space: nowrap;">${escapeHtml(regNo)}</td>
                  </tr>
                  <tr>
                    <td style="padding: 1.5px 0; color: #000; font-weight: 700; white-space: nowrap;">Room No. :</td>
                    <td colspan="3" style="padding: 1.5px 0; font-weight: 900; color: #000; white-space: nowrap;">
                      ${escapeHtml(roomNum)}
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 1.5px 0; color: #000; font-weight: 700; white-space: nowrap;">Pax :</td>
                    <td colspan="3" style="padding: 1.5px 0; font-weight: 850; color: #000; white-space: nowrap;">
                      ${escapeHtml(paxStr)}
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 1.5px 0; color: #000; font-weight: 700; white-space: nowrap;">Arrival Date :</td>
                    <td style="padding: 1.5px 0; font-weight: 800; color: #000; white-space: nowrap;">${arrivalDate}</td>
                    <td style="padding: 1.5px 0; color: #000; font-weight: 700; white-space: nowrap; padding-left: 8px;">Time :</td>
                    <td style="padding: 1.5px 0; font-weight: 800; color: #000; white-space: nowrap;">${arrivalTime}</td>
                  </tr>
                  <tr>
                    <td style="padding: 1.5px 0; color: #000; font-weight: 700; white-space: nowrap;">Departure Date :</td>
                    <td style="padding: 1.5px 0; font-weight: 800; color: #000; white-space: nowrap;">${departureDate}</td>
                    <td style="padding: 1.5px 0; color: #000; font-weight: 700; white-space: nowrap; padding-left: 8px;">Time :</td>
                    <td style="padding: 1.5px 0; font-weight: 800; color: #000; white-space: nowrap;">${departureTime}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- CHARGES TABLE (Exact structure matching photo: dashed headers, vertical line before Total column) -->
          <table style="width: 100%; border-collapse: collapse; font-size: 10pt; margin-bottom: 6px; border: none; background: transparent;">
            <thead>
              <tr style="border-top: 1.5px solid #000; border-bottom: 1px dashed #000; background: transparent;">
                <th style="padding: 5px 10px; text-align: left; font-weight: 900; color: #000; width: 46%;">
                  SAC: 996311
                </th>
                <th style="padding: 5px 10px; text-align: center; font-weight: 800; color: #000; width: 27%;">
                  ${stayStartShort && stayEndShort ? `${stayStartShort} &nbsp; &nbsp; &nbsp; ${stayEndShort}` : (stayStartShort || '')}
                </th>
                <th style="padding: 5px 10px; text-align: right; font-weight: 900; color: #000; width: 27%; border-left: 1.5px solid #000;">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              <!-- Room Tariff Gross -->
              <tr style="background: transparent;">
                <td style="padding: 4px 10px; font-weight: 750; color: #000;">
                  Room Tariff - ${billableDays > 1 ? `(${billableDays} Days)` : ''}
                </td>
                <td style="padding: 4px 10px; text-align: center; color: #000;">
                  ${grossTariff.toFixed(2)}
                </td>
                <td style="padding: 4px 10px; text-align: right; font-weight: 750; color: #000; border-left: 1.5px solid #000;">
                  ${grossTariff.toFixed(2)}
                </td>
              </tr>

              <!-- Discount if applied -->
              ${discountAmt > 0 ? `
              <tr style="background: transparent;">
                <td style="padding: 4px 10px; font-weight: 750; color: #000;">
                  Less Discount @${discountPct > 0 ? discountPct.toFixed(2) : ((discountAmt / grossTariff) * 100).toFixed(2)}%
                </td>
                <td style="padding: 4px 10px; text-align: center; font-weight: 750; color: #000;">
                  ${discountAmt.toFixed(2)}
                </td>
                <td style="padding: 4px 10px; text-align: right; font-weight: 800; color: #000; border-left: 1.5px solid #000;">
                  - ${discountAmt.toFixed(2)}
                </td>
              </tr>
              <tr style="background: transparent;">
                <td style="padding: 4px 10px; font-weight: 850; color: #000;">Effective Tariff</td>
                <td style="padding: 4px 10px; text-align: center; font-weight: 800; color: #000;">${effectiveTariff.toFixed(2)}</td>
                <td style="padding: 4px 10px; text-align: right; font-weight: 850; color: #000; border-left: 1.5px solid #000;">${effectiveTariff.toFixed(2)}</td>
              </tr>
              ` : ''}

              <!-- CGST & SGST 2.5% Each (5% Total GST) -->
              <tr style="background: transparent;">
                <td style="padding: 4px 10px; color: #000;">CGST @ 2.5%</td>
                <td style="padding: 4px 10px; text-align: center; color: #000;">${cgst.toFixed(2)}</td>
                <td style="padding: 4px 10px; text-align: right; font-weight: 750; color: #000; border-left: 1.5px solid #000;">${cgst.toFixed(2)}</td>
              </tr>
              <tr style="background: transparent;">
                <td style="padding: 4px 10px; color: #000;">SGST @ 2.5%</td>
                <td style="padding: 4px 10px; text-align: center; color: #000;">${sgst.toFixed(2)}</td>
                <td style="padding: 4px 10px; text-align: right; font-weight: 750; color: #000; border-left: 1.5px solid #000;">${sgst.toFixed(2)}</td>
              </tr>

              <!-- Extra bed / room charges if present -->
              ${extraCharges > 0 ? `
              <tr style="background: transparent;">
                <td style="padding: 4px 10px; color: #000;">Extra Bed &amp; Stay Extras</td>
                <td style="padding: 4px 10px; text-align: center; color: #000;">${extraCharges.toFixed(2)}</td>
                <td style="padding: 4px 10px; text-align: right; font-weight: 750; color: #000; border-left: 1.5px solid #000;">${extraCharges.toFixed(2)}</td>
              </tr>
              ` : ''}

              <!-- Food & Restaurant Orders if present -->
              ${foodTotal > 0 ? `
              <tr style="background: transparent;">
                <td style="padding: 4px 10px; color: #000;">Room Service &amp; Restaurant Charges</td>
                <td style="padding: 4px 10px; text-align: center; color: #000;">${foodTotal.toFixed(2)}</td>
                <td style="padding: 4px 10px; text-align: right; font-weight: 750; color: #000; border-left: 1.5px solid #000;">${foodTotal.toFixed(2)}</td>
              </tr>
              ` : ''}

              <!-- Bar Orders if present -->
              ${barTotal > 0 ? `
              <tr style="background: transparent;">
                <td style="padding: 4px 10px; color: #000;">Bar Lounge &amp; Beverages</td>
                <td style="padding: 4px 10px; text-align: center; color: #000;">${barTotal.toFixed(2)}</td>
                <td style="padding: 4px 10px; text-align: right; font-weight: 750; color: #000; border-left: 1.5px solid #000;">${barTotal.toFixed(2)}</td>
              </tr>
              ` : ''}

              <!-- Card surcharge or UPI tax if present -->
              ${cardSurcharge > 0 ? `
              <tr style="background: transparent;">
                <td style="padding: 4px 10px; color: #000;">Card POS Processing Fee (2.5%)</td>
                <td style="padding: 4px 10px; text-align: center; color: #000;">${cardSurcharge.toFixed(2)}</td>
                <td style="padding: 4px 10px; text-align: right; font-weight: 750; color: #000; border-left: 1.5px solid #000;">${cardSurcharge.toFixed(2)}</td>
              </tr>
              ` : ''}

              ${upiTax > 0 ? `
              <tr style="background: transparent;">
                <td style="padding: 4px 10px; color: #000;">UPI Convenience Tax (0.4%)</td>
                <td style="padding: 4px 10px; text-align: center; color: #000;">${upiTax.toFixed(2)}</td>
                <td style="padding: 4px 10px; text-align: right; font-weight: 750; color: #000; border-left: 1.5px solid #000;">${upiTax.toFixed(2)}</td>
              </tr>
              ` : ''}

              <!-- Round-off row -->
              <tr style="background: transparent;">
                <td style="padding: 4px 10px; color: #000;">Round-off</td>
                <td style="padding: 4px 10px; text-align: center;">&nbsp;</td>
                <td style="padding: 4px 10px; text-align: right; color: #000; font-weight: 700; border-left: 1.5px solid #000;">
                  ${roundOff !== 0 ? (roundOff > 0 ? `+${roundOff.toFixed(2)}` : roundOff.toFixed(2)) : '0.00'}
                </td>
              </tr>
            </tbody>
            <tfoot>
              <tr style="border-top: 1px dashed #000; border-bottom: 1.5px solid #000; background: transparent;">
                <td style="padding: 6px 10px; font-weight: 950; font-size: 11pt; color: #000;">
                  Invoice Total
                </td>
                <td style="padding: 6px 10px; text-align: center; font-weight: 800; color: #000;">
                  ${unroundedTotal.toFixed(2)}
                </td>
                <td style="padding: 6px 10px; text-align: right; font-weight: 950; font-size: 12.5pt; color: #000; border-left: 1.5px solid #000;">
                  ${invoiceTotal.toFixed(2)}
                </td>
              </tr>
            </tfoot>
          </table>

          <!-- INVOICE TOTAL IN WORDS -->
          <div style="font-size: 10.5pt; font-weight: 750; color: #000; padding: 4px 0 6px;">
            (Invoice Total In words : Rs. ${escapeHtml(invoiceTotalWords)})
          </div>

          <!-- Divider line across page under words (exact as in photo) -->
          <div style="border-bottom: 1.5px solid #000; margin-bottom: 8px;"></div>

          <!-- SETTLEMENT SUMMARY BOX (Right Aligned, exact as in photo) -->
          <div style="display: flex; justify-content: flex-end; margin-top: 4px; margin-bottom: 4px;">
            <div style="width: 360px; font-size: 10.5pt;">
              <table style="width: 100%; border-collapse: collapse; background: transparent;">
                <tbody>
                  <tr>
                    <td style="padding: 2px 0; font-weight: 750; color: #000;">Gross Payable Amount</td>
                    <td style="padding: 2px 0; text-align: right; font-weight: 800; color: #000;">${grossPayable.toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td style="padding: 2px 0; font-weight: 750; color: #000;">Advance Received</td>
                    <td style="padding: 2px 0; text-align: right; font-weight: 800; color: #000;">${advanceReceived.toFixed(2)}</td>
                  </tr>
                  <tr style="border-top: 1.5px solid #000;">
                    <td style="padding: 4px 0; font-weight: 900; font-size: 11.5pt; color: #000;">Net Payable Amount</td>
                    <td style="padding: 4px 0; text-align: right; font-weight: 950; font-size: 12.5pt; color: #000;">${netPayable.toFixed(2)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- NET PAYABLE IN WORDS -->
          <div style="font-size: 11pt; font-weight: 800; color: #000; margin: 8px 0 16px; text-align: left;">
            (Net Payable Amount In words : Rs. ${escapeHtml(netPayableWords)})
          </div>

          <!-- CHECK-IN / CHECK-OUT BY STAFF -->
          <div style="display: flex; justify-content: flex-end; gap: 40px; font-size: 9.5pt; font-weight: 750; color: #000; margin-bottom: 24px;">
            <div>Check-In by : <strong style="color: #000;">${escapeHtml(checkInBy)}</strong></div>
            <div>Check-Out by : <strong style="color: #000;">${escapeHtml(checkOutBy)}</strong></div>
          </div>
        </div>

        <!-- FOOTER: Stamp, Bank Details, Legal, and Signatures (exact as in photo) -->
        <div style="display: flex; justify-content: space-between; align-items: flex-end; padding-top: 10px; margin-top: auto; font-size: 9.5pt; background: transparent;">
          <!-- Left: Red Stamp Badge & Banking / Legal Info -->
          <div style="width: 44%;">
            <div style="display: inline-block; border: 1.8px solid #dc2626 !important; color: #dc2626 !important; border-radius: 50% / 50%; padding: 2px 14px; font-weight: 850; font-size: 12pt; letter-spacing: 1px; margin-bottom: 6px; transform: rotate(-5deg); font-family: 'Times New Roman', Georgia, serif; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important;">
              ${escapeHtml(badgeNo)}
            </div>
            <div style="font-weight: 850; color: #000; margin-bottom: 2px;">
              GST No. : <span style="font-family: monospace; font-size: 10pt; font-weight: 850;">27AAUFJ0434H1Z7</span>
            </div>
            <div style="font-weight: 850; color: #000; margin-bottom: 5px;">
              PAN No. : <span style="font-family: monospace; font-size: 10pt; font-weight: 850;">AAUFJ0434H</span>
            </div>
            <div style="font-size: 9pt; color: #000; line-height: 1.4; margin-top: 4px;">
              <div><strong>Bank :</strong> HDFC Bank Ltd.</div>
              <div><strong>A/c Name :</strong> JMG HOSPITALITY AND INFRA LLP</div>
              <div><strong>A/c No. :</strong> 50200111749594</div>
              <div><strong>IFSC Code :</strong> HDFC0000635</div>
            </div>
            <div style="font-size: 8pt; color: #000; margin-top: 6px; line-height: 1.3;">
              Subject to Solapur Jurisdiction<br/>
              E&amp;OE
            </div>
          </div>

          <!-- Center: Guest Signature -->
          <div style="text-align: center; width: 26%;">
            <div style="border-bottom: 1.5px solid #000; width: 140px; margin: 0 auto 6px;"></div>
            <div style="font-size: 9.5pt; font-weight: 750; color: #000;">Signature of Guest</div>
          </div>

          <!-- Right: Authorised Signatory -->
          <div style="text-align: right; width: 30%;">
            <div style="font-size: 10.5pt; font-weight: 900; color: #000; margin-bottom: 38px;">
              For Hotel City Paark
            </div>
            <div style="border-top: 1.5px solid #000; display: inline-block; padding-top: 4px; font-size: 9.5pt; font-weight: 800; color: #000;">
              Authorised Signatory
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

/**
 * Full A4 Final Invoice Bill Print
 */
export function printFinalBillA4(room, calc, settlement) {
  if (!room) return;

  const sheet = document.getElementById('print-registration-sheet');
  if (!sheet) {
    console.warn('print-registration-sheet element not found in DOM');
    return;
  }

  const prevTitle = document.title;
  const guestName = (room.guest_name || room.guestName || calc?.guestName || 'Guest').replace(/[^a-zA-Z0-9_-]/g, '_');
  const roomNum = room.room_number || room.roomNumber || calc?.room_number || '';
  document.title = `Tax_Invoice_Room_${roomNum}_${guestName}`;

  const exitThemeIsolation = enterPrintThemeIsolation();

  sheet.innerHTML = buildFinalBillA4HTML(room, calc, settlement);

  sheet.style.display = 'block';
  sheet.classList.add('print-active');
  document.body.classList.add('print-sheet-active');

  const cleanup = () => {
    sheet.classList.remove('print-active');
    sheet.style.display = 'none';
    document.body.classList.remove('print-sheet-active');
    document.title = prevTitle;
    window.removeEventListener('afterprint', cleanup);
    exitThemeIsolation();
  };
  window.addEventListener('afterprint', cleanup, { once: true });

  // Ensure all images (logo & watermark) are fully loaded and decoded before triggering print dialog
  const images = Array.from(sheet.querySelectorAll('img'));
  const waitPromises = images.map(img => {
    if (img.complete && img.naturalWidth > 0) return Promise.resolve();
    if (img.decode) {
      return img.decode().catch(() => Promise.resolve());
    }
    return new Promise(resolve => {
      img.onload = resolve;
      img.onerror = resolve;
    });
  });

  Promise.all(waitPromises).then(() => {
    requestAnimationFrame(() => {
      setTimeout(() => {
        window.print();
        setTimeout(cleanup, 3000);
      }, 60);
    });
  });
}

/**
 * Save / Download Full A4 Final Tax Invoice PDF to Owner's Computer
 */
export async function downloadFinalBillPDF(room, calc, settlement, options = {}) {
  if (!room) return false;
  const guestName = (room.guest_name || room.guestName || calc?.guestName || 'Guest').replace(/[^a-zA-Z0-9_-]/g, '_');
  const roomNum = room.room_number || room.roomNumber || calc?.room_number || '';
  const filename = options?.filename || `Tax_Invoice_Room_${roomNum}_${guestName}.pdf`;
  const htmlContent = buildFinalBillA4HTML(room, calc, settlement);

  const sandbox = document.createElement('div');
  sandbox.id = 'temp-pdf-sandbox';
  sandbox.style.position = 'fixed';
  sandbox.style.left = '-99999px';
  sandbox.style.top = '0';
  sandbox.style.width = '755px';
  sandbox.style.overflow = 'hidden';

  const targetEl = document.createElement('div');
  targetEl.style.position = 'relative';
  targetEl.style.width = '755px';
  targetEl.style.background = '#ffffff';
  targetEl.style.color = '#000000';
  targetEl.style.boxSizing = 'border-box';
  targetEl.innerHTML = htmlContent;

  sandbox.appendChild(targetEl);
  document.body.appendChild(sandbox);

  // Pre-load images (logo & watermark)
  try {
    const imgElements = Array.from(targetEl.querySelectorAll('img'));
    await Promise.all(imgElements.map(img => {
      if (img.complete && img.naturalWidth !== 0) return Promise.resolve();
      return new Promise((resolve) => {
        img.onload = resolve;
        img.onerror = resolve;
        setTimeout(resolve, 800);
      });
    }));
  } catch (_) {}

  const opt = {
    margin: [8, 5, 5, 5],
    filename: filename,
    image: { type: 'jpeg', quality: 1.0 },
    html2canvas: { scale: 2.5, useCORS: true, logging: false, scrollY: 0, windowWidth: 755 },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
  };

  try {
    await html2pdf().set(opt).from(targetEl).save();
    return true;
  } catch (err) {
    console.warn('html2pdf direct tax invoice save error, falling back to print window:', err);
    printFinalBillA4(room, calc, settlement);
    return false;
  } finally {
    if (document.body.contains(sandbox)) {
      document.body.removeChild(sandbox);
    }
  }
}

/**
 * Print entire restaurant / bar menu on A4 size paper, category-wise.
 * Includes official logo with name, full Solapur address, veg/non-veg badges, shortcodes, and prices.
 */
export function printFullMenuA4(department = 'restaurant', menuItems = [], categories = []) {
  const isBar = department === 'bar';
  const deptTitle = isBar ? 'BAR LOUNGE & COCKTAILS MENU' : 'RESTAURANT & DINING MENU';
  const formattedDate = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });

  // Organize items by category
  const catNames = [];
  if (Array.isArray(categories) && categories.length > 0) {
    categories.forEach(c => {
      const name = typeof c === 'object' ? c.name : c;
      if (name && !catNames.includes(name)) catNames.push(name);
    });
  }

  // Also collect categories from menu items in case some are not in category list
  menuItems.forEach(it => {
    const cName = it.category || 'General';
    if (!catNames.includes(cName)) catNames.push(cName);
  });

  const categoryGroups = catNames.map(cat => {
    const items = menuItems.filter(it => (it.category || 'General').toLowerCase() === cat.toLowerCase());
    return { category: cat, items };
  }).filter(group => group.items.length > 0);

  const totalItemsCount = menuItems.length;

  const categoriesHtml = categoryGroups.map(group => {
    const rows = group.items.map((it, idx) => {
      const vegBadge = !isBar
        ? (it.is_veg !== 0 ? '<span class="menu-veg-icon" style="color: #16a34a; font-weight: 900;">🟢 VEG</span>' : '<span class="menu-veg-icon" style="color: #dc2626; font-weight: 900;">🔴 NON-VEG</span>')
        : '';
      const codeBadge = it.shortcode ? `<span class="menu-item-code">#${escapeHtml(it.shortcode)}</span>` : '';
      const priceFmt = `₹ ${parseFloat(it.price || 0).toLocaleString('en-IN')}`;

      return `
        <tr class="menu-item-row">
          <td style="width: 32px; text-align: center; color: #64748b; font-size: 9.5pt;">${idx + 1}</td>
          <td style="width: 70px; text-align: center;">${codeBadge}</td>
          ${!isBar ? `<td style="width: 85px; font-size: 8.5pt;">${vegBadge}</td>` : ''}
          <td style="font-weight: 700; color: #0f172a; font-size: 10pt;">
            ${escapeHtml(it.name)}
            ${it.description ? `<div style="font-size: 8pt; color: #64748b; font-weight: normal; margin-top: 1px;">${escapeHtml(it.description)}</div>` : ''}
          </td>
          <td style="text-align: right; font-weight: 900; color: #0f172a; font-size: 10.5pt; width: 95px; padding-right: 8px;">
            ${priceFmt}
          </td>
        </tr>
      `;
    }).join('');

    return `
      <div class="menu-category-section" style="break-inside: avoid; page-break-inside: avoid; margin-bottom: 18px;">
        <div class="menu-category-header" style="background: #0f172a; color: #ffffff; padding: 6px 14px; border-radius: 6px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          <h3 style="margin: 0; font-size: 11pt; font-weight: 900; text-transform: uppercase; letter-spacing: 0.5px;">
            ${isBar ? '🍸 ' : '🍽️ '}${escapeHtml(group.category)}
          </h3>
          <span style="font-size: 8.5pt; font-weight: 800; background: rgba(255,255,255,0.2); padding: 2px 8px; border-radius: 4px;">
            ${group.items.length} ${group.items.length === 1 ? 'Item' : 'Items'}
          </span>
        </div>
        <table class="menu-items-table" style="width: 100%; border-collapse: collapse; border: 1px solid #cbd5e1; font-size: 9.5pt;">
          <thead>
            <tr style="background: #f1f5f9; color: #334155; font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.3px; border-bottom: 1.5px solid #cbd5e1;">
              <th style="padding: 5px 6px; text-align: center;">#</th>
              <th style="padding: 5px 6px; text-align: center;">Code</th>
              ${!isBar ? '<th style="padding: 5px 6px; text-align: left;">Type</th>' : ''}
              <th style="padding: 5px 8px; text-align: left;">Item Name</th>
              <th style="padding: 5px 8px; text-align: right; padding-right: 12px;">Rate (₹)</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    `;
  }).join('');

  const menuHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>${deptTitle} - Hotel City Paark</title>
      <style>
        @page {
          size: A4 portrait;
          margin: 10mm 12mm 12mm 12mm;
        }
        * {
          box-sizing: border-box;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        body {
          font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
          margin: 0;
          padding: 0;
          color: #0f172a;
          background: #ffffff;
          line-height: 1.35;
        }
        .menu-page-header {
          border-bottom: 2.5px solid #0f172a;
          padding-bottom: 12px;
          margin-bottom: 14px;
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
        }
        .menu-title-block h1 {
          margin: 0 0 4px 0;
          font-size: 16pt;
          font-weight: 950;
          letter-spacing: 0.5px;
          color: #0f172a;
        }
        .menu-title-badge {
          display: inline-block;
          background: #0284c7;
          color: #ffffff;
          font-size: 9.5pt;
          font-weight: 800;
          padding: 3px 10px;
          border-radius: 4px;
          text-transform: uppercase;
        }
        .menu-item-row:nth-child(even) {
          background: #f8fafc;
        }
        .menu-item-row td {
          padding: 6px 8px;
          border-bottom: 1px solid #e2e8f0;
          vertical-align: middle;
        }
        .menu-item-code {
          background: #e2e8f0;
          color: #1e293b;
          font-weight: 800;
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 8pt;
          font-family: monospace;
        }
        .menu-page-footer {
          margin-top: 20px;
          padding-top: 8px;
          border-top: 1px dashed #cbd5e1;
          display: flex;
          justify-content: space-between;
          font-size: 8pt;
          color: #64748b;
        }
      </style>
    </head>
    <body>
      <!-- Header with Logo and Address -->
      <div class="menu-page-header">
        <div>
          <div class="menu-title-badge">${isBar ? '🍸 BAR & LOUNGE' : '🍽️ RESTAURANT'} • OFFICIAL TARIFF</div>
          <h1 style="margin-top: 6px; margin-bottom: 2px;">HOTEL CITY PAARK</h1>
          <div style="font-size: 8.5pt; color: #1e3a8a; margin-bottom: 3px; letter-spacing: 0.5px;"><span style="text-transform: lowercase; font-weight: 600;">by</span> <strong style="letter-spacing: 0.5px;">JMG HOSPITALITY AND INFRA LLP</strong></div>
          <div style="font-size: 9.5pt; font-weight: 850; color: #475569; text-transform: uppercase; letter-spacing: 0.5px;">
            ${deptTitle} (${totalItemsCount} Active Items)
          </div>
          <div style="font-size: 8.5pt; color: #64748b; margin-top: 3px;">
            Tariff effective date: <strong>${formattedDate}</strong> | Taxes as applicable (GST 5%)
          </div>
        </div>

        <div style="text-align: right;">
          <img src="/hcp-logo-with-name.png" alt="Hotel CityPaark" style="height: 48px; width: auto; margin-bottom: 4px;" />
          <div style="font-size: 7.5pt; color: #334155; line-height: 1.25;">
            119, Murarji Peth, Char Hutatma Chowk, Solapur - 413 001<br>
            <img src="/phone-call.png" alt="" style="width: 10px; height: 10px; object-fit: contain; vertical-align: -1px; display: inline-block;" /> : 0217-2729791, 9960013388<br>
            E-mail : hcitypark@rediffmail.com
          </div>
        </div>
      </div>

      <!-- Category wise Menu Items -->
      <div class="menu-content">
        ${categoriesHtml}
      </div>

      <!-- Footer -->
      <div class="menu-page-footer">
        <div>* Prices are inclusive of service and subject to local government taxes. Subject to change without prior notice.</div>
        <div>Hotel City Paark Hospitality Suite • Printed on ${formattedDate}</div>
      </div>

      <script>
        window.onload = function() {
          setTimeout(function() {
            window.print();
          }, 300);
        };
      </script>
    </body>
    </html>
  `;

  // Open in popup print window for standard A4 browser print dialog
  const printWin = window.open('', '_blank', 'width=900,height=750');
  if (printWin) {
    printWin.document.open();
    printWin.document.write(menuHtml);
    printWin.document.close();
  } else {
    // Iframe fallback if popups are blocked
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);
    const doc = iframe.contentWindow.document;
    doc.open();
    doc.write(menuHtml);
    doc.close();
    setTimeout(() => {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
      setTimeout(() => iframe.remove(), 10000);
    }, 400);
  }
}

/**
 * Daily Cash Drawer Closing & Financial Audit Report (Full A4 Sheet)
 * Uniform 3-Department Breakdown (Hospitality, Bar, Restaurant), Itemized Expenses, and Reconciled Cash Drawer
 */
export function buildDailyClosingReportHTML(analyticsData, options = {}) {
  const now = new Date();
  const printTimestamp = now.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  }) + ' ' + now.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });

  const fromDate = analyticsData?.fromDate || analyticsData?.analyticsFromDate || now.toISOString().slice(0, 10);
  const toDate = analyticsData?.toDate || analyticsData?.analyticsToDate || now.toISOString().slice(0, 10);
  const isSingleDay = fromDate === toDate;
  const periodLabel = isSingleDay ? `Daily Audit: ${fromDate}` : `Audit Period: ${fromDate} to ${toDate}`;

  const dateDigits = (isSingleDay ? fromDate : toDate).replace(/-/g, '').slice(2);
  const timeDigits = String(now.getHours()).padStart(2, '0') + String(now.getMinutes()).padStart(2, '0');
  const seqDigits = String(Date.now() % 1000).padStart(3, '0');
  const uniqueAuditNo = `AUD-${dateDigits}-${timeDigits}-${seqDigits}`;
  const reportNo = options.reportNo || analyticsData?.reportNo || options.auditNo || analyticsData?.auditNo || uniqueAuditNo;

  const stats = analyticsData?.stats || {};
  const an = analyticsData?.analytics || {};
  const bd = an.breakdown || {};

  // Hospitality Inflow (Room Advances & Checkout Settlements ONLY)
  const hospAdv = bd.advances || {};
  const hospBill = bd.billSettlements || {};
  const hospData = bd.hospitality || {};

  const hospCash = Number(hospData.cash ?? ((hospAdv.cash || 0) + (hospBill.cash || 0)));
  const hospUpi = Number(hospData.upi ?? ((hospAdv.upi || 0) + (hospBill.upi || 0)));
  const hospCard = Number(hospData.card ?? ((hospAdv.card || 0) + (hospBill.card || 0)));
  const hospCheque = Number(hospData.cheque ?? hospData.cheque_realized ?? ((hospAdv.cheque_realized || 0) + (hospBill.cheque_realized || 0)));
  const hospTotal = Number(hospData.total ?? ((hospAdv.total || 0) + (hospBill.total || 0)));

  // Standard 5% GST on Hospitality room charges
  const hospGst = Number(hospData.gst ?? (stats.hospGst || Math.round((hospTotal - (hospTotal / 1.05)) * 100) / 100));
  const hospBase = Number(hospData.base ?? (hospTotal - hospGst));

  // Mode-wise GST breakdown for Hospitality:
  const hospCashGst = hospCash > 0 ? Math.round((hospCash - (hospCash / 1.05)) * 100) / 100 : 0;
  const hospUpiGst = hospUpi > 0 ? Math.round((hospUpi - (hospUpi / 1.05)) * 100) / 100 : 0;
  const hospCardGst = hospCard > 0 ? Math.round((hospCard - (hospCard / 1.05)) * 100) / 100 : 0;

  const prebookedTotal = Number(analyticsData?.prebookedTotal || stats.prebookedTotal || an.prebookedTotal || 0);
  const prebookedCount = Number(analyticsData?.prebookedCount || stats.prebookedCount || an.prebookedCount || 0);

  // Expenses & Outflows
  const expStats = an.expenses || {};
  const totalExpenses = Number(analyticsData?.expensesTotal || stats.totalExpenses || expStats.total_expenses || 0);
  const cashExpensesOut = Number(analyticsData?.expensesCashOut || an.drawer?.totalCashOutflow || expStats.cash_expenses || 0);
  const bankExpensesOut = Math.max(0, totalExpenses - cashExpensesOut);

  // Reconciled Hospitality Drawer Cash: Hospitality Cash In - Cash Expenses Paid
  const drawerCash = hospCash - cashExpensesOut;

  // Resolved Cashier Name
  const cashierName = analyticsData?.cashier_name || analyticsData?.cashierName || options.cashierName || options.cashier_name || getActiveCashierName() || 'Front Desk Cashier';

  return `
    <div class="full-a4-registration-card" style="position: relative; width: 100%; box-sizing: border-box; font-family: Arial, Helvetica, sans-serif; color: #000; border: 2.5px solid #000; padding: 12px 16px; background: #fff; line-height: 1.25;">
      <!-- Elegant Watermark -->
      <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); opacity: 0.12; pointer-events: none; z-index: 0; text-align: center;">
        <img src="/HCP New Logo Png_witought-name.png" alt="" style="width: 320px; height: auto;" loading="eager" decoding="sync" />
      </div>

      <div style="position: relative; z-index: 1;">
        <!-- Header -->
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #000; padding-bottom: 6px; margin-bottom: 10px;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <img src="/hcp-logo-with-name.png" alt="Hotel CityPaark" style="height: 48px; width: auto; object-fit: contain;" loading="eager" decoding="sync" />
            <div>
              <h1 style="margin: 0; font-size: 16pt; font-weight: 900; font-family: Georgia, serif; color: #000;">HOTEL CityPaark</h1>
              <div style="margin: 1px 0 0; font-size: 7.5pt; color: #1e3a8a;"><span style="text-transform: lowercase; font-weight: 600;">by</span> <strong style="letter-spacing: 0.5px;">JMG HOSPITALITY AND INFRA LLP</strong></div>
              <p style="margin: 1px 0 0; font-size: 7pt; font-weight: 700; color: #1e293b; white-space: nowrap;">119, Murarji Peth, Char Hutatma Chowk, Solapur - 413 001 (Maharashtra)</p>
              <p style="margin: 1px 0 0; font-size: 6.8pt; color: #475569;">Tel: 0217-2729791, 92, 93 • +91 9960013388 • Email: hcitypark@rediffmail.com • Web: hotelcityparksolapur.com</p>
            </div>
          </div>
          <div style="text-align: right;">
            <div style="background: #0f172a; color: #fff; padding: 4px 10px; font-size: 9.5pt; font-weight: 900; border-radius: 4px; letter-spacing: 0.4px;">
              DAILY CLOSING &amp; AUDIT REPORT
            </div>
            <div style="display: flex; justify-content: flex-end; align-items: center; gap: 6px; margin-top: 3px;">
              <span style="border: 1.5px solid #0f172a; border-radius: 3px; padding: 2px 7px; font-size: 8pt; font-weight: 900; color: #b91c1c; background: #fff;">
                Receipt / Audit No: ${escapeHtml(reportNo)}
              </span>
              <span style="font-size: 8pt; font-weight: 850; color: #0284c7;">
                ${escapeHtml(periodLabel)}
              </span>
            </div>
            <div style="font-size: 7pt; color: #64748b; margin-top: 2px;">
              Generated: ${printTimestamp}
            </div>
          </div>
        </div>

        <!-- 9 Top KPI Summary Boxes: 3x3 Grid (Hospitality Only) -->
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px; margin-bottom: 10px;">
          
          <!-- Box 1: Total Realization -->
          <div style="border: 1.5px solid #059669; background: #ecfdf5; border-radius: 4px; padding: 6px 8px; text-align: center;">
            <div style="font-size: 7.2pt; font-weight: 900; color: #047857; text-transform: uppercase; letter-spacing: 0.2px;">
              💰 Total Realization
            </div>
            <div style="font-size: 12pt; font-weight: 950; color: #065f46; margin: 2px 0;">
              ₹ ${hospTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
            <div style="font-size: 6.5pt; color: #047857; font-weight: 700;">
              Hospitality Gross Realized
            </div>
          </div>

          <!-- Box 2: Cash Flow (In-Flow) -->
          <div style="border: 1.5px solid #0284c7; background: #f0f9ff; border-radius: 4px; padding: 6px 8px; text-align: center;">
            <div style="font-size: 7.2pt; font-weight: 900; color: #0369a1; text-transform: uppercase; letter-spacing: 0.2px;">
              💵 Cash Flow (In-Flow)
            </div>
            <div style="font-size: 12pt; font-weight: 950; color: #0c4a6e; margin: 2px 0;">
              ₹ ${hospCash.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
            <div style="font-size: 6.5pt; color: #0284c7; font-weight: 700;">
              Hospitality Cash Received
            </div>
          </div>

          <!-- Box 3: UPI In-Flow -->
          <div style="border: 1.5px solid #0891b2; background: #ecfeff; border-radius: 4px; padding: 6px 8px; text-align: center;">
            <div style="font-size: 7.2pt; font-weight: 900; color: #0e7490; text-transform: uppercase; letter-spacing: 0.2px;">
              📱 UPI In-Flow
            </div>
            <div style="font-size: 12pt; font-weight: 950; color: #155e75; margin: 2px 0;">
              ₹ ${hospUpi.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
            <div style="font-size: 6.5pt; color: #0891b2; font-weight: 700;">
              Online UPI / QR Collections
            </div>
          </div>

          <!-- Box 4: Card In-Flow -->
          <div style="border: 1.5px solid #7c3aed; background: #f5f3ff; border-radius: 4px; padding: 6px 8px; text-align: center;">
            <div style="font-size: 7.2pt; font-weight: 900; color: #6d28d9; text-transform: uppercase; letter-spacing: 0.2px;">
              💳 Card In-Flow
            </div>
            <div style="font-size: 12pt; font-weight: 950; color: #5b21b6; margin: 2px 0;">
              ₹ ${hospCard.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
            <div style="font-size: 6.5pt; color: #7c3aed; font-weight: 700;">
              Debit / Credit POS Swipes
            </div>
          </div>

          <!-- Box 5: Total Expenses -->
          <div style="border: 1.5px solid #dc2626; background: #fef2f2; border-radius: 4px; padding: 6px 8px; text-align: center;">
            <div style="font-size: 7.2pt; font-weight: 900; color: #b91c1c; text-transform: uppercase; letter-spacing: 0.2px;">
              💸 Total Expenses
            </div>
            <div style="font-size: 12pt; font-weight: 950; color: #991b1b; margin: 2px 0;">
              ₹ ${totalExpenses.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
            <div style="font-size: 6.5pt; color: #dc2626; font-weight: 700;">
              Cash Paid: ₹${cashExpensesOut.toLocaleString('en-IN')} • Bank: ₹${bankExpensesOut.toLocaleString('en-IN')}
            </div>
          </div>

          <!-- Box 6: GST Collections (Shows UPI & Card breakdown) -->
          <div style="border: 1.5px solid #d97706; background: #fffbeb; border-radius: 4px; padding: 6px 8px; text-align: center;">
            <div style="font-size: 7.2pt; font-weight: 900; color: #b45309; text-transform: uppercase; letter-spacing: 0.2px;">
              🏛️ GST Collections
            </div>
            <div style="font-size: 12pt; font-weight: 950; color: #78350f; margin: 2px 0;">
              ₹ ${hospGst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
            <div style="font-size: 6.5pt; color: #b45309; font-weight: 700;">
              UPI GST: ₹${hospUpiGst.toLocaleString('en-IN', { minimumFractionDigits: 2 })} • Card GST: ₹${hospCardGst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}${hospCashGst > 0 ? ` • Cash GST: ₹${hospCashGst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : ''}
            </div>
          </div>

          <!-- Box 7: Net Cash in Drawer -->
          <div style="border: 1.5px solid #15803d; background: #f0fdf4; border-radius: 4px; padding: 6px 8px; text-align: center;">
            <div style="font-size: 7.2pt; font-weight: 900; color: #15803d; text-transform: uppercase; letter-spacing: 0.2px;">
              📥 Net Cash in Drawer
            </div>
            <div style="font-size: 12pt; font-weight: 950; color: #166534; margin: 2px 0;">
              ₹ ${drawerCash.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
            <div style="font-size: 6.5pt; color: #15803d; font-weight: 700;">
              Cash In (₹${hospCash.toLocaleString('en-IN')}) &minus; Paid (₹${cashExpensesOut.toLocaleString('en-IN')})
            </div>
          </div>

          <!-- Box 8: Net to Hotel (Base Price Only) -->
          <div style="border: 1.5px solid #1e3a8a; background: #eff6ff; border-radius: 4px; padding: 6px 8px; text-align: center;">
            <div style="font-size: 7.2pt; font-weight: 900; color: #1e3a8a; text-transform: uppercase; letter-spacing: 0.2px;">
              🏨 Net to Hotel (Base Price)
            </div>
            <div style="font-size: 12pt; font-weight: 950; color: #172554; margin: 2px 0;">
              ₹ ${hospBase.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
            <div style="font-size: 6.5pt; color: #1e40af; font-weight: 700;">
              Base Tariff Only (Excl. GST &amp; Exp)
            </div>
          </div>

          <!-- Box 9: Prepaid Account -->
          <div style="border: 1.5px solid #0f766e; background: #f0fdfa; border-radius: 4px; padding: 6px 8px; text-align: center;">
            <div style="font-size: 7.2pt; font-weight: 900; color: #0f766e; text-transform: uppercase; letter-spacing: 0.2px;">
              🌐 Prepaid Account
            </div>
            <div style="font-size: 12pt; font-weight: 950; color: #134e4a; margin: 2px 0;">
              ₹ ${prebookedTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
            <div style="font-size: 6.5pt; color: #0f766e; font-weight: 700;">
              OTA Pre-Paid (${prebookedCount} Vouchers Billed) • OTA Pre-Booked (${prebookedCount} Vch)
            </div>
          </div>

        </div>

        <!-- Financial Realization & Base Revenue Summary Ribbon -->
        <div style="border: 1.5px solid #1e3a8a; background: #eff6ff; padding: 4px 10px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center; border-radius: 4px; font-size: 7.5pt;">
          <span style="font-weight: 800; color: #1e3a8a;">
            🏢 <strong>Net to Hotel (Base Price):</strong> ₹${hospBase.toLocaleString('en-IN', { minimumFractionDigits: 2 })} + 🏛️ <strong>GST Collections:</strong> ₹${hospGst.toLocaleString('en-IN', { minimumFractionDigits: 2 })} = <strong>₹${hospTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })} Total Realization</strong>
          </span>
          <span style="font-weight: 900; color: #1e40af; font-size: 7pt; background: #dbeafe; padding: 2px 7px; border-radius: 3px;">
            Hospitality Front Desk Audit
          </span>
        </div>

        <!-- Hospitality Detailed Audit Section (Advances vs Settlements & Drawer Audit) -->
        <div style="display: grid; grid-template-columns: 1.25fr 0.75fr; gap: 10px; margin-bottom: 16px;">
          <!-- Card 1: Check-in Advances vs Checkout Settlements Table -->
          <div style="border: 1.5px solid #000; border-radius: 4px; overflow: hidden; background: #fff;">
            <div style="background: #1e3a8a; color: #fff; padding: 5px 8px; font-weight: 900; font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.3px; display: flex; justify-content: space-between; align-items: center;">
              <span>🏨 Hospitality Collection Channels</span>
              <span style="font-size: 7.2pt; background: rgba(255,255,255,0.2); padding: 1px 6px; border-radius: 2px;">Advances &amp; Final Bills</span>
            </div>
            <table style="width: 100%; border-collapse: collapse; font-size: 7.5pt;">
              <thead>
                <tr style="background: #f1f5f9; border-bottom: 1.5px solid #000; font-weight: 900;">
                  <th style="padding: 5px 7px; text-align: left;">Channel / Stream</th>
                  <th style="padding: 5px 7px; text-align: right;">Cash</th>
                  <th style="padding: 5px 7px; text-align: right;">Online UPI</th>
                  <th style="padding: 5px 7px; text-align: right;">Card POS</th>
                  <th style="padding: 5px 7px; text-align: right;">Total Amount</th>
                </tr>
              </thead>
              <tbody>
                <tr style="border-bottom: 1px solid #e2e8f0;">
                  <td style="padding: 5px 7px; font-weight: 850; color: #0f172a;">Check-in Advances</td>
                  <td style="padding: 5px 7px; text-align: right; color: #0284c7; font-weight: 800;">₹ ${(Number(hospAdv.cash) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                  <td style="padding: 5px 7px; text-align: right; color: #0891b2; font-weight: 800;">₹ ${(Number(hospAdv.upi) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                  <td style="padding: 5px 7px; text-align: right; color: #7c3aed; font-weight: 800;">₹ ${(Number(hospAdv.card) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                  <td style="padding: 5px 7px; text-align: right; font-weight: 900; color: #047857;">₹ ${(Number(hospAdv.total) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                </tr>
                <tr style="border-bottom: 1px solid #e2e8f0;">
                  <td style="padding: 5px 7px; font-weight: 850; color: #0f172a;">Checkout Bill Settlements</td>
                  <td style="padding: 5px 7px; text-align: right; color: #0284c7; font-weight: 800;">₹ ${(Number(hospBill.cash) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                  <td style="padding: 5px 7px; text-align: right; color: #0891b2; font-weight: 800;">₹ ${(Number(hospBill.upi) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                  <td style="padding: 5px 7px; text-align: right; color: #7c3aed; font-weight: 800;">₹ ${(Number(hospBill.card) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                  <td style="padding: 5px 7px; text-align: right; font-weight: 900; color: #047857;">₹ ${(Number(hospBill.total) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                </tr>
                ${prebookedTotal > 0 ? `
                <tr style="border-bottom: 1px solid #e2e8f0; background: #f0fdfa;">
                  <td style="padding: 5px 7px; font-weight: 850; color: #0f766e;">OTA Pre-Paid / Pre-Booked (${prebookedCount} Vch)</td>
                  <td style="padding: 5px 7px; text-align: right; color: #64748b;">-</td>
                  <td style="padding: 5px 7px; text-align: right; color: #64748b;">-</td>
                  <td style="padding: 5px 7px; text-align: right; color: #64748b;">-</td>
                  <td style="padding: 5px 7px; text-align: right; font-weight: 900; color: #0f766e;">₹ ${prebookedTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                </tr>
                ` : ''}
              </tbody>
              <tfoot>
                <tr style="background: #f8fafc; font-weight: 950; border-top: 1.5px solid #000;">
                  <td style="padding: 5px 7px; text-transform: uppercase;">Total Hospitality Inflow</td>
                  <td style="padding: 5px 7px; text-align: right; color: #0284c7;">₹ ${hospCash.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                  <td style="padding: 5px 7px; text-align: right; color: #0891b2;">₹ ${hospUpi.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                  <td style="padding: 5px 7px; text-align: right; color: #7c3aed;">₹ ${hospCard.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                  <td style="padding: 5px 7px; text-align: right; color: #047857; font-size: 8.5pt;">₹ ${hospTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <!-- Card 2: Cash Drawer & GST Reconciliation Summary -->
          <div style="border: 1.5px solid #000; border-radius: 4px; overflow: hidden; background: #fff; display: flex; flex-direction: column;">
            <div style="background: #0f172a; color: #fff; padding: 5px 8px; font-weight: 900; font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.3px; display: flex; justify-content: space-between; align-items: center;">
              <span>💵 Cash Drawer &amp; Tax Audit</span>
              <span style="font-size: 7.2pt; background: rgba(255,255,255,0.2); padding: 1px 6px; border-radius: 2px;">Verified</span>
            </div>
            <div style="padding: 8px 10px; display: flex; flex-direction: column; gap: 5px; font-size: 7.8pt;">
              <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed #cbd5e1; padding-bottom: 3px;">
                <span style="color: #475569; font-weight: 750;">Total Cash Inflow:</span>
                <strong style="color: #0284c7;">₹ ${hospCash.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong>
              </div>
              <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed #cbd5e1; padding-bottom: 3px;">
                <span style="color: #475569; font-weight: 750;">Less Cash Expenses Paid:</span>
                <strong style="color: #b91c1c;">&minus; ₹ ${cashExpensesOut.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong>
              </div>
              <div style="display: flex; justify-content: space-between; border-bottom: 1.5px solid #000; padding: 4px 6px; background: #f0fdf4; border-radius: 3px;">
                <span style="color: #15803d; font-weight: 900; text-transform: uppercase;">Net Cash in Drawer:</span>
                <strong style="color: #166534; font-size: 9.5pt;">₹ ${drawerCash.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong>
              </div>
              <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed #cbd5e1; padding-bottom: 3px; margin-top: 3px;">
                <span style="color: #475569; font-weight: 750;">Base Tariff (Excl. GST):</span>
                <strong style="color: #1e3a8a;">₹ ${hospBase.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong>
              </div>
              <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed #cbd5e1; padding-bottom: 3px;">
                <div>
                  <div style="color: #475569; font-weight: 750;">Room GST (5%):</div>
                  <div style="font-size: 6.5pt; color: #b45309;">UPI: ₹${hospUpiGst.toLocaleString('en-IN')} • Card: ₹${hospCardGst.toLocaleString('en-IN')}</div>
                </div>
                <strong style="color: #b45309;">₹ ${hospGst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong>
              </div>
              <div style="display: flex; justify-content: space-between; padding-top: 2px;">
                <span style="color: #0f172a; font-weight: 900; text-transform: uppercase;">Total Realization:</span>
                <strong style="color: #047857; font-size: 9.5pt;">₹ ${hospTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong>
              </div>
            </div>
          </div>
        </div>

        <!-- Signatures & Audit Seal -->
        <div style="display: flex; justify-content: space-between; align-items: flex-end; padding-top: 18px; margin-top: 12px;">
          <div style="text-align: center; width: 220px;">
            <div style="font-size: 9.5pt; font-weight: 900; color: #0f172a; margin-bottom: 2px;">
              ${escapeHtml(cashierName)}
            </div>
            <div style="border-top: 1.5px solid #000; padding-top: 3px; font-size: 7.5pt; font-weight: 900;">
              Front Desk Cashier / Auditor
            </div>
          </div>
          <div style="text-align: center; font-size: 6.8pt; color: #64748b;">
            Official End-of-Day Financial Audit • Hotel CityPaark, Solapur
          </div>
          <div style="text-align: center; width: 220px;">
            <div style="border-top: 1.5px solid #000; padding-top: 3px; font-size: 7.5pt; font-weight: 900;">
              General Manager / Managing Partner
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

export function printDailyClosingReport(analyticsData, options = {}) {
  const sheet = document.getElementById('print-registration-sheet');
  if (!sheet) {
    console.warn('print-registration-sheet element not found in DOM');
    return;
  }

  const exitThemeIsolation = enterPrintThemeIsolation();

  sheet.innerHTML = buildDailyClosingReportHTML(analyticsData, options);

  sheet.style.display = 'block';
  sheet.classList.add('print-active');
  document.body.classList.add('print-sheet-active');

  const cleanup = () => {
    sheet.classList.remove('print-active');
    sheet.style.display = 'none';
    document.body.classList.remove('print-sheet-active');
    window.removeEventListener('afterprint', cleanup);
    exitThemeIsolation();
  };
  window.addEventListener('afterprint', cleanup, { once: true });

  requestAnimationFrame(() => {
    setTimeout(() => {
      window.print();
      setTimeout(cleanup, 2500);
    }, 40);
  });
}

/**
 * 80mm Thermal Daily Closing / Sales Audit Slip for Restaurant & Bar
 */
export function printPosThermalClosingSlip(analyticsData, department = 'restaurant') {
  if (!analyticsData) return;
  const isBar = department === 'bar' || analyticsData.department === 'bar';
  const deptTitle = isBar ? 'HOTEL CITY PARK - BAR & LOUNGE' : 'HOTEL CITY PARK - RESTAURANT';
  const auditTitle = isBar ? 'BAR SHIFT & CLOSING AUDIT' : 'RESTAURANT SHIFT & CLOSING AUDIT';

  const sum = analyticsData.summary || {};
  const pm = analyticsData.paymentModes || {};
  const ot = analyticsData.orderTypes || {};
  const period = analyticsData.period || {};
  const categories = Array.isArray(analyticsData.categories) ? analyticsData.categories : [];
  const topItems = Array.isArray(analyticsData.topItems) ? analyticsData.topItems : [];

  const fromDate = period.startDate || new Date().toISOString().slice(0, 10);
  const toDate = period.endDate || new Date().toISOString().slice(0, 10);
  const periodStr = fromDate === toDate ? fromDate : `${fromDate} to ${toDate}`;

  const html = `
    <div class="slip-header">
      <img src="/hcp-logo-with-name.png" alt="Hotel CityPaark" style="height: 38px; width: auto; object-fit: contain; margin: 0 auto 4px; display: block;" />
      <p style="font-size: 8px; font-weight: bold; color: #333; margin: 0 0 2px;"><span style="font-weight: normal; text-transform: lowercase;">by</span> JMG HOSPITALITY AND INFRA LLP</p>
      <p style="font-size: 9px; line-height: 1.25;">119, Murarji Peth, Solapur - 413 001</p>
      <p class="text-bold" style="margin-top: 4px; font-size: 11px; letter-spacing: 0.04em;">${escapeHtml(deptTitle)}</p>
      <div style="font-size: 10px; font-weight: bold; background: #000; color: #fff; padding: 2px 4px; margin-top: 4px; display: inline-block;">
        ${escapeHtml(auditTitle)}
      </div>
    </div>

    <div class="divider"></div>
    <div class="flex-row" style="font-size: 10px;">
      <span>Audit Period:</span>
      <strong>${escapeHtml(periodStr)}</strong>
    </div>
    <div class="flex-row" style="font-size: 10px;">
      <span>Generated At:</span>
      <span>${formatDateTime(new Date())}</span>
    </div>

    <div class="double-divider"></div>
    <div class="text-bold" style="font-size: 11px; margin-bottom: 4px;">FINANCIAL SUMMARY</div>
    <div class="flex-row">
      <span>Realized Collections:</span>
      <strong>₹${Number(sum.realizedRevenue || 0).toFixed(2)}</strong>
    </div>
    ${Number(sum.roomFolioRevenue || 0) > 0 ? `
    <div class="flex-row" style="color: #666;">
      <span>Room Folio Transfers:</span>
      <span>₹${Number(sum.roomFolioRevenue || 0).toFixed(2)}</span>
    </div>
    ` : ''}
    <div class="flex-row" style="font-size: 13px; font-weight: bold; border-top: 1px dashed #000; padding-top: 2px; margin-top: 2px;">
      <span>Gross Department Sales:</span>
      <span>₹${Number(sum.grossSales || 0).toFixed(2)}</span>
    </div>
    <div class="flex-row" style="font-size: 10px; color: #555;">
      <span>Net Food/Drinks: ₹${Number(sum.totalSubtotal || 0).toFixed(2)} | GST: ₹${Number(sum.totalTax || 0).toFixed(2)}</span>
    </div>

    <div class="divider"></div>
    <div class="text-bold" style="font-size: 11px; margin-bottom: 4px;">PAYMENT MODE BREAKDOWN</div>
    <div class="flex-row">
      <span>💵 Cash Inflow:</span>
      <strong>₹${Number(pm.cash || 0).toFixed(2)}</strong>
    </div>
    <div class="flex-row">
      <span>📱 Online UPI:</span>
      <strong>₹${Number(pm.upi || 0).toFixed(2)}</strong>
    </div>
    ${Number(pm.upiTax || 0) > 0 ? `
    <div class="flex-row" style="font-size: 10px; color: #555;">
      <span>  └ UPI Tax (0.4%):</span>
      <span>+₹${Number(pm.upiTax).toFixed(2)}</span>
    </div>
    ` : ''}
    <div class="flex-row">
      <span>💳 Card POS:</span>
      <strong>₹${Number(pm.card || 0).toFixed(2)}</strong>
    </div>
    ${Number(pm.cardSurcharge || 0) > 0 ? `
    <div class="flex-row" style="font-size: 10px; color: #555;">
      <span>  └ Card Surcharge (2.5%):</span>
      <span>+₹${Number(pm.cardSurcharge).toFixed(2)}</span>
    </div>
    ` : ''}
    ${Number(pm.room_folio || 0) > 0 ? `
    <div class="flex-row">
      <span>🏨 Billed to Room:</span>
      <strong>₹${Number(pm.room_folio).toFixed(2)}</strong>
    </div>
    ` : ''}

    <div class="divider"></div>
    <div class="text-bold" style="font-size: 11px; margin-bottom: 4px;">ORDER METRICS</div>
    <div class="flex-row" style="font-size: 10px;">
      <span>Total Bills Settled:</span>
      <strong>${sum.paidOrdersCount || sum.totalOrdersCount || 0} Bills</strong>
    </div>
    <div class="flex-row" style="font-size: 10px;">
      <span>Average Ticket Size:</span>
      <strong>₹${Number(sum.averageOrderValue || 0).toFixed(2)}</strong>
    </div>
    <div class="flex-row" style="font-size: 10px;">
      <span>🍽️ Dine-in:</span>
      <span>${ot.dineIn?.count || 0} (₹${Number(ot.dineIn?.revenue || 0).toFixed(2)})</span>
    </div>
    <div class="flex-row" style="font-size: 10px;">
      <span>📦 Parcels:</span>
      <span>${ot.parcel?.count || 0} (₹${Number(ot.parcel?.revenue || 0).toFixed(2)})</span>
    </div>
    <div class="flex-row" style="font-size: 10px;">
      <span>🛎️ Room Service:</span>
      <span>${ot.roomService?.count || 0} (₹${Number(ot.roomService?.revenue || 0).toFixed(2)})</span>
    </div>

    ${categories.length > 0 ? `
    <div class="divider"></div>
    <div class="text-bold" style="font-size: 11px; margin-bottom: 4px;">TOP CATEGORIES</div>
    ${categories.slice(0, 5).map(c => `
      <div class="flex-row" style="font-size: 10px;">
        <span>${escapeHtml(c.name)} (${c.percentage}%)</span>
        <strong>₹${Number(c.revenue).toFixed(2)}</strong>
      </div>
    `).join('')}
    ` : ''}

    ${topItems.length > 0 ? `
    <div class="divider"></div>
    <div class="text-bold" style="font-size: 11px; margin-bottom: 4px;">TOP 5 SELLING ITEMS</div>
    ${topItems.slice(0, 5).map((it, idx) => `
      <div class="flex-row" style="font-size: 10px;">
        <span>${idx + 1}. ${escapeHtml(it.name)} (${it.quantity} sold)</span>
        <strong>₹${Number(it.revenue).toFixed(2)}</strong>
      </div>
    `).join('')}
    ` : ''}

    <div class="double-divider"></div>
    <div style="font-size: 10px; margin-top: 14px; display: flex; justify-content: space-between;">
      <span>Cashier Sign: ________</span>
      <span>Manager Sign: ________</span>
    </div>
    <div class="text-center" style="font-size: 10px; margin-top: 10px; color: #555;">
      *** End of ${escapeHtml(isBar ? 'Bar' : 'Restaurant')} Audit Slip ***
    </div>
  `;

  printSlipWindow(html);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
