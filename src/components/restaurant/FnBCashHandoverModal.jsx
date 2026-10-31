import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../../services/api';
import { printFnBCashHandover } from '../../services/printService';
import ThemedDatePicker from '../common/ThemedDatePicker';
import { numberToWordsINR } from '../../utils/numberToWords';

export default function FnBCashHandoverModal({ isOpen, onClose, currentUser }) {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [shift, setShift] = useState('7am-7pm');
  const [staffName, setStaffName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [handoverData, setHandoverData] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [showBreakdown, setShowBreakdown] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const name = currentUser?.full_name || currentUser?.name || currentUser?.username || 'F&B Cashier';
      setStaffName(name);
    }
  }, [isOpen, currentUser]);

  const loadData = useCallback(async () => {
    if (!isOpen) return;
    setIsLoading(true);
    setErrorMsg('');
    try {
      const res = await api.getFnbCashHandoverData({ date, shift });
      if (res && res.success) {
        setHandoverData(res);
      } else {
        setErrorMsg(res?.error || 'Failed to fetch F&B cash handover records.');
      }
    } catch (err) {
      setErrorMsg(err.message || 'Server error loading F&B handover records.');
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

  const fnbCashSales = Number(handoverData?.fnbCashSales || 0);
  const fnbDeposits = Number(handoverData?.fnbDeposits || 0);
  const toHandoverA = Number(handoverData?.toHandoverA || (fnbCashSales + fnbDeposits));
  const fbFromReception = Number(handoverData?.fbFromReception || 0);
  const totalReceiptsCR = Number(handoverData?.totalReceiptsCR || toHandoverA);
  const totalRefund = Number(handoverData?.totalRefund || 0);
  const netHandover = Number(handoverData?.netHandover || Math.max(0, totalReceiptsCR - totalRefund));
  const amountWords = numberToWordsINR(netHandover);

  const handlePrint = () => {
    if (!handoverData) return;
    const now = new Date();
    const dayName = now.toLocaleDateString('en-IN', { weekday: 'long' });
    const timeStr = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

    printFnBCashHandover(handoverData, {
      staffName: staffName.trim() || 'F&B Cashier',
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
            background: 'linear-gradient(135deg, #7c2d12, #451a03)',
            color: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid #78350f'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '1.4rem' }}>🍽️</span>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#fef3c7' }}>
                F&B Cash Handover Statement
              </h3>
              <p style={{ margin: 0, fontSize: '0.78rem', color: '#fed7aa' }}>
                Restaurant & Bar Cash Audit • Prints 2 exact copies on single A4 sheet
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              border: '1px solid rgba(255,255,255,0.25)',
              background: 'rgba(255,255,255,0.18)',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              fontSize: '1rem',
              fontWeight: 800,
              transition: 'all 0.15s ease'
            }}
            title="Close"
          >
            ✕
          </button>
        </div>

        {/* Filter Controls Toolbar */}
        <div
          style={{
            padding: '12px 20px',
            background: '#fffbeb',
            borderBottom: '1.5px solid #fde68a',
            display: 'flex',
            alignItems: 'center',
            gap: '14px',
            flexWrap: 'wrap'
          }}
        >
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#92400e' }}>Date:</span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="form-input form-input-sm"
              style={{ width: '150px', height: '34px', fontSize: '0.82rem', fontWeight: 700 }}
            />
          </div>

          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#92400e' }}>Shift:</span>
            <select
              value={shift}
              onChange={(e) => setShift(e.target.value)}
              className="form-input form-input-sm"
              style={{ height: '34px', fontSize: '0.82rem', fontWeight: 650, borderRadius: '8px', width: '220px' }}
            >
              <option value="7am-7pm">7:00 AM - 7:00 PM</option>
              <option value="7pm-7am">7:00 PM - 7:00 AM</option>
              <option value="7am-3pm">7:00 AM - 3:00 PM</option>
              <option value="3pm-11pm">3:00 PM - 11:00 PM</option>
              <option value="11pm-7am">11:00 PM - 7:00 AM</option>
            </select>
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
              <p style={{ fontWeight: 600 }}>Calculating F&B shift cash collections...</p>
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
                      HOTEL CITY PAARK
                    </h4>
                    <p style={{ margin: 0, fontSize: '0.72rem', color: '#475569', fontWeight: 600 }}>
                      119, Murarji Peth, Char Hutatma Chowk, Solapur - 413 001.
                    </p>
                  </div>
                  <div style={{ textAlign: 'right', fontSize: '0.76rem', fontWeight: 700, color: '#1e293b', lineHeight: 1.35 }}>
                    <div>SHIFT: <span style={{ color: '#d97706' }}>{handoverData.shift}</span></div>
                    <div>DATE: <span>{new Date(date).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' })}</span></div>
                    <div style={{ whiteSpace: 'nowrap' }}>STAFF: <span style={{ textTransform: 'uppercase', color: '#b45309', fontWeight: 900 }}>{staffName}</span></div>
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
                    {/* A. F&B */}
                    <tr style={{ background: '#fdfdfe' }}>
                      <td style={{ padding: '6px 12px', fontWeight: 800, borderRight: '1px solid #cbd5e1', color: '#0f172a' }}>
                        A. F&B
                      </td>
                      <td style={{ padding: '6px 12px', borderRight: '1.5px solid #0f172a' }}></td>
                      <td style={{ padding: '6px 12px', fontWeight: 800, borderRight: '1px solid #cbd5e1' }}>
                        Total Cash Receipts Rs.
                      </td>
                      <td style={{ padding: '6px 12px', textAlign: 'right', fontWeight: 850, color: '#0f172a' }}>
                        ₹ {toHandoverA.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                    <tr>
                      <td style={{ padding: '5px 12px', paddingLeft: '24px', borderRight: '1px solid #cbd5e1' }}>
                        1) F&B Cash Sales
                      </td>
                      <td style={{ padding: '5px 12px', textAlign: 'right', borderRight: '1.5px solid #0f172a', fontWeight: 700 }}>
                        ₹ {fnbCashSales.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
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
                        2) F&B Deposits
                      </td>
                      <td style={{ padding: '5px 12px', textAlign: 'right', borderRight: '1.5px solid #0f172a', fontWeight: 700 }}>
                        ₹ {fnbDeposits.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td style={{ padding: '6px 12px', fontWeight: 900, borderTop: '1.5px solid #0f172a', borderRight: '1px solid #cbd5e1', background: '#f0fdf4', color: '#166534' }}>
                        Net Handover to A/c.'s Rs.
                      </td>
                      <td style={{ padding: '6px 12px', textAlign: 'right', fontWeight: 950, borderTop: '1.5px solid #0f172a', background: '#f0fdf4', color: '#166534', fontSize: '0.95rem' }}>
                        ₹ {netHandover.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
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
                    {/* B. To Collect From Reception */}
                    <tr>
                      <td style={{ padding: '6px 12px', fontWeight: 800, borderRight: '1px solid #cbd5e1', color: '#2563eb' }}>
                        B. To Collect From Reception :-
                      </td>
                      <td style={{ padding: '6px 12px', borderRight: '1.5px solid #0f172a' }}></td>
                      <td style={{ padding: '6px 12px', borderRight: '1px solid #cbd5e1' }} colSpan={2}></td>
                    </tr>
                    <tr>
                      <td style={{ padding: '5px 12px', paddingLeft: '24px', borderRight: '1px solid #cbd5e1' }}>
                        Total F&B Cash from Reception
                      </td>
                      <td style={{ padding: '5px 12px', textAlign: 'right', borderRight: '1.5px solid #0f172a', fontWeight: 800, color: '#2563eb' }}>
                        ₹ {fbFromReception.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
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

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '16px', paddingTop: '10px', borderTop: '1px dashed #cbd5e1', fontSize: '0.78rem', fontWeight: 750, color: '#475569' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        Signature of Paying Cashier: <strong style={{ color: '#0f172a', textTransform: 'uppercase' }}>[{staffName}]</strong> _____________________
                      </div>
                      <div>
                        Sign of Receiving Cashier: _____________________
                      </div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
                      <div>
                        Sign of Accountant: _____________________
                      </div>
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
                  {showBreakdown ? '▲ Hide Cash Order Details' : '▼ View Detailed Cash Orders'}
                </button>
              </div>

              {showBreakdown && handoverData.breakdowns && (
                <div style={{ marginTop: '10px', padding: '12px', background: '#f8fafc', borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '0.78rem' }}>
                  <h5 style={{ margin: '0 0 6px', fontWeight: 800, color: '#1e293b' }}>
                    Restaurant Cash Orders ({handoverData.breakdowns.restCashOrders.length}):
                  </h5>
                  {handoverData.breakdowns.restCashOrders.length === 0 ? (
                    <p style={{ color: '#94a3b8', margin: '0 0 10px' }}>No direct restaurant cash orders in this shift.</p>
                  ) : (
                    <ul style={{ margin: '0 0 10px', paddingLeft: '18px' }}>
                      {handoverData.breakdowns.restCashOrders.map((o) => (
                        <li key={o.id}>
                          <strong>₹{(o.total).toLocaleString('en-IN')}</strong> — Order #{o.order_number || o.id} (Table: {o.table_number || 'Walk-in'}) · Mode: {o.payment_mode} · Time: {o.created_at}
                        </li>
                      ))}
                    </ul>
                  )}

                  <h5 style={{ margin: '6px 0', fontWeight: 800, color: '#1e293b' }}>
                    Bar Cash Orders ({handoverData.breakdowns.barCashOrders.length}):
                  </h5>
                  {handoverData.breakdowns.barCashOrders.length === 0 ? (
                    <p style={{ color: '#94a3b8', margin: '0 0 10px' }}>No direct bar cash orders in this shift.</p>
                  ) : (
                    <ul style={{ margin: '0 0 10px', paddingLeft: '18px' }}>
                      {handoverData.breakdowns.barCashOrders.map((o) => (
                        <li key={o.id}>
                          <strong>₹{(o.total).toLocaleString('en-IN')}</strong> — Order #{o.order_number || o.id} (Table: {o.table_number || 'Bar'}) · Mode: {o.payment_mode} · Time: {o.created_at}
                        </li>
                      ))}
                    </ul>
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
            Prints <strong>2 copies on 1 A4 sheet</strong> (F&B Copy + Accounts Copy).
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
                background: '#ea580c',
                borderColor: '#c2410c',
                color: '#fff',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                boxShadow: '0 4px 12px rgba(234, 88, 12, 0.25)'
              }}
            >
              <span>🖨️</span> Print F&B Statement (2 Copies A4)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
