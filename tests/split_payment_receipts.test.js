import { describe, it, expect, vi } from 'vitest';

vi.mock('html2pdf.js', () => ({
  default: () => ({
    set: () => ({
      from: () => ({
        save: vi.fn()
      })
    })
  })
}));

// Provide global DOM mock for Node environment tests
class MockClassList {
  constructor() {
    this._classes = new Set();
  }
  add(...classes) {
    classes.forEach(c => this._classes.add(c));
  }
  remove(...classes) {
    classes.forEach(c => this._classes.delete(c));
  }
  contains(cls) {
    return this._classes.has(cls);
  }
}

class MockElement {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.classList = new MockClassList();
    this.children = [];
    this.innerHTML = '';
    this.style = {};
  }
  getAttribute(attr) {
    return null;
  }
  setAttribute(attr, val) {}
  removeAttribute(attr) {}
  appendChild(child) {
    this.children.push(child);
    return child;
  }
  querySelectorAll(selector) {
    if (selector === '.split-receipt-page') {
      const matches = [];
      const regex = /<div class="split-receipt-page"[^>]*>([\s\S]*?)<\/div>\s*(?=<div class="split-receipt-page"|$)/g;
      let m;
      while ((m = regex.exec(this.innerHTML)) !== null) {
        matches.push({ innerHTML: m[1] });
      }
      return matches;
    }
    return [];
  }
}

const mockElements = new Map();
global.document = {
  getElementById: (id) => {
    if (!mockElements.has(id)) {
      const el = new MockElement('div');
      el.id = id;
      mockElements.set(id, el);
    }
    return mockElements.get(id);
  },
  createElement: (tag) => new MockElement(tag),
  body: new MockElement('body'),
  documentElement: new MockElement('html')
};
global.window = {
  print: vi.fn(),
  document: global.document,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  localStorage: {
    getItem: vi.fn(() => null),
    setItem: vi.fn()
  }
};

import {
  formatReceiptNumberWithMode,
  normalizeReceiptData,
  buildMoneyReceiptHTML,
  printSplitPaymentReceipts,
  printCashReceipt
} from '../src/services/printService';

describe('Split Payment & Distinct Receipts for Different Payment Methods', () => {

  it('1) normalizeReceiptData normalizes single receipt and retains split flag', () => {
    const raw = {
      voucher_number: '260924-001',
      receipt_no: '260924-001/CASH',
      amount: 1500,
      payment_mode: 'Cash',
      guest_name: 'Rahul Sharma',
      room_numbers: '102',
      is_split: true
    };
    const norm = normalizeReceiptData(raw);
    expect(norm.amount).toBe(1500);
    expect(norm.is_split).toBe(true);
    expect(norm.guest_name).toBe('Rahul Sharma');
    expect(norm.receipt_no).toBe('260924-001/CASH');
  });

  it('2) buildMoneyReceiptHTML preserves mode suffix on split receipt numbers', () => {
    const cashReceipt = {
      voucher_number: '260924-001',
      receipt_no: '260924-001/CASH',
      receipt_date: '2026-09-24T12:00:00',
      guest_name: 'Rahul Sharma',
      amount: 1500,
      payment_mode: 'Cash',
      mode: 'cash',
      room_numbers: '102',
      particulars: 'Room #102 - Check-In Advance Payment (Cash)',
      cashier_name: 'Front Desk',
      is_split: true
    };

    const upiReceipt = {
      voucher_number: '260924-001',
      receipt_no: '260924-001/UPI',
      receipt_date: '2026-09-24T12:00:00',
      guest_name: 'Rahul Sharma',
      amount: 2500,
      payment_mode: 'Online UPI',
      mode: 'upi',
      utr_number: 'UPI987654321',
      room_numbers: '102',
      particulars: 'Room #102 - Check-In Advance Payment (UPI)',
      cashier_name: 'Front Desk',
      is_split: true
    };

    const cashHTML = buildMoneyReceiptHTML(cashReceipt);
    const upiHTML = buildMoneyReceiptHTML(upiReceipt);

    // Should format with CR mode prefix without /CASH slash
    expect(cashHTML).toContain('CR01');
    expect(cashHTML).toContain('Voucher No:');
    expect(cashHTML).toContain('260924-001');
    expect(cashHTML).not.toContain('/CASH');
    expect(cashHTML).toContain('1,500.00');
    expect(cashHTML).toContain('by Cash');

    // Should format with UPI mode prefix without /UPI slash
    expect(upiHTML).toContain('UPI01');
    expect(upiHTML).toContain('Voucher No:');
    expect(upiHTML).toContain('260924-001');
    expect(upiHTML).not.toContain('/UPI');
    expect(upiHTML).toContain('2,510.00');
    expect(upiHTML).toContain('by Online UPI');
    expect(upiHTML).toContain('UPI987654321');
  });

  it('3) printSplitPaymentReceipts creates multi-page container with separate split-receipt-page sheets', () => {
    const container = document.getElementById('print-money-receipt-sheet');

    const receipts = [
      {
        voucher_number: '260924-005',
        receipt_no: '260924-005/CASH',
        receipt_date: '2026-09-24T14:00:00',
        guest_name: 'Priya Patel',
        amount: 1000,
        payment_mode: 'Cash',
        mode: 'cash',
        room_numbers: '205',
        particulars: 'Room #205 - Advance Payment (Cash)',
        cashier_name: 'Aamir',
        is_split: true
      },
      {
        voucher_number: '260924-005',
        receipt_no: '260924-005/POS',
        receipt_date: '2026-09-24T14:00:00',
        guest_name: 'Priya Patel',
        amount: 2000,
        payment_mode: 'Card POS',
        mode: 'card',
        card_digits: '4321',
        room_numbers: '205',
        particulars: 'Room #205 - Advance Payment (Card POS)',
        cashier_name: 'Aamir',
        is_split: true
      }
    ];

    printSplitPaymentReceipts(receipts);

    // Container should have multi-page and print-active classes
    expect(container.classList.contains('multi-page')).toBe(true);
    expect(container.classList.contains('print-active')).toBe(true);

    // Each page HTML should contain its corresponding receipt with mode prefixes
    expect(container.innerHTML).toContain('CR05');
    expect(container.innerHTML).not.toContain('260924-005/CASH');
    expect(container.innerHTML).toContain('1,000.00');

    expect(container.innerHTML).toContain('POS05');
    expect(container.innerHTML).not.toContain('260924-005/POS');
    expect(container.innerHTML).toContain('2,050.00'); // 2000 + 2.5% card surcharge
  });

  it('4) printCashReceipt seamlessly delegates array of receipts to printSplitPaymentReceipts', () => {
    const container = document.getElementById('print-money-receipt-sheet');
    const receiptsList = [
      {
        voucher_number: '260924-008',
        receipt_no: '260924-008/CASH',
        receipt_date: '2026-09-24T15:00:00',
        guest_name: 'Vikram Singh',
        amount: 500,
        payment_mode: 'Cash',
        mode: 'cash',
        room_numbers: '301',
        is_split: true
      },
      {
        voucher_number: '260924-008',
        receipt_no: '260924-008/CHQ',
        receipt_date: '2026-09-24T15:00:00',
        guest_name: 'Vikram Singh',
        amount: 5000,
        payment_mode: 'Cheque',
        mode: 'cheque',
        cheque_no: 'CHQ-889900',
        room_numbers: '301',
        is_split: true
      }
    ];

    printCashReceipt(receiptsList);

    expect(container.innerHTML).toContain('CR08');
    expect(container.innerHTML).not.toContain('260924-008/CASH');
    expect(container.innerHTML).toContain('CHQ08');
    expect(container.innerHTML).not.toContain('260924-008/CHQ');
    expect(container.innerHTML).toContain('CHQ-889900');
  });

  it('5) Checkout settlement generates distinct receipts for each method paid (no master invoice)', () => {
    const splitCash = 1200;
    const splitOnline = 800;
    const splitCard = 0;
    const splitCheque = 0;
    const baseVoucher = '260924-010';
    const guestName = 'Sunita Rao';
    const roomNums = '104';
    const cashierName = 'Cashier';

    const checkoutReceipts = [];
    if (splitCash > 0) {
      checkoutReceipts.push({
        voucher_number: baseVoucher,
        receipt_no: `${baseVoucher}/CASH`,
        receipt_date: new Date(),
        guest_name: guestName,
        amount: splitCash,
        base_amount: splitCash,
        payment_mode: 'Cash',
        mode: 'cash',
        room_numbers: roomNums,
        particulars: `Room #${roomNums} - Checkout Bill Settlement (Cash)`,
        cashier_name: cashierName,
        is_split: true
      });
    }
    if (splitOnline > 0) {
      checkoutReceipts.push({
        voucher_number: baseVoucher,
        receipt_no: `${baseVoucher}/UPI`,
        receipt_date: new Date(),
        guest_name: guestName,
        amount: splitOnline,
        base_amount: splitOnline,
        payment_mode: 'Online UPI',
        mode: 'upi',
        utr_number: 'UTR556677',
        room_numbers: roomNums,
        particulars: `Room #${roomNums} - Checkout Bill Settlement (UPI)`,
        cashier_name: cashierName,
        is_split: true
      });
    }

    expect(checkoutReceipts.length).toBe(2);
    expect(checkoutReceipts[0].receipt_no).toBe('260924-010/CASH');
    expect(checkoutReceipts[0].amount).toBe(1200);
    expect(checkoutReceipts[1].receipt_no).toBe('260924-010/UPI');
    expect(checkoutReceipts[1].amount).toBe(800);
  });

  it('6) In-Stay Add Payment generates distinct receipts for all methods paid', () => {
    const splitCash = 500;
    const splitOnline = 1500;
    const splitCard = 2000;
    const splitCheque = 0;
    const activeCount = [splitCash > 0, splitOnline > 0, splitCard > 0, splitCheque > 0].filter(Boolean).length;
    expect(activeCount).toBe(3);

    const baseVoucher = '260924-015';
    const receipts = [];
    if (splitCash > 0) receipts.push({ receipt_no: `${baseVoucher}/CASH`, amount: splitCash });
    if (splitOnline > 0) receipts.push({ receipt_no: `${baseVoucher}/UPI`, amount: splitOnline });
    if (splitCard > 0) receipts.push({ receipt_no: `${baseVoucher}/POS`, amount: splitCard });

    expect(receipts.length).toBe(3);
    expect(receipts[0].receipt_no).toBe('260924-015/CASH');
    expect(receipts[1].receipt_no).toBe('260924-015/UPI');
    expect(receipts[2].receipt_no).toBe('260924-015/POS');
  });

  it('7) Checkin advance split payment safely defines cardAndUpiFees and creates valid receipts', () => {
    const draft = {
      splitCash: 1000,
      splitOnline: 1000,
      splitCard: 0,
      splitCheque: 0,
      onlineUtr: 'lkjhlkjhlkjh',
      guestName: 'AMIR RAZA IRFAN RANGREZ'
    };
    const cardPct = 2.5;
    const upiPct = 0.4;
    const upiThresh = 2000;

    const splitCashVal = Number(draft.splitCash) || 0;
    const splitOnlineVal = Number(draft.splitOnline) || 0;
    const splitCardVal = Number(draft.splitCard) || 0;
    const splitChequeVal = Number(draft.splitCheque) || 0;

    const cardSurchargeVal = (splitCardVal > 0 && cardPct > 0) ? Math.round((splitCardVal * cardPct) / 100) : 0;
    const upiTaxVal = (splitOnlineVal > upiThresh && upiPct > 0) ? Math.round((splitOnlineVal * upiPct) / 100) : 0;
    const cardAndUpiFees = {
      cardSurcharge: cardSurchargeVal,
      upiTax: upiTaxVal
    };

    const advReceipts = [];
    const voucherNo = '260925-002';
    const guestName = draft.guestName;
    const roomNums = '103';
    const cashierName = 'Cashier_1';

    if (splitCashVal > 0) {
      advReceipts.push({
        voucher_number: voucherNo,
        receipt_no: `${voucherNo}/CASH`,
        receipt_date: new Date(),
        guest_name: guestName,
        amount: splitCashVal,
        base_amount: splitCashVal,
        payment_mode: 'Cash',
        mode: 'cash',
        room_numbers: roomNums,
        particulars: `Room #${roomNums} - Check-In Advance Payment (Cash)`,
        cashier_name: cashierName,
        is_split: true
      });
    }
    if (splitOnlineVal > 0) {
      advReceipts.push({
        voucher_number: voucherNo,
        receipt_no: `${voucherNo}/UPI`,
        receipt_date: new Date(),
        guest_name: guestName,
        amount: splitOnlineVal + (cardAndUpiFees?.upiTax || 0),
        base_amount: splitOnlineVal,
        payment_mode: 'Online UPI',
        mode: 'upi',
        utr_number: draft.onlineUtr,
        upi_tax: cardAndUpiFees?.upiTax || 0,
        room_numbers: roomNums,
        particulars: `Room #${roomNums} - Check-In Advance Payment (UPI)`,
        cashier_name: cashierName,
        is_split: true
      });
    }

    expect(advReceipts.length).toBe(2);
    expect(advReceipts[0].amount).toBe(1000);
    expect(advReceipts[1].amount).toBe(1000); // UPI <= 2000 has 0 tax
    expect(advReceipts[1].utr_number).toBe('lkjhlkjhlkjh');
    expect(cardAndUpiFees.cardSurcharge).toBe(0);
    expect(cardAndUpiFees.upiTax).toBe(0);
  });

  it('8) formatReceiptNumberWithMode starts from 1, 2 padded (CR01, UPI01, POS01, CR02, UPI02, POS02) and strips /CASH, /UPI, /POS', () => {
    // Sequential number formatting starting from 1, 2
    expect(formatReceiptNumberWithMode(1, 'cash')).toBe('CR01');
    expect(formatReceiptNumberWithMode(2, 'cash')).toBe('CR02');
    expect(formatReceiptNumberWithMode('1', 'cash')).toBe('CR01');
    expect(formatReceiptNumberWithMode('2', 'cash')).toBe('CR02');

    expect(formatReceiptNumberWithMode(1, 'upi')).toBe('UPI01');
    expect(formatReceiptNumberWithMode(2, 'upi')).toBe('UPI02');
    expect(formatReceiptNumberWithMode(1, 'online')).toBe('UPI01');

    expect(formatReceiptNumberWithMode(1, 'card')).toBe('POS01');
    expect(formatReceiptNumberWithMode(2, 'card')).toBe('POS02');
    expect(formatReceiptNumberWithMode(1, 'pos')).toBe('POS01');

    expect(formatReceiptNumberWithMode(1, 'cheque')).toBe('CHQ01');
    expect(formatReceiptNumberWithMode(2, 'cheque')).toBe('CHQ02');

    // Existing pre-formatted mode numbers are preserved
    expect(formatReceiptNumberWithMode('CR01', 'cash')).toBe('CR01');
    expect(formatReceiptNumberWithMode('CR02', 'cash')).toBe('CR02');
    expect(formatReceiptNumberWithMode('UPI01', 'upi')).toBe('UPI01');
    expect(formatReceiptNumberWithMode('POS01', 'card')).toBe('POS01');

    // Numbers with dates strip date and format as pure mode serial
    expect(formatReceiptNumberWithMode('260925-003/CASH', 'cash')).toBe('CR03');
    expect(formatReceiptNumberWithMode('260925-003/UPI', 'upi')).toBe('UPI03');
    expect(formatReceiptNumberWithMode('260925-003/POS', 'card')).toBe('POS03');
    expect(formatReceiptNumberWithMode('UPI260926-004', 'upi')).toBe('UPI04');
    expect(formatReceiptNumberWithMode('260926-004', 'upi')).toBe('UPI04');
    expect(formatReceiptNumberWithMode('260926-24', 'upi')).toBe('UPI24');
  });

});

