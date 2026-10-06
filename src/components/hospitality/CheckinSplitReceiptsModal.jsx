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

    return {
      receipt_no: r.receipt_no || (modeKey === 'upi' ? 'UPI01' : modeKey === 'card' ? 'POS01' : modeKey === 'cheque' ? 'CHQ01' : 'CR01'),
      voucher_number: voucherNumber,
      receipt_date: checkinTime,
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
      particulars: `Room #${roomNumber} - Check-In Advance Payment (${label})`,
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
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(3px)'
      }}
    >
      <div
        className="modal-container"
        id="checkin-split-receipts-modal"
        style={{
          width: '560px',
          maxWidth: '94vw',
          maxHeight: '90vh',
          borderRadius: '16px',
          background: '#ffffff',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.1)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
      >
        {/* Header */}
        <div
          className="modal-header"
          style={{
            padding: '14px 20px',
            background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
            color: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '1.4rem' }}>🧾</span>
            <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#ffffff' }}>
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
            padding: '16px 20px',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            flex: 1
          }}
        >
          {receipts.map((r, idx) => {
            const info = getModeInfo(r);
            const isPrinted = Boolean(printedMap[r.receipt_no]);

            return (
              <div
                key={r.receipt_no || idx}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '14px 16px',
                  borderRadius: '12px',
                  background: info.bg,
                  border: `1.5px solid ${info.border}`,
                  transition: 'all 0.2s ease'
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                    <span style={{ fontSize: '1.1rem' }}>{info.icon}</span>
                    <span
                      style={{
                        fontSize: '0.74rem',
                        fontWeight: 800,
                        padding: '2px 8px',
                        borderRadius: '6px',
                        background: '#ffffff',
                        color: info.color,
                        border: `1px solid ${info.border}`,
                        letterSpacing: '0.04em'
                      }}
                    >
                      {info.label}
                    </span>
                    <span
                      style={{
                        fontSize: '0.90rem',
                        fontWeight: 900,
                        color: '#0f172a'
                      }}
                    >
                      Receipt #{r.receipt_no}
                    </span>
                  </div>

                  <div style={{ fontSize: '0.78rem', color: '#64748b', display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <span>{formatDateTime(checkinTime)}</span>
                    {info.extra && (
                      <span style={{ color: info.color, fontWeight: 700 }}>
                        • {info.extra}
                      </span>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '1.15rem', fontWeight: 900, color: '#0f172a' }}>
                      {formatCurrency(r.amount)}
                    </div>
                    {isPrinted ? (
                      <span
                        style={{
                          fontSize: '0.70rem',
                          fontWeight: 800,
                          color: '#15803d',
                          background: '#dcfce7',
                          padding: '2px 6px',
                          borderRadius: '4px'
                        }}
                      >
                        ✓ Printed
                      </span>
                    ) : (
                      <span
                        style={{
                          fontSize: '0.70rem',
                          fontWeight: 700,
                          color: '#0369a1'
                        }}
                      >
                        Ready to print
                      </span>
                    )}
                  </div>

                  <button
                    type="button"
                    className="btn btn-primary"
                    id={`btn-print-split-${r.receipt_no}`}
                    onClick={() => handlePrintReceipt(r)}
                    style={{
                      padding: '7px 14px',
                      fontSize: '0.84rem',
                      fontWeight: 750,
                      borderRadius: '8px',
                      background: isPrinted ? '#047857' : '#0284c7',
                      borderColor: isPrinted ? '#059669' : '#0284c7',
                      color: '#ffffff',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      cursor: 'pointer',
                      boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
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
                      padding: '7px 12px',
                      fontSize: '0.84rem',
                      fontWeight: 750,
                      borderRadius: '8px',
                      background: '#ecfdf5',
                      borderColor: '#a7f3d0',
                      color: '#047857',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                      cursor: 'pointer',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
                    }}
                    title={`Download official ${info.label} receipt PDF (${r.receipt_no})`}
                  >
                    <span>📥</span>
                    <span>Download</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer with Close Button */}
        <div
          className="modal-footer"
          style={{
            padding: '12px 20px',
            borderTop: '1px solid #e2e8f0',
            background: '#f8fafc',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}
        >
          <div style={{ fontSize: '0.88rem', color: '#64748b', fontWeight: 600 }}>
            Total Paid: <strong style={{ color: '#0f172a', fontSize: '1rem' }}>{formatCurrency(totalPaid)}</strong>
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            id="btn-close-split-receipts-bottom"
            onClick={onClose}
            style={{
              padding: '8px 22px',
              fontSize: '0.88rem',
              fontWeight: 700,
              borderRadius: '8px',
              cursor: 'pointer',
              background: '#e2e8f0',
              border: '1px solid #cbd5e1',
              color: '#334155'
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
