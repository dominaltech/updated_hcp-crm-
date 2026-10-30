import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../../services/api';
import { printFrontOfficeCashHandover } from '../../services/printService';
import ThemedDatePicker from '../common/ThemedDatePicker';
import { numberToWordsINR } from '../../utils/numberToWords';

export default function CashHandoverModal({ isOpen, onClose, currentUser }) {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [shift, setShift] = useState('all');
  const [staffName, setStaffName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [handoverData, setHandoverData] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [showBreakdown, setShowBreakdown] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const name = currentUser?.full_name || currentUser?.name || currentUser?.username || 'Front Desk';
      setStaffName(name);
    }
  }, [isOpen, currentUser]);

  const loadData = useCallback(async () => {
    if (!isOpen) return;
    setIsLoading(true);
    setErrorMsg('');
    try {
      const res = await api.getFoCashHandoverData({ date, shift });
      if (res && res.success) {
        setHandoverData(res);
      } else {
        setErrorMsg(res?.error || 'Failed to fetch cash handover records.');
      }
    } catch (err) {
      setErrorMsg(err.message || 'Server error loading handover records.');
    } finally {
      setIsLoading(false);
    }
  }, [isOpen, date, shift]);

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen, loadData]);

  if (!isOpen) return null;

  const foCashSales = Number(handoverData?.foCashSales || 0);
  const foDeposits = Number(handoverData?.foDeposits || 0);
  const otherIncome = Number(handoverData?.otherIncome || 0);
  const toHandoverA = Number(handoverData?.toHandoverA || (foCashSales + foDeposits + otherIncome));
  const fbCashCollected = Number(handoverData?.fbCashCollected || 0);
  const totalReceiptsCR = Number(handoverData?.totalReceiptsCR || toHandoverA);
  const totalRefund = Number(handoverData?.totalRefund || 0);
  const netHandover = Number(handoverData?.netHandover || Math.max(0, totalReceiptsCR - totalRefund));
  const amountWords = numberToWordsINR(netHandover);

  const handlePrint = () => {
    if (!handoverData) return;
    const now = new Date();
    const dayName = now.toLocaleDateString('en-IN', { weekday: 'long' });
    const timeStr = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

    printFrontOfficeCashHandover(handoverData, {
      staffName: staffName.trim() || 'Front Desk Cashier',
      dayName,
      timeStr,
      dateStr: new Date(date).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' })
    });
  };

  return (
    <div className="modal-backdrop active" style={{ zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div
        className="modal-card"
        style={{
          width: '94%',
          maxWidth: '780px',
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          borderRadius: '16px',
          boxShadow: '0 25px 60px rgba(0,0,0,0.3)',
          background: '#ffffff',
          overflow: 'hidden'
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            background: 'linear-gradient(135deg, #1e293b, #0f172a)',
            color: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid #334155'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '1.4rem' }}>💵</span>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#f8fafc' }}>
                Front Office Cash Handover Statement
              </h3>
              <p style={{ margin: 0, fontSize: '0.78rem', color: '#94a3b8' }}>
                Shift Cash Reconciliation • Prints 2 exact copies on single A4 sheet
              </p>
            </div>
          </div>
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.1)',
              border: 'none',
              color: '#fff',
              padding: '6px 12px',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: 700
            }}
          >
            ✕ Close
          </button>
        </div>

        {/* Filter Controls Toolbar */}
        <div
          style={{
            padding: '12px 20px',
            background: '#f8fafc',
            borderBottom: '1.5px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            gap: '14px',
            flexWrap: 'wrap'
          }}
        >
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#475569' }}>Date:</span>
            <ThemedDatePicker
              value={date}
              onChange={(e) => setDate(e.target.value)}
              style={{ width: '145px', height: '34px', fontSize: '0.82rem' }}
            />
          </div>

          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#475569' }}>Shift:</span>
            <select
              value={shift}
              onChange={(e) => setShift(e.target.value)}
              className="form-input form-input-sm"
              style={{ height: '34px', fontSize: '0.82rem', fontWeight: 650, borderRadius: '8px', width: '220px' }}
            >
              <option value="all">Full Day / All Shifts</option>
              <option value="morning">Shift 1 / Morning (07:00 AM - 03:00 PM)</option>
              <option value="evening">Shift 2 / Evening (03:00 PM - 11:00 PM)</option>
              <option value="night">Shift 3 / Night (11:00 PM - 07:00 AM)</option>
            </select>
          </div>

          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#475569' }}>Paying Cashier:</span>
            <input
              type="text"
              className="form-input form-input-sm"
              value={staffName}
              onChange={(e) => setStaffName(e.target.value)}
              placeholder="Cashier Staff Name"
              style={{ width: '150px', height: '34px', fontSize: '0.82rem', fontWeight: 700 }}
            />
          </div>

          <button
            type="button"
            className="btn-secondary"
            onClick={loadData}
            style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '6px 12px' }}
          >
            <span>🔄</span> Refresh
          </button>
        </div>

        {/* Modal Body / Statement Preview */}
        <div style={{ padding: '16px 20px', overflowY: 'auto', flex: 1 }}>
          {isLoading ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#64748b' }}>
              <div style={{ fontSize: '1.8rem', marginBottom: '8px' }}>⏳</div>
              <p style={{ fontWeight: 600 }}>Calculating shift cash collections...</p>
            </div>
          ) : errorMsg ? (
            <div style={{ padding: '16px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '10px', color: '#991b1b', textAlign: 'center' }}>
              ⚠️ {errorMsg}
            </div>
          ) : handoverData ? (
            <div>
              {/* Paper Statement Box */}
              <div
                style={{
                  border: '1.5px solid #0f172a',
                  borderRadius: '10px',
                  background: '#ffffff',
                  boxShadow: '0 4px 15px rgba(0,0,0,0.04)',
                  overflow: 'hidden'
                }}
              >
                {/* Statement Top Info */}
                <div style={{ padding: '12px 16px', borderBottom: '1.5px solid #0f172a', background: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <h4 style={{ margin: 0, fontSize: '0.96rem', fontWeight: 900, color: '#0f172a', textTransform: 'uppercase' }}>
                      HOTEL CITYPAARK
                    </h4>
                    <p style={{ margin: 0, fontSize: '0.72rem', color: '#475569', fontWeight: 600 }}>
                      119, Murarji Peth, Char Hutatma Chowk, Solapur - 413 001.
                    </p>
                  </div>
                  <div style={{ textAlign: 'right', fontSize: '0.76rem', fontWeight: 700, color: '#1e293b', lineHeight: 1.35 }}>
                    <div>SHIFT: <span style={{ color: '#0284c7' }}>{handoverData.shift}</span></div>
                    <div>DATE: <span>{new Date(date).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' })}</span></div>
                    <div>STAFF: <span style={{ textTransform: 'uppercase', color: '#059669' }}>{staffName}</span></div>
                  </div>
                </div>

                {/* Statement Content Table */}
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                  <thead>
                    <tr style={{ background: '#f1f5f9', borderBottom: '1.5px solid #0f172a' }}>
                      <th style={{ width: '36%', padding: '8px 12px', textAlign: 'left', borderRight: '1px solid #cbd5e1', fontWeight: 800 }}>RECEIPTS</th>
                      <th style={{ width: '14%', padding: '8px 12px', textAlign: 'right', borderRight: '1.5px solid #0f172a', fontWeight: 800 }}>AMOUNT</th>
                      <th style={{ width: '36%', padding: '8px 12px', textAlign: 'left', borderRight: '1px solid #cbd5e1', fontWeight: 800 }}>DETAILS OF CASH HANDOVER</th>
                      <th style={{ width: '14%', padding: '8px 12px', textAlign: 'right', fontWeight: 800 }}>AMOUNT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* A. Front Office */}
                    <tr style={{ background: '#fdfdfe' }}>
                      <td style={{ padding: '6px 12px', fontWeight: 800, borderRight: '1px solid #cbd5e1', color: '#0f172a' }}>
                        A. Front Office
                      </td>
                      <td style={{ padding: '6px 12px', borderRight: '1.5px solid #0f172a' }}></td>
                      <td style={{ padding: '6px 12px', fontWeight: 800, borderRight: '1px solid #cbd5e1' }}>
                        Total (CR) Receipts Rs.
                      </td>
                      <td style={{ padding: '6px 12px', textAlign: 'right', fontWeight: 850, color: '#0f172a' }}>
                        ₹ {toHandoverA.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                    <tr>
                      <td style={{ padding: '5px 12px', paddingLeft: '24px', borderRight: '1px solid #cbd5e1' }}>
                        1. F. O. Cash Sales
                      </td>
                      <td style={{ padding: '5px 12px', textAlign: 'right', borderRight: '1.5px solid #0f172a', fontWeight: 700 }}>
                        ₹ {foCashSales.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td style={{ padding: '5px 12px', fontWeight: 800, borderRight: '1px solid #cbd5e1', color: '#dc2626' }}>
                        Total Refund Rs.
                      </td>
                      <td style={{ padding: '5px 12px', textAlign: 'right', fontWeight: 800, color: '#dc2626' }}>
                        ₹ {totalRefund.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                    <tr>
                      <td style={{ padding: '5px 12px', paddingLeft: '24px', borderRight: '1px solid #cbd5e1' }}>
                        2. F. O. Deposits
                      </td>
                      <td style={{ padding: '5px 12px', textAlign: 'right', borderRight: '1.5px solid #0f172a', fontWeight: 700 }}>
                        ₹ {foDeposits.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td style={{ padding: '6px 12px', fontWeight: 900, borderTop: '1.5px solid #0f172a', borderRight: '1px solid #cbd5e1', background: '#f0fdf4', color: '#166534' }}>
                        Net Handover to A/c.'s Rs.
                      </td>
                      <td style={{ padding: '6px 12px', textAlign: 'right', fontWeight: 950, borderTop: '1.5px solid #0f172a', background: '#f0fdf4', color: '#166534', fontSize: '0.95rem' }}>
                        ₹ {netHandover.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                    <tr>
                      <td style={{ padding: '5px 12px', paddingLeft: '24px', borderRight: '1px solid #cbd5e1' }}>
                        3. Other Income
                      </td>
                      <td style={{ padding: '5px 12px', textAlign: 'right', borderRight: '1.5px solid #0f172a', fontWeight: 700 }}>
                        ₹ {otherIncome.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td style={{ padding: '5px 12px', borderRight: '1px solid #cbd5e1' }} colSpan={2}></td>
                    </tr>
                    <tr style={{ borderTop: '1.5px solid #cbd5e1', borderBottom: '1.5px solid #cbd5e1', background: '#f8fafc' }}>
                      <td style={{ padding: '6px 12px', fontWeight: 900, borderRight: '1px solid #cbd5e1', color: '#0f172a' }}>
                        To Handover Rs.
                      </td>
                      <td style={{ padding: '6px 12px', textAlign: 'right', fontWeight: 900, borderRight: '1.5px solid #0f172a', color: '#0f172a' }}>
                        ₹ {toHandoverA.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td style={{ padding: '6px 12px', borderRight: '1px solid #cbd5e1' }} colSpan={2}></td>
                    </tr>
                    {/* B. To Pay F&B */}
                    <tr>
                      <td style={{ padding: '6px 12px', fontWeight: 800, borderRight: '1px solid #cbd5e1', color: '#7c3aed' }}>
                        B. To Pay F&B :-
                      </td>
                      <td style={{ padding: '6px 12px', borderRight: '1.5px solid #0f172a' }}></td>
                      <td style={{ padding: '6px 12px', borderRight: '1px solid #cbd5e1' }} colSpan={2}></td>
                    </tr>
                    <tr>
                      <td style={{ padding: '5px 12px', paddingLeft: '24px', borderRight: '1px solid #cbd5e1' }}>
                        Total F&B Cash Collected
                      </td>
                      <td style={{ padding: '5px 12px', textAlign: 'right', borderRight: '1.5px solid #0f172a', fontWeight: 800, color: '#7c3aed' }}>
                        ₹ {fbCashCollected.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td style={{ padding: '5px 12px', borderRight: '1px solid #cbd5e1' }} colSpan={2}></td>
                    </tr>
                  </tbody>
                </table>

                {/* Footer Strip */}
                <div style={{ padding: '12px 16px', background: '#fafafa', borderTop: '1.5px solid #0f172a' }}>
                  <div style={{ fontSize: '0.92rem', fontWeight: 900, color: '#0f172a' }}>
                    Total Rs. : <span style={{ color: '#059669', fontSize: '1.05rem' }}>₹ {netHandover.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div style={{ fontSize: '0.80rem', fontWeight: 700, color: '#334155', marginTop: '2px', fontStyle: 'italic' }}>
                    Total in Words : {amountWords}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '16px', paddingTop: '10px', borderTop: '1px dashed #cbd5e1', fontSize: '0.78rem', fontWeight: 750, color: '#475569' }}>
                    <div>
                      Signature of Paying Cashier: <strong style={{ color: '#0f172a' }}>[{staffName}]</strong> _____________________
                    </div>
                    <div>
                      Signature of Receiving Cashier: _____________________
                    </div>
                  </div>
                </div>
              </div>

              {/* Collapsible Detailed Transactions Button */}
              <div style={{ marginTop: '14px', textAlign: 'center' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowBreakdown((prev) => !prev)}
                  style={{ fontSize: '0.78rem', padding: '4px 12px', borderRadius: '8px' }}
                >
                  {showBreakdown ? '▲ Hide Transaction Breakdowns' : '▼ View Detailed Bill Breakdowns'}
                </button>
              </div>

              {showBreakdown && handoverData.breakdowns && (
                <div style={{ marginTop: '10px', padding: '12px', background: '#f8fafc', borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '0.78rem' }}>
                  <h5 style={{ margin: '0 0 6px', fontWeight: 800, color: '#1e293b' }}>Cash Sales Transactions ({handoverData.breakdowns.foCashSalesRows.length}):</h5>
                  {handoverData.breakdowns.foCashSalesRows.length === 0 ? (
                    <p style={{ color: '#94a3b8', margin: '0 0 10px' }}>No direct cash sales in this shift.</p>
                  ) : (
                    <ul style={{ margin: '0 0 10px', paddingLeft: '18px' }}>
                      {handoverData.breakdowns.foCashSalesRows.map((r) => (
                        <li key={r.id}>
                          <strong>₹{(r.split_cash || r.amount).toLocaleString('en-IN')}</strong> — Room #{r.room_number || '-'} ({r.guest_name || 'Guest'}) · Vch: {r.voucher_number || '-'} · Type: {r.payment_type} · Time: {r.created_at}
                        </li>
                      ))}
                    </ul>
                  )}

                  <h5 style={{ margin: '6px 0', fontWeight: 800, color: '#1e293b' }}>Advance Cash Deposits ({handoverData.breakdowns.depositRows.length}):</h5>
                  {handoverData.breakdowns.depositRows.length === 0 ? (
                    <p style={{ color: '#94a3b8', margin: '0 0 10px' }}>No advance cash deposits in this shift.</p>
                  ) : (
                    <ul style={{ margin: '0 0 10px', paddingLeft: '18px' }}>
                      {handoverData.breakdowns.depositRows.map((r) => (
                        <li key={r.id}>
                          <strong>₹{(r.advance_amount).toLocaleString('en-IN')}</strong> — Booking #{r.booking_number} ({r.customer_name}) · Room #{r.room_number}
                        </li>
                      ))}
                    </ul>
                  )}

                  {handoverData.breakdowns.fnbCollectionDetails.length > 0 && (
                    <>
                      <h5 style={{ margin: '6px 0', fontWeight: 800, color: '#7c3aed' }}>F&B Cash Collected at Checkout ({handoverData.breakdowns.fnbCollectionDetails.length}):</h5>
                      <ul style={{ margin: 0, paddingLeft: '18px' }}>
                        {handoverData.breakdowns.fnbCollectionDetails.map((f, i) => (
                          <li key={i}>
                            <strong>₹{f.fnbCashPortion.toLocaleString('en-IN')}</strong> — Room #{f.room_number} ({f.guest_name}) · Vch: {f.voucher_number} · Total Room F&B: ₹{f.totalRoomFnb}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              )}
            </div>
          ) : null}
        </div>

        {/* Action Footer */}
        <div
          style={{
            padding: '14px 20px',
            background: '#f8fafc',
            borderTop: '1.5px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}
        >
          <div style={{ fontSize: '0.80rem', color: '#64748b' }}>
            Prints <strong>2 copies on 1 A4 sheet</strong> (Front Copy + Accounts Copy).
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={onClose}
              style={{ padding: '8px 16px', borderRadius: '8px', fontWeight: 650 }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={handlePrint}
              disabled={isLoading || !handoverData}
              style={{
                padding: '8px 22px',
                borderRadius: '8px',
                fontWeight: 750,
                background: '#059669',
                borderColor: '#047857',
                color: '#fff',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                boxShadow: '0 4px 12px rgba(5, 150, 105, 0.25)'
              }}
            >
              <span>🖨️</span> Print Statement (2 Copies A4)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
