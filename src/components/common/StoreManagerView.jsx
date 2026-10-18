import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';

export default function StoreManagerView() {
  const { showAlert, showToast } = useApp();
  const [subTab, setSubTab] = useState('live'); // 'live' | 'history'
  const [viewMode, setViewMode] = useState('party'); // 'party' | 'bill'
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [bills, setBills] = useState([]);
  const [partySummary, setPartySummary] = useState([]);
  const [paymentsHistory, setPaymentsHistory] = useState([]);

  // Payment modal state
  const [payModal, setPayModal] = useState({
    open: false,
    bill: null,
    vendor: null,
    amount: '',
    mode: 'upi',
    refNo: '',
    submitting: false
  });

  const loadData = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/store/bills?status=${subTab}`);
      const data = await res.json();
      if (data.success) {
        setBills(data.bills || []);
        setPartySummary(data.partySummary || []);
        setPaymentsHistory(data.paymentsHistory || []);
      }
    } catch (e) {
      console.error('Failed to load store bills:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [subTab]);

  const totalPendingPayable = partySummary.reduce(
    (sum, p) => sum + (Number(p.total_pending) || 0),
    0
  );

  const filteredParties = partySummary.filter(p =>
    p.vendor_name?.toLowerCase().includes(search.toLowerCase()) ||
    p.vendor_mobile?.includes(search)
  );

  const filteredBills = bills.filter(b =>
    b.vendor_name?.toLowerCase().includes(search.toLowerCase()) ||
    b.bill_number?.toLowerCase().includes(search.toLowerCase()) ||
    (b.items || []).some(it => it.item_name?.toLowerCase().includes(search.toLowerCase()))
  );

  const openPayForBill = (bill) => {
    setPayModal({
      open: true,
      bill,
      vendor: { id: bill.vendor_id, name: bill.vendor_name },
      amount: String(bill.pending_amount || 0),
      mode: 'upi',
      refNo: '',
      submitting: false
    });
  };

  const openPayForVendor = (vendor) => {
    setPayModal({
      open: true,
      bill: null,
      vendor,
      amount: String(vendor.total_pending || 0),
      mode: 'upi',
      refNo: '',
      submitting: false
    });
  };

  const handleExecutePayment = async () => {
    const amt = parseFloat(payModal.amount);
    if (isNaN(amt) || amt <= 0) {
      showAlert('Please enter a valid payment amount.', 'Invalid Amount');
      return;
    }

    setPayModal(prev => ({ ...prev, submitting: true }));
    try {
      const res = await fetch('/api/store/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bill_id: payModal.bill?.id,
          vendor_id: payModal.vendor?.id || payModal.vendor?.vendor_id,
          payment_amount: amt,
          payment_mode: payModal.mode,
          reference_no: payModal.refNo,
          paid_by: 'Admin (Jaijeet sir)'
        })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Payment failed');

      showToast(`Payment of ₹${amt.toLocaleString('en-IN')} recorded successfully! ✓`, 'success', 4000);
      setPayModal({ open: false, bill: null, vendor: null, amount: '', mode: 'upi', refNo: '', submitting: false });
      loadData();
    } catch (e) {
      showAlert('Error: ' + e.message, 'Payment Error');
      setPayModal(prev => ({ ...prev, submitting: false }));
    }
  };

  return (
    <div style={{ padding: '4px', color: '#1e293b' }}>
      {/* Top Banner Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px', marginBottom: '20px' }}>
        <div style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)', color: '#fff', padding: '18px', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}>
          <div style={{ fontSize: '12px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94a3b8' }}>
            Total Store Payables Due
          </div>
          <div style={{ fontSize: '30px', fontWeight: '800', marginTop: '6px', color: '#f87171' }}>
            ₹{totalPendingPayable.toLocaleString('en-IN')}
          </div>
          <div style={{ fontSize: '12px', color: '#cbd5e1', marginTop: '4px' }}>
            Pending payment to raw material vendors
          </div>
        </div>

        <div style={{ background: '#fff', border: '1px solid #e2e8f0', padding: '18px', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <div style={{ fontSize: '12px', fontWeight: '700', textTransform: 'uppercase', color: '#64748b' }}>
            Active Raw Material Vendors
          </div>
          <div style={{ fontSize: '30px', fontWeight: '800', marginTop: '6px', color: '#0f172a' }}>
            {partySummary.length}
          </div>
          <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
            Supplying Rice, Milk, Meal, Oil & Supplies
          </div>
        </div>

        <div style={{ background: '#fff', border: '1px solid #e2e8f0', padding: '18px', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <div style={{ fontSize: '12px', fontWeight: '700', textTransform: 'uppercase', color: '#64748b' }}>
            Isolated Store Accounting
          </div>
          <div style={{ fontSize: '16px', fontWeight: '700', marginTop: '10px', color: '#16a34a' }}>
            🛡️ 100% Zero Hotel Folio Impact
          </div>
          <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
            Keeps front desk cash drawers & room bills untouched
          </div>
        </div>
      </div>

      {/* Sub-navigation Controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', background: '#fff', padding: '12px 16px', borderRadius: '10px', border: '1px solid #e2e8f0', marginBottom: '16px' }}>
        {/* Live vs History Tabs */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            onClick={() => setSubTab('live')}
            style={{
              padding: '8px 18px',
              borderRadius: '8px',
              fontWeight: '700',
              fontSize: '14px',
              cursor: 'pointer',
              border: 'none',
              background: subTab === 'live' ? '#0f172a' : '#f1f5f9',
              color: subTab === 'live' ? '#fff' : '#475569',
              transition: 'all 0.2s'
            }}
          >
            🔴 Live Pending ({partySummary.length})
          </button>

          <button
            type="button"
            onClick={() => setSubTab('history')}
            style={{
              padding: '8px 18px',
              borderRadius: '8px',
              fontWeight: '700',
              fontSize: '14px',
              cursor: 'pointer',
              border: 'none',
              background: subTab === 'history' ? '#0f172a' : '#f1f5f9',
              color: subTab === 'history' ? '#fff' : '#475569',
              transition: 'all 0.2s'
            }}
          >
            📜 History ({subTab === 'history' ? bills.length : 'All Cleared'})
          </button>
        </div>

        {/* In Live Tab: Toggle Party-wise vs Bill-wise */}
        {subTab === 'live' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#f8fafc', padding: '4px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
            <button
              type="button"
              onClick={() => setViewMode('party')}
              style={{
                padding: '6px 14px',
                borderRadius: '6px',
                fontWeight: '600',
                fontSize: '13px',
                cursor: 'pointer',
                border: 'none',
                background: viewMode === 'party' ? '#fff' : 'transparent',
                color: viewMode === 'party' ? '#0f172a' : '#64748b',
                boxShadow: viewMode === 'party' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
              }}
            >
              👥 Party-wise Summary
            </button>
            <button
              type="button"
              onClick={() => setViewMode('bill')}
              style={{
                padding: '6px 14px',
                borderRadius: '6px',
                fontWeight: '600',
                fontSize: '13px',
                cursor: 'pointer',
                border: 'none',
                background: viewMode === 'bill' ? '#fff' : 'transparent',
                color: viewMode === 'bill' ? '#0f172a' : '#64748b',
                boxShadow: viewMode === 'bill' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
              }}
            >
              🧾 Bill-wise Feed
            </button>
          </div>
        )}

        {/* Search */}
        <div style={{ position: 'relative', minWidth: '260px' }}>
          <input
            type="text"
            placeholder="Search vendor, bill #, rice, milk..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 12px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              fontSize: '14px',
              outline: 'none'
            }}
          />
        </div>
      </div>

      {/* Main Content Area */}
      {loading ? (
        <div style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>
          Loading Store records...
        </div>
      ) : subTab === 'live' && viewMode === 'party' ? (
        /* PARTY-WISE VIEW */
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: '16px' }}>
          {filteredParties.length === 0 ? (
            <div style={{ gridColumn: '1 / -1', background: '#fff', padding: '40px', borderRadius: '12px', textAlign: 'center', color: '#64748b', border: '1px solid #e2e8f0' }}>
              🎉 All vendor bills are fully settled! No pending payables.
            </div>
          ) : (
            filteredParties.map((p) => (
              <div
                key={`p-${p.vendor_id}`}
                style={{
                  background: '#fff',
                  border: '1px solid #e2e8f0',
                  borderRadius: '12px',
                  padding: '16px',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between'
                }}
              >
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontSize: '18px', fontWeight: '800', color: '#0f172a' }}>{p.vendor_name}</div>
                      <div style={{ fontSize: '13px', color: '#64748b', marginTop: '2px' }}>📞 {p.vendor_mobile}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '11px', fontWeight: '700', color: '#ef4444', textTransform: 'uppercase' }}>Pending Due</div>
                      <div style={{ fontSize: '22px', fontWeight: '800', color: '#ef4444' }}>₹{Number(p.total_pending).toLocaleString('en-IN')}</div>
                    </div>
                  </div>

                  <div style={{ marginTop: '12px', background: '#f8fafc', padding: '10px', borderRadius: '8px', border: '1px solid #edf2f7' }}>
                    <div style={{ fontSize: '12px', fontWeight: '700', color: '#475569', marginBottom: '6px' }}>
                      Recent Bills from Store Boy:
                    </div>
                    {(p.bills || []).map((b) => (
                      <div key={`b-${b.id}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: '1px dashed #e2e8f0', fontSize: '13px' }}>
                        <div>
                          <span style={{ fontWeight: '700' }}>#{b.bill_number}</span>
                          <span style={{ color: '#64748b', marginLeft: '6px' }}>
                            ({(b.items || []).map(it => `${it.item_name} ${it.quantity}${it.unit}`).join(', ') || 'Supplies'})
                          </span>
                        </div>
                        <div style={{ fontWeight: '700', color: '#b91c1c' }}>
                          ₹{Number(b.pending_amount).toLocaleString('en-IN')}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ marginTop: '16px', display: 'flex', gap: '8px' }}>
                  <button
                    type="button"
                    onClick={() => openPayForVendor(p)}
                    style={{
                      flex: 1,
                      padding: '10px',
                      background: '#0f172a',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '8px',
                      fontWeight: '700',
                      cursor: 'pointer',
                      fontSize: '13px'
                    }}
                  >
                    💳 Pay Vendor (₹{Number(p.total_pending).toLocaleString('en-IN')})
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      ) : subTab === 'live' && viewMode === 'bill' ? (
        /* BILL-WISE VIEW */
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: '16px' }}>
          {filteredBills.length === 0 ? (
            <div style={{ gridColumn: '1 / -1', background: '#fff', padding: '40px', borderRadius: '12px', textAlign: 'center', color: '#64748b', border: '1px solid #e2e8f0' }}>
              No pending bills found.
            </div>
          ) : (
            filteredBills.map((b) => (
              <div
                key={`bill-${b.id}`}
                style={{
                  background: '#fff',
                  border: '1px solid #e2e8f0',
                  borderRadius: '12px',
                  padding: '16px',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: '17px', fontWeight: '800', color: '#0f172a' }}>{b.vendor_name}</div>
                    <div style={{ fontSize: '13px', color: '#64748b' }}>Bill #{b.bill_number} • Added by {b.created_by}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{
                      padding: '2px 8px',
                      borderRadius: '4px',
                      fontSize: '11px',
                      fontWeight: '800',
                      background: b.status === 'PARTLY' ? '#fef3c7' : '#fee2e2',
                      color: b.status === 'PARTLY' ? '#d97706' : '#dc2626'
                    }}>
                      {b.status === 'PARTLY' ? 'PARTLY PAID' : 'PENDING'}
                    </span>
                    <div style={{ fontSize: '20px', fontWeight: '800', color: '#ef4444', marginTop: '4px' }}>
                      ₹{Number(b.pending_amount).toLocaleString('en-IN')}
                    </div>
                  </div>
                </div>

                {/* Items */}
                <div style={{ marginTop: '12px', background: '#f8fafc', padding: '10px', borderRadius: '8px', border: '1px solid #edf2f7' }}>
                  <div style={{ fontSize: '11px', fontWeight: '700', color: '#64748b', textTransform: 'uppercase', marginBottom: '4px' }}>Items Received:</div>
                  {(b.items || []).map((it, idx) => (
                    <div key={`it-${idx}`} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', padding: '3px 0' }}>
                      <span>• {it.item_name} ({it.quantity} {it.unit})</span>
                      <span style={{ fontWeight: '700' }}>₹{Number(it.total_price).toLocaleString('en-IN')}</span>
                    </div>
                  ))}
                </div>

                <div style={{ marginTop: '14px' }}>
                  <button
                    type="button"
                    onClick={() => openPayForBill(b)}
                    style={{
                      width: '100%',
                      padding: '10px',
                      background: '#0f172a',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '8px',
                      fontWeight: '700',
                      cursor: 'pointer',
                      fontSize: '13px'
                    }}
                  >
                    💳 Settle Bill (₹{Number(b.pending_amount).toLocaleString('en-IN')})
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        /* HISTORY TAB */
        <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
          <div style={{ padding: '16px', borderBottom: '1px solid #e2e8f0', fontWeight: '800', fontSize: '16px' }}>
            📜 Cleared Store Bills & Audit Trail
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#64748b', fontSize: '12px', textTransform: 'uppercase' }}>
                <th style={{ padding: '12px 16px' }}>Bill # / Date</th>
                <th style={{ padding: '12px 16px' }}>Vendor (Party)</th>
                <th style={{ padding: '12px 16px' }}>Items Bought</th>
                <th style={{ padding: '12px 16px' }}>Bill Amount</th>
                <th style={{ padding: '12px 16px' }}>Status</th>
                <th style={{ padding: '12px 16px' }}>Audit Log</th>
              </tr>
            </thead>
            <tbody>
              {filteredBills.length === 0 ? (
                <tr>
                  <td colSpan="6" style={{ padding: '30px', textAlign: 'center', color: '#64748b' }}>
                    No settled bills recorded in history yet.
                  </td>
                </tr>
              ) : (
                filteredBills.map((b) => (
                  <tr key={`h-${b.id}`} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '12px 16px', fontWeight: '700' }}>
                      #{b.bill_number}
                      <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 'normal' }}>{b.bill_date}</div>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ fontWeight: '700' }}>{b.vendor_name}</span>
                      <div style={{ fontSize: '12px', color: '#64748b' }}>{b.vendor_mobile}</div>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      {(b.items || []).map(it => `${it.item_name} (${it.quantity}${it.unit})`).join(', ')}
                    </td>
                    <td style={{ padding: '12px 16px', fontWeight: '800', color: '#16a34a' }}>
                      ₹{Number(b.total_amount).toLocaleString('en-IN')}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ background: '#dcfce7', color: '#15803d', padding: '4px 10px', borderRadius: '4px', fontWeight: '800', fontSize: '12px' }}>
                        🟢 FULL PAID
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: '12px', color: '#475569' }}>
                      {(b.payments || []).map((pm, pidx) => (
                        <div key={`pmlog-${pidx}`}>
                          ✓ ₹{Number(pm.payment_amount).toLocaleString('en-IN')} ({pm.payment_mode}) by {pm.paid_by}
                        </div>
                      ))}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* MAKE PAYMENT MODAL */}
      {payModal.open && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999
        }}>
          <div style={{
            background: '#fff',
            borderRadius: '14px',
            padding: '24px',
            width: '100%',
            maxWidth: '460px',
            boxShadow: '0 20px 25px -5px rgba(0,0,0,0.2)'
          }}>
            <h3 style={{ margin: '0 0 6px 0', fontSize: '20px', fontWeight: '800', color: '#0f172a' }}>
              Settle Vendor Payment
            </h3>
            <div style={{ fontSize: '14px', color: '#64748b', marginBottom: '16px' }}>
              Party: <strong style={{ color: '#0f172a' }}>{payModal.vendor?.name || payModal.vendor?.vendor_name}</strong>
              {payModal.bill && ` • Bill #${payModal.bill.bill_number}`}
            </div>

            <div style={{ marginBottom: '14px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: '700', color: '#334155', marginBottom: '6px' }}>
                Payment Amount (₹)
              </label>
              <input
                type="number"
                value={payModal.amount}
                onChange={(e) => setPayModal(prev => ({ ...prev, amount: e.target.value }))}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  fontSize: '16px',
                  fontWeight: '700',
                  boxSizing: 'border-box'
                }}
              />
            </div>

            <div style={{ marginBottom: '14px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: '700', color: '#334155', marginBottom: '6px' }}>
                Payment Mode
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                {['upi', 'cash', 'bank_transfer', 'cheque'].map(m => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setPayModal(prev => ({ ...prev, mode: m }))}
                    style={{
                      flex: 1,
                      padding: '8px',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                      cursor: 'pointer',
                      fontSize: '12px',
                      fontWeight: '700',
                      background: payModal.mode === m ? '#0f172a' : '#fff',
                      color: payModal.mode === m ? '#fff' : '#475569'
                    }}
                  >
                    {m === 'bank_transfer' ? 'Bank' : m.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: '700', color: '#334155', marginBottom: '6px' }}>
                Reference / UTR / Cheque # (Optional)
              </label>
              <input
                type="text"
                placeholder="e.g. UPI Ref, Cheque No"
                value={payModal.refNo}
                onChange={(e) => setPayModal(prev => ({ ...prev, refNo: e.target.value }))}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  fontSize: '14px',
                  boxSizing: 'border-box'
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                type="button"
                onClick={() => setPayModal(prev => ({ ...prev, open: false }))}
                style={{
                  flex: 1,
                  padding: '12px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  background: '#fff',
                  fontWeight: '700',
                  color: '#64748b',
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={payModal.submitting}
                onClick={handleExecutePayment}
                style={{
                  flex: 2,
                  padding: '12px',
                  borderRadius: '8px',
                  border: 'none',
                  background: '#16a34a',
                  fontWeight: '800',
                  color: '#fff',
                  cursor: 'pointer',
                  fontSize: '15px'
                }}
              >
                {payModal.submitting ? 'Recording...' : 'Confirm Payment'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
