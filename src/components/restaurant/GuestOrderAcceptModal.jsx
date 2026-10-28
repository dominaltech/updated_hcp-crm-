import React, { useEffect } from 'react';
import { stopContinuousOrderAlert } from '../../utils/audioAlert';

export default function GuestOrderAcceptModal({ order, onAccept, onCancel, onClose, isAccepting = false, isCancelling = false }) {
  // Ensure audio is stopped if modal is unmounted
  useEffect(() => {
    return () => {
      stopContinuousOrderAlert();
    };
  }, []);

  if (!order) return null;

  const previousItems = Array.isArray(order.previous_items) ? order.previous_items : [];
  const newItems = Array.isArray(order.new_items) ? order.new_items : (Array.isArray(order.items) ? order.items : []);
  const hasIncremental = previousItems.length > 0;

  // Calculate totals for new batch
  const newSubtotal = Number(order.subtotal || newItems.reduce((acc, it) => acc + (Number(it.price || 0) * Number(it.quantity || it.qty || 1)), 0));
  const newTax = Number(order.tax || Math.round(newSubtotal * 0.05 * 100) / 100);
  const newGrandTotal = Number(order.grand_total || (newSubtotal + newTax));

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.75)',
        backdropFilter: 'blur(5px)',
        zIndex: 99999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        animation: 'fadeIn 0.2s ease-out'
      }}
      role="dialog"
      aria-modal="true"
    >
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '16px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.35), 0 0 0 2px #f59e0b',
          width: '100%',
          maxWidth: '680px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          border: '1px solid #fef3c7'
        }}
      >
        {/* Animated Alert Header */}
        <div
          style={{
            background: 'linear-gradient(135deg, #b45309 0%, #d97706 50%, #f59e0b 100%)',
            color: '#ffffff',
            padding: '16px 20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span
              style={{
                fontSize: '28px',
                display: 'inline-block',
                animation: 'pulse 1s infinite alternate'
              }}
            >
              🛎️
            </span>
            <div>
              <div style={{ fontSize: '1.25rem', fontWeight: 900, letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: '8px' }}>
                New In-Room Food Order!
                <span
                  style={{
                    backgroundColor: '#ffffff',
                    color: '#b45309',
                    fontSize: '0.72rem',
                    fontWeight: 900,
                    padding: '2px 8px',
                    borderRadius: '12px',
                    textTransform: 'uppercase'
                  }}
                >
                  Batch #{order.batch_number || 1}
                </span>
              </div>
              <div style={{ fontSize: '0.82rem', opacity: 0.95, fontWeight: 500 }}>
                Beep alarm ringing until accepted • Kitchen POS Alert
              </div>
            </div>
          </div>
          <button
            onClick={() => {
              stopContinuousOrderAlert();
              onClose();
            }}
            style={{
              background: 'rgba(255,255,255,0.2)',
              border: 'none',
              color: '#ffffff',
              fontSize: '18px',
              fontWeight: 900,
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            title="Silence alarm & close"
          >
            ✕
          </button>
        </div>

        {/* Guest & Room Details Card */}
        <div
          style={{
            backgroundColor: '#fefce8',
            borderBottom: '1px solid #fef08a',
            padding: '14px 20px',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
            gap: '12px'
          }}
        >
          <div>
            <span style={{ fontSize: '0.72rem', color: '#854d0e', textTransform: 'uppercase', fontWeight: 800, display: 'block' }}>
              🚪 Room Number(s)
            </span>
            <span style={{ fontSize: '1.15rem', fontWeight: 950, color: '#713f12' }}>
              Room {order.room_numbers || 'N/A'}
            </span>
          </div>

          <div>
            <span style={{ fontSize: '0.72rem', color: '#854d0e', textTransform: 'uppercase', fontWeight: 800, display: 'block' }}>
              👤 Guest Name
            </span>
            <span style={{ fontSize: '0.95rem', fontWeight: 850, color: '#0f172a' }}>
              {order.guest_name || 'Valued Guest'}
            </span>
          </div>

          <div>
            <span style={{ fontSize: '0.72rem', color: '#854d0e', textTransform: 'uppercase', fontWeight: 800, display: 'block' }}>
              📱 Phone Number
            </span>
            <span style={{ fontSize: '0.95rem', fontWeight: 850, color: '#0f172a' }}>
              {order.guest_phone || 'N/A'}
            </span>
          </div>

          <div>
            <span style={{ fontSize: '0.72rem', color: '#854d0e', textTransform: 'uppercase', fontWeight: 800, display: 'block' }}>
              ⏰ Order Time
            </span>
            <span style={{ fontSize: '0.85rem', fontWeight: 750, color: '#475569' }}>
              {order.created_at ? new Date(order.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Just Now'}
            </span>
          </div>
        </div>

        {/* Special Cooking Notes if any */}
        {order.notes && (
          <div
            style={{
              backgroundColor: '#fffbeb',
              borderBottom: '1px solid #fef3c7',
              padding: '8px 20px',
              fontSize: '0.82rem',
              color: '#92400e',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <strong>📝 Guest Cooking Notes:</strong> {order.notes}
          </div>
        )}

        {/* Scrollable Order Items List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
          
          {/* 1. PREVIOUS ACCEPTED ORDERS IN GREY (if incremental order) */}
          {hasIncremental && (
            <div style={{ marginBottom: '20px' }}>
              <div
                style={{
                  fontSize: '0.75rem',
                  fontWeight: 900,
                  textTransform: 'uppercase',
                  color: '#64748b',
                  letterSpacing: '0.05em',
                  marginBottom: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  borderBottom: '1.5px solid #e2e8f0',
                  paddingBottom: '4px'
                }}
              >
                <span>📋</span> PREVIOUSLY ACCEPTED ITEMS (Already Sent to Kitchen)
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', color: '#94a3b8' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #f1f5f9', textAlign: 'left', fontSize: '0.72rem', color: '#94a3b8' }}>
                    <th style={{ padding: '6px 4px', width: '45%' }}>DISH</th>
                    <th style={{ padding: '6px 4px', textAlign: 'center', width: '15%' }}>QTY</th>
                    <th style={{ padding: '6px 4px', textAlign: 'right', width: '20%' }}>PRICE</th>
                    <th style={{ padding: '6px 4px', textAlign: 'right', width: '20%' }}>TOTAL</th>
                  </tr>
                </thead>
                <tbody>
                  {previousItems.map((it, idx) => (
                    <tr
                      key={`prev-${idx}`}
                      style={{
                        borderBottom: '1px dashed #e2e8f0',
                        fontSize: '0.85rem',
                        backgroundColor: '#f8fafc',
                        color: '#64748b'
                      }}
                    >
                      <td style={{ padding: '8px 4px' }}>
                        <span style={{ fontWeight: 600, color: '#64748b' }}>{it.name}</span>
                        {it.batch_number && (
                          <span style={{ fontSize: '0.68rem', marginLeft: '6px', color: '#94a3b8', fontStyle: 'italic' }}>
                            (Batch #{it.batch_number})
                          </span>
                        )}
                        <span style={{ fontSize: '0.68rem', marginLeft: '6px', backgroundColor: '#e2e8f0', color: '#475569', padding: '1px 5px', borderRadius: '4px' }}>
                          ✓ In Kitchen
                        </span>
                      </td>
                      <td style={{ padding: '8px 4px', textAlign: 'center', fontWeight: 700 }}>
                        {it.quantity || it.qty || 1}x
                      </td>
                      <td style={{ padding: '8px 4px', textAlign: 'right' }}>
                        ₹{Number(it.price || 0).toLocaleString('en-IN')}
                      </td>
                      <td style={{ padding: '8px 4px', textAlign: 'right', fontWeight: 700 }}>
                        ₹{(Number(it.price || 0) * Number(it.quantity || it.qty || 1)).toLocaleString('en-IN')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 2. NEW ITEMS IN VIBRANT COLOR */}
          <div>
            <div
              style={{
                fontSize: '0.8rem',
                fontWeight: 900,
                textTransform: 'uppercase',
                color: '#0f766e',
                letterSpacing: '0.05em',
                marginBottom: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                borderBottom: '2px solid #0d9488',
                paddingBottom: '4px'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span>⭐</span> NEW ITEMS AWAITING ACCEPTANCE & KOT PRINT
              </div>
              <span
                style={{
                  backgroundColor: '#ccfbf1',
                  color: '#0f766e',
                  fontSize: '0.72rem',
                  fontWeight: 900,
                  padding: '2px 8px',
                  borderRadius: '12px'
                }}
              >
                {newItems.length} New Item(s)
              </span>
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1.5px solid #cbd5e1', textAlign: 'left', fontSize: '0.74rem', color: '#475569', textTransform: 'uppercase' }}>
                  <th style={{ padding: '8px 4px', width: '45%' }}>DISH</th>
                  <th style={{ padding: '8px 4px', textAlign: 'center', width: '15%' }}>QTY</th>
                  <th style={{ padding: '8px 4px', textAlign: 'right', width: '20%' }}>PRICE</th>
                  <th style={{ padding: '8px 4px', textAlign: 'right', width: '20%' }}>TOTAL</th>
                </tr>
              </thead>
              <tbody>
                {newItems.map((it, idx) => {
                  const qty = Number(it.quantity || it.qty || 1);
                  const price = Number(it.price || 0);
                  const lineTotal = price * qty;
                  return (
                    <tr
                      key={`new-${idx}`}
                      style={{
                        borderBottom: '1px solid #e2e8f0',
                        fontSize: '0.92rem',
                        backgroundColor: '#ffffff'
                      }}
                    >
                      <td style={{ padding: '10px 4px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span
                            style={{
                              width: '9px',
                              height: '9px',
                              borderRadius: '50%',
                              backgroundColor: it.is_veg === 0 ? '#ef4444' : '#10b981',
                              display: 'inline-block',
                              flexShrink: 0
                            }}
                            title={it.is_veg === 0 ? 'Non-Veg' : 'Pure Veg'}
                          />
                          <span style={{ fontWeight: 800, color: '#0f172a' }}>{it.name}</span>
                        </div>
                        {it.notes && (
                          <div style={{ fontSize: '0.72rem', color: '#d97706', marginTop: '2px', paddingLeft: '15px' }}>
                            Note: {it.notes}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '10px 4px', textAlign: 'center' }}>
                        <span
                          style={{
                            backgroundColor: '#fee2e2',
                            color: '#991b1b',
                            padding: '3px 9px',
                            borderRadius: '12px',
                            fontWeight: 900,
                            fontSize: '0.88rem'
                          }}
                        >
                          {qty}x
                        </span>
                      </td>
                      <td style={{ padding: '10px 4px', textAlign: 'right', color: '#0f766e', fontWeight: 700 }}>
                        ₹{price.toLocaleString('en-IN')}
                      </td>
                      <td style={{ padding: '10px 4px', textAlign: 'right', fontWeight: 900, color: '#0f172a' }}>
                        ₹{lineTotal.toLocaleString('en-IN')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Bill Calculation & Summary Box */}
        <div
          style={{
            backgroundColor: '#f8fafc',
            borderTop: '1.5px solid #e2e8f0',
            padding: '14px 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: '#475569' }}>
            <span>New Items Subtotal:</span>
            <span style={{ fontWeight: 750 }}>₹{newSubtotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: '#475569' }}>
            <span>GST Payable (5%):</span>
            <span style={{ fontWeight: 750 }}>₹{newTax.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '1.15rem',
              fontWeight: 950,
              color: '#0f172a',
              borderTop: '1px solid #cbd5e1',
              paddingTop: '6px'
            }}
          >
            <span>Total Payable for this Order:</span>
            <span style={{ color: '#0f766e' }}>₹{newGrandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
          </div>
        </div>

        {/* Kitchen Closed Hours Indicator Banner */}
        {order?.is_closed_hours && (
          <div
            style={{
              backgroundColor: '#fee2e2',
              borderBottom: '1px solid #fecaca',
              padding: '10px 20px',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              color: '#991b1b',
              fontSize: '0.86rem',
              fontWeight: 800
            }}
          >
            <span style={{ fontSize: '1.25rem' }}>🌙</span>
            <div>
              <div>Restaurant Closing Window Active ({order.restaurant_timings?.closeStart || '10:55 PM'} – {order.restaurant_timings?.closeEnd || '8:00 AM'})</div>
              <div style={{ fontSize: '0.76rem', fontWeight: 600, color: '#b91c1c' }}>
                Guest placed order during closed hours. Tap Cancel to inform guest that restaurant is closed.
              </div>
            </div>
          </div>
        )}

        {/* Action Footer: Accept & Print KOT OR Cancel (Restaurant Closed) */}
        <div
          style={{
            padding: '16px 20px',
            backgroundColor: '#ffffff',
            borderTop: '1px solid #e2e8f0',
            display: 'flex',
            gap: '12px',
            alignItems: 'center'
          }}
        >
          {/* Cancel Request (Restaurant Closed) Button */}
          <button
            type="button"
            onClick={() => onCancel && onCancel(order, 'restaurant_closed')}
            disabled={isCancelling || isAccepting}
            style={{
              flex: 1,
              padding: '14px 20px',
              borderRadius: '12px',
              border: '1.5px solid #ef4444',
              backgroundColor: order?.is_closed_hours ? '#ef4444' : '#fee2e2',
              color: order?.is_closed_hours ? '#ffffff' : '#b91c1c',
              fontWeight: 900,
              fontSize: '0.98rem',
              cursor: (isCancelling || isAccepting) ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              boxShadow: order?.is_closed_hours ? '0 4px 14px rgba(239,68,68,0.35)' : 'none',
              opacity: (isCancelling || isAccepting) ? 0.7 : 1,
              transition: 'all 0.15s ease'
            }}
            title="Cancel order and notify guest that restaurant is closed"
          >
            <span>❌</span>
            <span>{isCancelling ? 'Cancelling...' : 'Cancel Request (Closed)'}</span>
          </button>

          {/* Accept & Print KOT Button */}
          <button
            type="button"
            onClick={() => onAccept(order)}
            disabled={isAccepting || isCancelling}
            style={{
              flex: 1.4,
              padding: '14px 24px',
              borderRadius: '12px',
              border: 'none',
              background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)',
              color: '#ffffff',
              fontWeight: 900,
              fontSize: '1.02rem',
              cursor: (isAccepting || isCancelling) ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '10px',
              boxShadow: '0 4px 16px rgba(16, 185, 129, 0.35)',
              opacity: (isAccepting || isCancelling) ? 0.7 : 1
            }}
          >
            <span style={{ fontSize: '1.2rem' }}>🖨️</span>
            <span>{isAccepting ? 'Printing KOT...' : 'Accept & Print KOT'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
