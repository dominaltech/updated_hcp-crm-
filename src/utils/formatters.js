/**
 * Formatting and Helper Utilities for Hotel City Park CRM
 */

export function formatCheckoutTimeDisplay(dateInput) {
  if (!dateInput) return '';
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return '';
  let hours = d.getHours();
  const minutes = d.getMinutes();
  const ampm = hours >= 12 ? 'pm' : 'am';
  hours = hours % 12;
  hours = hours ? hours : 12; // 0 converted to 12
  const minsFormatted = minutes < 10 ? '0' + minutes : minutes;
  return `${hours}:${minsFormatted} ${ampm}`;
}

/**
 * Formats time as 12-hour AM/PM string (e.g. "12:39 pm", "02:15 am")
 * Guarantees 12-hour AM/PM format (never 24-hour military time).
 */
export function formatTime12(timeInput) {
  if (!timeInput) return '';
  if (typeof timeInput === 'string') {
    const trimmed = timeInput.trim();
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(trimmed)) {
      const parts = trimmed.split(':');
      let h = parseInt(parts[0], 10);
      const m = parts[1] || '00';
      if (isNaN(h)) return '';
      const ampm = h >= 12 ? 'pm' : 'am';
      h = h % 12;
      if (h === 0) h = 12;
      return `${String(h).padStart(2, '0')}:${m} ${ampm}`;
    }
    if (/am|pm/i.test(trimmed)) {
      return trimmed;
    }
  }
  const d = timeInput instanceof Date ? timeInput : new Date(timeInput);
  if (isNaN(d.getTime())) return String(timeInput);
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12;
  if (h === 0) h = 12;
  return `${String(h).padStart(2, '0')}:${m} ${ampm}`;
}

export function formatDateTime(dateInput) {
  if (!dateInput) return '';
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return '';
  const dateStr = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const timeStr = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  return `${dateStr}, ${timeStr}`;
}

export function formatCurrency(amount) {
  const num = Number(amount) || 0;
  return `₹${num.toLocaleString('en-IN')}`;
}

export function formatSlipAmount(amount) {
  const num = Number(amount) || 0;
  if (Math.abs(num - Math.round(num)) < 0.005) {
    return `${Math.round(num)}/-`;
  }
  return `${num.toFixed(2)}/-`;
}

export function amountToWordsIndian(num) {
  const a = ['', 'One ', 'Two ', 'Three ', 'Four ', 'Five ', 'Six ', 'Seven ', 'Eight ', 'Nine ', 'Ten ', 'Eleven ', 'Twelve ', 'Thirteen ', 'Fourteen ', 'Fifteen ', 'Sixteen ', 'Seventeen ', 'Eighteen ', 'Nineteen '];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  const n = ('000000000' + num).substr(-9).match(/^(\d{2})(\d{2})(\d{2})(\d{1})(\d{2})$/);
  if (!n) return '';
  let str = '';
  str += (Number(n[1]) !== 0) ? (a[Number(n[1])] || b[n[1][0]] + ' ' + a[n[1][1]]) + 'Crore ' : '';
  str += (Number(n[2]) !== 0) ? (a[Number(n[2])] || b[n[2][0]] + ' ' + a[n[2][1]]) + 'Lakh ' : '';
  str += (Number(n[3]) !== 0) ? (a[Number(n[3])] || b[n[3][0]] + ' ' + a[n[3][1]]) + 'Thousand ' : '';
  str += (Number(n[4]) !== 0) ? (a[Number(n[4])] || b[n[4][0]] + ' ' + a[n[4][1]]) + 'Hundred ' : '';
  str += (Number(n[5]) !== 0) ? ((str !== '') ? 'and ' : '') + (a[Number(n[5])] || b[n[5][0]] + ' ' + a[n[5][1]]) + 'Rupees Only' : 'Rupees Only';
  return str.trim();
}

/**
 * Strips 4-digit century and mode prefixes from voucher / receipt numbers e.g. "20260920-520" -> "260920-520", "CR260924-002" -> "260924-002"
 */
export function cleanVoucherNumber(val) {
  if (!val) return '';
  const str = String(val).trim();
  return str
    .replace(/\b20(\d{6}-\d+)\b/g, '$1')
    .replace(/^[A-Za-z_-]*(\d{6}-\d+)/i, '$1')
    .replace(/^(CR|UPI|POS|CHQ|BTC|RCP-?|ADV-?|DEB-?|REG-?)(2\d{5}-\d+)$/i, '$2');
}

/**
 * Formats a voucher or invoice reference into official Tax Invoice number (e.g. "260926-600" -> "HCP600")
 * Extracts the sequential bill number and prefixes with 'HCP' (Hotel City Park).
 */
export function formatTaxInvoiceNumber(val) {
  if (!val) return 'HCP1';
  const str = String(val).trim();
  // Already in HCP<digits> format (e.g. "HCP600", "HCP1573")
  if (/^HCP\d+$/i.test(str)) {
    return str.toUpperCase();
  }
  // Legacy L<digits> format (e.g. "L600" -> "HCP600")
  if (/^L\d+$/i.test(str)) {
    return `HCP${str.slice(1)}`;
  }
  // Has hyphen with sequential number (e.g. "260926-600", "20260926-600", "INV-600")
  const match = str.match(/-(\d+)$/);
  if (match) {
    return `HCP${match[1]}`;
  }
  // Short bill number (e.g. "600", "1", "45")
  if (/^\d{1,4}$/.test(str)) {
    return `HCP${str}`;
  }
  return str;
}

/**
 * Returns date and time string in local wall-clock ISO format: "YYYY-MM-DDTHH:mm"
 * Automatically avoids UTC timezone conversion shift bugs from new Date().toISOString()
 */
export function getLocalIsoDateTime(dateInput = new Date()) {
  if (!dateInput) return '';
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day}T${hh}:${mm}`;
}

/**
 * Converts any time string (e.g. "13:00", "01:00 PM", "15:41", "3:41 pm")
 * into total minutes from midnight (0 - 1439).
 * Returns null if input is empty or invalid.
 */
export function timeToMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const s = timeStr.trim();
  const match = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i);
  if (!match) return null;
  let h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  if (isNaN(h) || isNaN(m)) return null;
  const p = (match[3] || '').toUpperCase();
  if (p === 'PM' && h < 12) h += 12;
  if (p === 'AM' && h === 12) h = 0;
  return h * 60 + m;
}

/**
 * Returns YYYY-MM-DD string in local timezone (avoids UTC timezone shift bugs).
 */
export function getLocalIsoDate(dateInput = new Date()) {
  if (!dateInput) return '';
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Calculates the minimum allowed check-out date (YYYY-MM-DD).
 * Rule:
 * 1. If real time (clock time) is past/above 10:00 AM (>= 10:00),
 *    checkout at 10:00 AM today is no longer possible (it is already in the past).
 *    Therefore, the minimum allowed check-out date for guests checking in today
 *    is TOMORROW.
 * 2. If real time is before 10:00 AM (< 10:00), check-out today at 10:00 AM
 *    is still in the future, so today is allowed as the minimum.
 * 3. If check-in date is in the future (> today), the minimum check-out date
 *    is that check-in date.
 */
export function getMinCheckoutDate(checkinDateInput, referenceTime = new Date()) {
  const now = referenceTime instanceof Date ? referenceTime : new Date(referenceTime);
  const todayStr = getLocalIsoDate(now);

  // Tomorrow's date
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const tomorrowStr = getLocalIsoDate(tomorrow);

  const checkinStr = checkinDateInput ? String(checkinDateInput).split('T')[0] : todayStr;

  // Real clock time in minutes from midnight
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const isPast10AM = currentMinutes >= 10 * 60; // 10:00 AM (600 minutes)

  // If check-in is today or in the past:
  if (checkinStr <= todayStr) {
    if (isPast10AM) {
      return tomorrowStr;
    }
    return todayStr;
  }

  // If check-in is in the future:
  return checkinStr;
}


