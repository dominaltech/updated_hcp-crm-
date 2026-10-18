import React, { useState } from 'react';
import { api } from '../api/client';

export default function MyOrdersView({
  department,
  currentUser,
  tables = [],
  recentOrders = [],
  onSelectDestinationForMore,
  onRefresh,
  isLoading
}) {
  const [actionInProgress, setActionInProgress] = useState(null);
  const [msg, setMsg] = useState('');
  const [settleModalTable, setSettleModalTable] = useState(null);
  const [paymentMode, setPaymentMode] = useState('cash');

  const isBar = department === 'bar';
  const myName = currentUser?.full_name || currentUser?.username || 'Waiter';
  const myId = currentUser?.id;

  // Filter active tables attended by this specific waiter
  const myActiveTables = tables.filter(t => {
    const isAttendedByMe = (
      (t.waiter_name && (t.waiter_name.toLowerCase() === myName.toLowerCase() || t.waiter_name.toLowerCase() === currentUser?.username?.toLowerCase())) ||
      (t.waiter_id && t.waiter_id === myId)
    );
    const hasActiveOrder = (t.status !== 'available' && t.status !== '') || (t.cart && t.cart.length > 0);
    return isAttendedByMe && hasActiveOrder;
  });

  // Filter recent orders placed by this waiter
  const myRecentOrders = recentOrders.filter(o => {
    if (!o) return false;
    const waiterMatches = (
      (o.waiter_name && (o.waiter_name.toLowerCase() === myName.toLowerCase() || o.waiter_name.toLowerCase() === currentUser?.username?.toLowerCase())) ||
      (o.waiter_id && o.waiter_id === myId) ||
      (o.notes && o.notes.toLowerCase().includes(myName.toLowerCase()))
    );
    return waiterMatches;
  });

  const handlePrintPrebill = async (table) => {
    try {
      setActionInProgress(`print-${table.id}`);
      await api.requestBillPrint(department, table.id);
      setMsg(`🧾 Bill printed for ${table.table_number || table.name}!`);
      setTimeout(() => setMsg(''), 4000);
      onRefresh();
    } catch (err) {
      setMsg(`❌ Print failed: ${err.message}`);
      setTimeout(() => setMsg(''), 5000);
    } finally {
      setActionInProgress(null);
    }
  };

  const handleSettle = async () => {
    if (!settleModalTable) return;
    try {
      setActionInProgress(`settle-${settleModalTable.id}`);
      await api.settleTable(department, settleModalTable.id, {
        payment_method: paymentMode,
        waiter_name: myName
      });
      setMsg(`✅ Table ${settleModalTable.table_number || settleModalTable.name} settled successfully!`);
      setSettleModalTable(null);
      setTimeout(() => setMsg(''), 4000);
      onRefresh();
    } catch (err) {
      setMsg(`❌ Settlement failed: ${err.message}`);
      setTimeout(() => setMsg(''), 5000);
    } finally {
      setActionInProgress(null);
    }
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '12px', background: 'var(--bg-app)' }}>
      {/* Top Banner */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <div>
          <h2 style={{ fontSize: '1.05rem', fontWeight: 900, color: 'var(--text-primary)', margin: 0 }}>
            📋 My Active Orders
          </h2>
          <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', margin: '1px 0 0' }}>
            Attended by: <strong style={{ color: 'var(--apple-blue)' }}>{myName}</strong>
          </p>
        </div>

        <button
          type="button"
          onClick={onRefresh}
          disabled={isLoading}
          style={{
            padding: '5px 10px',
            borderRadius: 'var(--radius-xs)',
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-medium)',
            color: 'var(--text-primary)',
            fontSize: '0.74rem',
            fontWeight: 800,
            display: 'flex',
            alignItems: 'center',
            gap: '3px',
            boxShadow: 'var(--shadow-subtle)'
          }}
        >
          <span>🔄</span>
          <span>Refresh</span>
        </button>
      </div>

      {msg && (
        <div style={{
          padding: '8px 12px',
          borderRadius: 'var(--radius-xs)',
          background: 'var(--apple-green-subtle)',
          border: '1px solid var(--apple-green)',
          color: 'var(--apple-green)',
          fontSize: '0.78rem',
          fontWeight: 800,
          marginBottom: '10px'
        }}>
          {msg}
        </div>
      )}

      {/* Orders List Container */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', paddingBottom: '80px' }}>
        {myActiveTables.length === 0 && myRecentOrders.length === 0 ? (
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            padding: '36px 16px',
            color: 'var(--text-tertiary)',
            background: 'var(--bg-surface)',
            borderRadius: 'var(--radius-md)',
            border: '1px dashed var(--border-medium)'
          }}>
            <span style={{ fontSize: '2.4rem', marginBottom: '8px' }}>🍽️</span>
            <div style={{ fontSize: '0.98rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '4px' }}>
              No Active Tables Attended by You
            </div>
            <p style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', maxWidth: '280px', margin: 0 }}>
              Select a vacant table, room service, or parcel from the tabs above to punch your first KOT!
            </p>
          </div>
        ) : (
          <>
            {myActiveTables.length > 0 && (
              <div>
                <div style={{ fontSize: '0.74rem', fontWeight: 900, textTransform: 'uppercase', color: 'var(--text-secondary)', letterSpacing: '0.04em', marginBottom: '6px' }}>
                  🟢 Active Attending Tables ({myActiveTables.length})
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {myActiveTables.map((t) => {
                    const items = t.cart || [];
                    const subtotal = t.cart_total || items.reduce((s, it) => s + (it.price * (it.qty || it.quantity || 1)), 0);
                    const gst = Math.round((subtotal * 5) / 100);
                    const grand = Math.round(subtotal + gst);
                    const isBilled = t.status === 'billed';

                    return (
                      <div
                        key={t.id}
                        style={{
                          background: 'var(--bg-surface)',
                          border: isBilled ? '1.5px solid var(--apple-red)' : '1.5px solid var(--border-medium)',
                          borderRadius: 'var(--radius-md)',
                          padding: '12px 14px',
                          boxShadow: 'var(--shadow-subtle)'
                        }}
                      >
                        {/* Table Header */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontSize: '1.4rem' }}>{isBar ? '🍸' : '🍽️'}</span>
                            <div>
                              <div style={{ fontSize: '1rem', fontWeight: 900, color: 'var(--text-primary)' }}>
                                {t.table_number || `Table ${t.id}`}
                              </div>
                              <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)' }}>
                                Token #{t.token_number || 1} • KOT #{t.kot_count || t.bot_count || 1}
                              </div>
                            </div>
                          </div>

                          <div style={{ textAlign: 'right' }}>
                            <span
                              style={{
                                display: 'inline-block',
                                fontSize: '0.65rem',
                                fontWeight: 850,
                                padding: '2px 6px',
                                borderRadius: 'var(--radius-xs)',
                                background: isBilled ? 'var(--apple-red-subtle)' : 'var(--apple-green-subtle)',
                                color: isBilled ? 'var(--apple-red)' : 'var(--apple-green)',
                                border: isBilled ? '1px solid var(--apple-red)' : '1px solid var(--apple-green)',
                                textTransform: 'uppercase'
                              }}
                            >
                              {isBilled ? '🧾 Billed' : '🟢 Running'}
                            </span>
                            <div style={{ fontSize: '1.05rem', fontWeight: 900, color: 'var(--apple-blue)', marginTop: '2px' }}>
                              ₹{grand.toLocaleString('en-IN')}
                            </div>
                          </div>
                        </div>

                        {/* Items Breakdown */}
                        <div style={{
                          background: 'var(--bg-surface-secondary)',
                          borderRadius: 'var(--radius-xs)',
                          padding: '6px 10px',
                          marginBottom: '10px'
                        }}>
                          {items.length === 0 ? (
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>No items recorded</div>
                          ) : (
                            items.map((it, idx) => (
                              <div key={idx} style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                fontSize: '0.76rem',
                                color: 'var(--text-primary)',
                                padding: '2px 0',
                                borderBottom: idx < items.length - 1 ? '1px solid var(--border-light)' : 'none'
                              }}>
                                <span>
                                  <strong>{it.qty || it.quantity || 1}x</strong> {it.name}
                                </span>
                                <span style={{ color: 'var(--text-secondary)', fontWeight: 700 }}>
                                  ₹{((it.price || 0) * (it.qty || it.quantity || 1)).toLocaleString('en-IN')}
                                </span>
                              </div>
                            ))
                          )}
                        </div>

                        {/* Actions for this table */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px' }}>
                          <button
                            type="button"
                            onClick={() => onSelectDestinationForMore({
                              type: 'table',
                              id: t.id,
                              label: t.table_number || `Table ${t.id}`,
                              rawTable: t
                            })}
                            style={{
                              padding: '7px 4px',
                              borderRadius: 'var(--radius-xs)',
                              background: isBar ? 'var(--apple-purple-subtle)' : 'var(--apple-orange-subtle)',
                              border: isBar ? '1px solid var(--apple-purple)' : '1px solid var(--apple-orange)',
                              color: isBar ? 'var(--apple-purple)' : 'var(--apple-orange)',
                              fontSize: '0.74rem',
                              fontWeight: 800,
                              cursor: 'pointer'
                            }}
                          >
                            + Add Dishes
                          </button>

                          <button
                            type="button"
                            disabled={actionInProgress === `print-${t.id}`}
                            onClick={() => handlePrintPrebill(t)}
                            style={{
                              padding: '7px 4px',
                              borderRadius: 'var(--radius-xs)',
                              background: 'var(--bg-surface-secondary)',
                              border: '1px solid var(--apple-blue)',
                              color: 'var(--apple-blue)',
                              fontSize: '0.74rem',
                              fontWeight: 800,
                              cursor: 'pointer'
                            }}
                          >
                            {actionInProgress === `print-${t.id}` ? 'Printing...' : '🧾 Print Bill'}
                          </button>

                          <button
                            type="button"
                            onClick={() => setSettleModalTable(t)}
                            style={{
                              padding: '7px 4px',
                              borderRadius: 'var(--radius-xs)',
                              background: 'var(--apple-green-subtle)',
                              border: '1px solid var(--apple-green)',
                              color: 'var(--apple-green)',
                              fontSize: '0.74rem',
                              fontWeight: 800,
                              cursor: 'pointer'
                            }}
                          >
                            💵 Settle
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Section 2: Recent Orders History */}
            {myRecentOrders.length > 0 && (
              <div style={{ marginTop: '6px' }}>
                <div style={{ fontSize: '0.74rem', fontWeight: 900, textTransform: 'uppercase', color: 'var(--text-secondary)', letterSpacing: '0.04em', marginBottom: '6px' }}>
                  📜 Recent Orders Punched by You ({myRecentOrders.length})
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {myRecentOrders.slice(0, 10).map((o) => (
                    <div
                      key={o.id}
                      style={{
                        padding: '10px 12px',
                        background: 'var(--bg-surface)',
                        border: '1px solid var(--border-medium)',
                        borderRadius: 'var(--radius-sm)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        boxShadow: 'var(--shadow-subtle)'
                      }}
                    >
                      <div>
                        <div style={{ fontSize: '0.86rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                          {o.table_number || o.room_number || o.customer_name || `Order #${o.id}`}
                        </div>
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)' }}>
                          {o.created_at || 'Just now'} • {o.payment_method || 'Settled'}
                        </div>
                      </div>
                      <div style={{ fontSize: '0.94rem', fontWeight: 900, color: 'var(--apple-blue)' }}>
                        ₹{Number(o.total || o.grand_total || 0).toLocaleString('en-IN')}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Quick Settlement Modal */}
      {settleModalTable && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.45)',
            backdropFilter: 'blur(6px)',
            zIndex: 10000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px'
          }}
          onClick={() => setSettleModalTable(null)}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '360px',
              background: 'var(--bg-surface)',
              borderRadius: 'var(--radius-lg)',
              padding: '20px',
              border: '1.5px solid var(--border-medium)',
              boxShadow: 'var(--shadow-modal)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ fontSize: '1.10rem', fontWeight: 900, color: 'var(--text-primary)', margin: '0 0 4px' }}>
              💵 Settle Table {settleModalTable.table_number || settleModalTable.name}
            </h3>
            <p style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', margin: '0 0 14px' }}>
              Select payment mode received from guest:
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '18px' }}>
              {[
                { id: 'cash', label: '💵 Cash' },
                { id: 'upi', label: '📱 UPI / QR' },
                { id: 'card', label: '💳 Card' },
                { id: 'room_folio', label: '🛏️ Room Folio' }
              ].map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setPaymentMode(m.id)}
                  style={{
                    padding: '10px 8px',
                    borderRadius: 'var(--radius-sm)',
                    background: paymentMode === m.id ? 'var(--apple-blue-subtle)' : 'var(--bg-surface-secondary)',
                    border: paymentMode === m.id ? '1.5px solid var(--apple-blue)' : '1px solid var(--border-medium)',
                    color: paymentMode === m.id ? 'var(--apple-blue)' : 'var(--text-secondary)',
                    fontSize: '0.80rem',
                    fontWeight: 800,
                    cursor: 'pointer'
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                onClick={() => setSettleModalTable(null)}
                style={{
                  flex: 1,
                  height: '40px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--bg-surface-secondary)',
                  border: '1px solid var(--border-medium)',
                  color: 'var(--text-secondary)',
                  fontWeight: 800
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={actionInProgress?.startsWith('settle-')}
                onClick={handleSettle}
                style={{
                  flex: 2,
                  height: '40px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--apple-green)',
                  color: 'var(--text-on-accent)',
                  fontWeight: 900,
                  boxShadow: 'var(--shadow-subtle)'
                }}
              >
                {actionInProgress?.startsWith('settle-') ? 'Settling...' : 'Confirm Settle'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
