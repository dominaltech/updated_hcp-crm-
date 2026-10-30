import React, { useState } from 'react';
import { printCashReceipt, downloadReceiptPDF } from '../../services/printService';
import { formatCurrency, formatDateTime } from '../../utils/formatters';

export default function CheckinSplitReceiptsModal({
  isOpen,
  data,
  onClose
}) {
  const [printedMap, setPrintedMap] = useState({});

  if (!isOpen || !data || !Array.isArray(data.receipts) || data.receipts.length === 0) {
    return null;
  }

  const receipts = data.receipts;
  const guestName = data.guestName || 'Guest';
  const roomNumber = data.roomNumber || '';
  const totalPaid = data.totalPaid || receipts.reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0);
  const voucherNumber = data.voucherNumber || '260916-001';
  const checkinTime = data.checkinTime || new Date();
  const cashierName = data.cashierName || 'Front Desk';

  const buildReceiptObj = (r) => {
    const rawMode = String(r.mode || r.label || 'cash').toLowerCase();
    let modeKey = 'cash';
    let label = r.label || 'Cash';

    if (rawMode.includes('upi') || rawMode.includes('online')) {
      modeKey = 'upi';
      label = 'Online UPI';
    } else if (rawMode.includes('card') || rawMode.includes('pos')) {
      modeKey = 'card';
      label = 'Card POS';
    } else if (rawMode.includes('cheque') || rawMode.includes('check')) {
      modeKey = 'cheque';
      label = 'Cheque';
    }

    const isPrebook = Boolean(r.is_prebooked || r.is_prebooking || r.badge === 'PRE-BOOKING ADVANCE');
    return {
      receipt_no: r.receipt_no || (modeKey === 'upi' ? 'UPI01' : modeKey === 'card' ? 'POS01' : modeKey === 'cheque' ? 'CHQ01' : 'CR01'),
      voucher_number: voucherNumber,
      receipt_date: r.receipt_date || checkinTime,
      guest_name: guestName,
      amount: r.amount,
      base_amount: r.base_amount || r.amount,
      card_surcharge: r.card_surcharge || 0,
      upi_tax: r.upi_tax || 0,
      payment_mode: label,
      mode: modeKey,
      utr_number: r.utr_number || null,
      card_digits: r.card_digits || null,
      cheque_no: r.cheque_no || null,
      bank_name: r.bank_name || null,
      room_numbers: roomNumber,
      particulars: isPrebook
        ? (r.particulars || `Room #${roomNumber} - Advance Pre-Booking Payment (${label})`)
        : (r.particulars || `Room #${roomNumber} - Check-In Payment (${label})`),
      stageLabel: isPrebook ? 'Paid For Pre-Booking' : 'Paid For CheckIn',
      is_prebooking: isPrebook,
      is_prebooked: isPrebook,
      cashier_name: cashierName,
      is_split: true
    };
  };

  const handlePrintReceipt = (r) => {
    const receiptObj = buildReceiptObj(r);
    printCashReceipt(receiptObj);
    setPrintedMap((prev) => ({ ...prev, [r.receipt_no]: true }));
  };

  const handleDownloadReceipt = async (r) => {
    const receiptObj = buildReceiptObj(r);
    await downloadReceiptPDF(receiptObj);
  };

  const handlePrintAll = () => {
    receipts.forEach((r, idx) => {
      setTimeout(() => {
        handlePrintReceipt(r);
      }, idx * 600);
    });
  };

  const getModeInfo = (r) => {
    const rawMode = String(r.mode || r.label || 'cash').toLowerCase();
    if (rawMode.includes('upi') || rawMode.includes('online')) {
      const extraParts = [];
      if (r.utr_number) extraParts.push(`UTR: ${r.utr_number}`);
      if (r.upi_tax > 0) extraParts.push(`+₹${r.upi_tax} UPI MDR fees`);
      return {
        icon: '📱',
        label: 'ONLINE UPI',
        bg: '#eff6ff',
        color: '#1d4ed8',
        border: '#bfdbfe',
        extra: extraParts.length > 0 ? extraParts.join(' • ') : null
      };
    } else if (rawMode.includes('card') || rawMode.includes('pos')) {
      return {
        icon: '💳',
        label: 'CARD POS',
        bg: '#fdf4ff',
        color: '#a21caf',
        border: '#f5d0fe',
        extra: r.card_surcharge ? `+₹${r.card_surcharge} Card fee` : null
      };
    } else if (rawMode.includes('cheque') || rawMode.includes('check')) {
      return {
        icon: '🏦',
        label: 'CHEQUE',
        bg: '#fefce8',
        color: '#a16207',
        border: '#fef08a',
        extra: r.cheque_no ? `Cheque #${r.cheque_no}` : null
      };
    }
    return {
      icon: '💵',
      label: 'CASH',
      bg: '#f0fdf4',
      color: '#15803d',
      border: '#bbf7d0',
      extra: null
    };
  };

  return (
    <div
      className="modal-overlay active"
      id="checkin-split-receipts-overlay"
      style={{
        zIndex: 99999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(4px)',
        padding: '16px'
      }}
    >
      <div
        className="modal-container"
        id="checkin-split-receipts-modal"
        style={{
          width: '780px',
          maxWidth: '96vw',
          maxHeight: '90vh',
          borderRadius: '18px',
          background: '#ffffff',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(0, 0, 0, 0.05)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
      >
        {/* Header */}
        <div
          className="modal-header"
          style={{
            padding: '16px 24px',
            background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
            color: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '1.4rem' }}>🧾</span>
            <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#ffffff', letterSpacing: '-0.01em' }}>
              {data.title || 'Print Payment Receipts (Split Payment)'}
            </h3>
          </div>
          <button
            type="button"
            className="universal-close-btn modal-close-btn"
            id="btn-close-split-receipts"
            onClick={onClose}
            title="Close (X)"
            style={{
              width: '32px',
              height: '32px',
              minWidth: '32px',
              minHeight: '32px',
              borderRadius: '8px',
              background: 'rgba(255, 255, 255, 0.2)',
              border: 'none',
              color: '#ffffff',
              fontSize: '1.4rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer'
            }}
          >
            &times;
          </button>
        </div>

        {/* Receipts List Body */}
        <div
          className="modal-body"
          style={{
            padding: '20px 24px',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
            flex: 1
          }}
        >
          {receipts.map((r, idx) => {
            const info = getModeInfo(r);
            const isPrinted = Boolean(printedMap[r.receipt_no]);

            return (
              <div
                key={r.receipt_no || idx}
                className="split-receipt-card"
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '16px 20px',
                  borderRadius: '14px',
                  background: info.bg,
                  border: `1.5px solid ${info.border}`,
                  transition: 'all 0.2s ease',
                  gap: '16px'
                }}
              >
                {/* Left meta information */}
                <div className="split-receipt-card-left" style={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '1.2rem', lineHeight: 1 }}>{info.icon}</span>
                    <span
                      style={{
                        fontSize: '0.76rem',
                        fontWeight: 800,
                        padding: '3px 9px',
                        borderRadius: '6px',
                        background: '#ffffff',
                        color: info.color,
                        border: `1px solid ${info.border}`,
                        letterSpacing: '0.04em',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {info.label}
                    </span>
                    <span
                      style={{
                        fontSize: '0.95rem',
                        fontWeight: 900,
                        color: '#0f172a',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      Receipt #{r.receipt_no}
                    </span>
                    {(r.badge || r.is_prebooked) && (
                      <span
                        style={{
                          fontSize: '0.70rem',
                          fontWeight: 900,
                          padding: '3px 9px',
                          borderRadius: '8px',
                          background: r.is_prebooked ? '#FEF3C7' : '#DCFCE7',
                          color: r.is_prebooked ? '#B45309' : '#15803D',
                          border: `1px solid ${r.is_prebooked ? '#F59E0B' : '#86EFAC'}`,
                          whiteSpace: 'nowrap',
                          letterSpacing: '0.02em'
                        }}
                      >
                        {r.badge || (r.is_prebooked ? 'PRE-BOOKING ADVANCE' : "TODAY'S CHECK-IN PAYMENT")}
                      </span>
                    )}
                  </div>

                  <div style={{ fontSize: '0.80rem', color: '#64748b', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <span>📅 {formatDateTime(r.receipt_date || checkinTime)}</span>
                    {info.extra && (
                      <span style={{ color: info.color, fontWeight: 700 }}>
                        • {info.extra}
                      </span>
                    )}
                  </div>
                </div>

                {/* Right amounts & action buttons */}
                <div className="split-receipt-card-right" style={{ display: 'flex', alignItems: 'center', gap: '16px', flexShrink: 0 }}>
                  <div style={{ textAlign: 'right', minWidth: '95px' }}>
                    <div style={{ fontSize: '1.25rem', fontWeight: 900, color: '#0f172a', letterSpacing: '-0.02em', lineHeight: 1.2 }}>
                      {formatCurrency(r.amount)}
                    </div>
                    {isPrinted ? (
                      <span
                        style={{
                          fontSize: '0.72rem',
                          fontWeight: 800,
                          color: '#15803d',
                          background: '#dcfce7',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          display: 'inline-block',
                          marginTop: '3px'
                        }}
                      >
                        ✓ Printed
                      </span>
                    ) : (
                      <span
                        style={{
                          fontSize: '0.72rem',
                          fontWeight: 700,
                          color: '#0369a1',
                          background: '#e0f2fe',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          display: 'inline-block',
                          marginTop: '3px'
                        }}
                      >
                        Ready to print
                      </span>
                    )}
                  </div>

                  <div className="split-receipt-actions" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      id={`btn-print-split-${r.receipt_no}`}
                      onClick={() => handlePrintReceipt(r)}
                      style={{
                        padding: '8px 16px',
                        fontSize: '0.86rem',
                        fontWeight: 750,
                        borderRadius: '9px',
                        background: isPrinted ? 'linear-gradient(135deg, #059669 0%, #047857 100%)' : 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
                        border: 'none',
                        color: '#ffffff',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                        boxShadow: isPrinted ? '0 2px 6px rgba(5, 150, 105, 0.35)' : '0 2px 6px rgba(2, 132, 199, 0.35)'
                      }}
                      title={`Print official ${info.label} receipt (${r.receipt_no})`}
                    >
                      <span>🖨️</span>
                      <span>{isPrinted ? 'Print Again' : 'Print Receipt'}</span>
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-download-split-receipt"
                      id={`btn-download-split-${r.receipt_no}`}
                      onClick={() => handleDownloadReceipt(r)}
                      style={{
                        padding: '8px 14px',
                        fontSize: '0.86rem',
                        fontWeight: 750,
                        borderRadius: '9px',
                        background: '#ecfdf5',
                        border: '1.5px solid #a7f3d0',
                        color: '#047857',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                        boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
                      }}
                      title={`Download official ${info.label} receipt PDF (${r.receipt_no})`}
                    >
                      <span>📥</span>
                      <span>Download</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer with Total Paid, Print All, and Close Button */}
        <div
          className="modal-footer"
          style={{
            padding: '14px 24px',
            borderTop: '1px solid #e2e8f0',
            background: '#f8fafc',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '12px',
            flexShrink: 0
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '0.90rem', color: '#64748b', fontWeight: 600 }}>Total Paid:</span>
            <span style={{ color: '#0f172a', fontSize: '1.15rem', fontWeight: 900 }}>{formatCurrency(totalPaid)}</span>
            <span style={{ fontSize: '0.75rem', color: '#475569', background: '#e2e8f0', padding: '3px 9px', borderRadius: '12px', fontWeight: 700 }}>
              {receipts.length} {receipts.length === 1 ? 'Receipt' : 'Receipts'}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {receipts.length > 1 && (
              <button
                type="button"
                id="btn-print-all-split-receipts"
                onClick={handlePrintAll}
                style={{
                  padding: '9px 18px',
                  fontSize: '0.88rem',
                  fontWeight: 800,
                  borderRadius: '9px',
                  background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                  border: 'none',
                  color: '#ffffff',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  boxShadow: '0 2px 6px rgba(16, 185, 129, 0.35)',
                  whiteSpace: 'nowrap'
                }}
              >
                <span>🖨️</span>
                <span>Print All Receipts ({receipts.length})</span>
              </button>
            )}
            <button
              type="button"
              className="btn btn-secondary"
              id="btn-close-split-receipts-bottom"
              onClick={onClose}
              style={{
                padding: '9px 24px',
                fontSize: '0.88rem',
                fontWeight: 750,
                borderRadius: '9px',
                cursor: 'pointer',
                background: '#ffffff',
                border: '1.5px solid #cbd5e1',
                color: '#334155',
                boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                whiteSpace: 'nowrap'
              }}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
