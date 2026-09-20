import React from 'react';

/**
 * Renders the hidden DOM sheets for full-page A4 registration cards,
 * 2-per-A4 official money receipts, and 2-per-A4 petty cash vouchers.
 * These are styled by styles.css @media print rules.
 */
export default function PrintTemplatesContainer() {
  return (
    <>
      {/* ==========================================================================
           A4 PRINTABLE GUEST REGISTRATION CARD & CHECK-IN FORM (FULL A4 SHEET)
           ========================================================================== */}
      <div id="print-registration-sheet" className="printable-full-a4-sheet" style={{ display: 'none' }}></div>

      {/* ==========================================================================
           PRINTABLE 2-PER-A4 SHEET 1: OFFICIAL MONEY RECEIPT (CHECK-IN ADVANCE & DUE)
           ========================================================================== */}
      <div id="print-money-receipt-sheet" className="printable-two-per-a4-sheet" style={{ display: 'none' }}></div>

      {/* ==========================================================================
           PRINTABLE 2-PER-A4 SHEET 2: OFFICIAL PETTY CASH / CASH VOUCHER
           ========================================================================== */}
      <div id="print-petty-cash-sheet" className="printable-two-per-a4-sheet" style={{ display: 'none' }}></div>

      {/* ==========================================================================
           PRINTABLE A4 SHEET: CUSTOMER PAYMENT STATEMENT / SUMMARY
           ========================================================================== */}
      <div id="print-payment-summary-sheet" className="printable-full-a4-sheet" style={{ display: 'none' }}></div>
    </>
  );
}

