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
  const [activeSubTab, setActiveSubTab] = useState('active'); // 'active' | 'recent'
  const [actionInProgress, setActionInProgress] = useState(null);
  const [msg, setMsg] = useState('');
  const [selectedOrder, setSelectedOrder] = useState(null); // Full order view modal
  const [orderToCancel, setOrderToCancel] = useState(null); // Cancel confirmation modal
  const [settleModalTable, setSettleModalTable] = useState(null);
  const [paymentMode, setPaymentMode] = useState('cash');
  const [searchQuery, setSearchQuery] = useState('');

  const isBar = department === 'bar';
  const myName = currentUser?.full_name || currentUser?.username || 'Waiter';
  const myId = currentUser?.id;

  // Filter active tables attended by this waiter
  const myActiveTables = tables.filter((t) => {
    const isAttendedByMe = (
      (t.waiter_name && (t.waiter_name.toLowerCase() === myName.toLowerCase() || t.waiter_name.toLowerCase() === currentUser?.username?.toLowerCase())) ||
      (t.waiter_id && t.waiter_id === myId)
    );
    const hasActiveOrder = (t.status !== 'available' && t.status !== '') || (t.cart && t.cart.length > 0);
    return isAttendedByMe && hasActiveOrder;
  });

  // Filter recent orders placed by this waiter
  const myRecentOrders = recentOrders.filter((o) => {
    if (!o) return false;
    const waiterMatches = (
      (o.waiter_name && (o.waiter_name.toLowerCase() === myName.toLowerCase() || o.waiter_name.toLowerCase() === currentUser?.username?.toLowerCase())) ||
      (o.waiter_id && o.waiter_id === myId) ||
      (o.notes && o.notes.toLowerCase().includes(myName.toLowerCase()))
    );
    return waiterMatches;
  });

  // Filter active tables by search query
  const filteredActiveTables = myActiveTables.filter((t) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    const matchTable = String(t.table_number || t.name || '').toLowerCase().includes(q);
    const matchItems = Array.isArray(t.cart) && t.cart.some((it) => it.name && it.name.toLowerCase().includes(q));
    return matchTable || matchItems;
  });

  // Filter recent orders by search query
  const filteredRecentOrders = myRecentOrders.filter((o) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    const matchNum = String(o.order_number || o.id || '').toLowerCase().includes(q);
    const matchDest = String(o.table_number || o.customer_name || '').toLowerCase().includes(q);
    let items = [];
    try {
      items = typeof o.items_json === 'string' ? JSON.parse(o.items_json) : (o.items || []);
    } catch {
      items = o.items || [];
    }
    const matchItems = items.some((it) => it.name && it.name.toLowerCase().includes(q));
    return matchNum || matchDest || matchItems;
  });

  // Cancel Active Table Order (Void Table)
  const handleConfirmCancelTable = async (table) => {
    try {
      setActionInProgress(`cancel-table-${table.id}`);
      await api.cancelTable(department, table.id);
      setMsg(`🗑️ Table ${table.table_number || table.name} order has been canceled.`);
      setSelectedOrder(null);
      setOrderToCancel(null);
      setTimeout(() => setMsg(''), 4000);
      onRefresh();
    } catch (err) {
      setMsg(`❌ Cancel failed: ${err.message}`);
      setTimeout(() => setMsg(''), 5000);
    } finally {
      setActionInProgress(null);
    }
  };

  // Cancel / Delete Placed Order
  const handleConfirmCancelOrder = async (order) => {
    try {
      setActionInProgress(`cancel-order-${order.id}`);
      await api.cancelOrder(department, order.id);
      setMsg(`🗑️ Order #${order.order_number || order.id} has been canceled.`);
      setSelectedOrder(null);
      setOrderToCancel(null);
      setTimeout(() => setMsg(''), 4000);
      onRefresh();
    } catch (err) {
      setMsg(`❌ Cancel failed: ${err.message}`);
      setTimeout(() => setMsg(''), 5000);
    } finally {
      setActionInProgress(null);
    }
  };

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
      setSelectedOrder(null);
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
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '12px', background: 'var(--bg-app)', boxSizing: 'border-box' }}>
      {/* Top Bar with Title, Subtitle & Refresh */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <div>
          <h2 style={{ fontSize: '1.08rem', fontWeight: 900, color: 'var(--text-primary)', margin: 0 }}>
            📋 My Orders
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
            padding: '6px 12px',
            borderRadius: 'var(--radius-xs)',
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-medium)',
            color: 'var(--text-primary)',
            fontSize: '0.76rem',
            fontWeight: 800,
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            boxShadow: 'var(--shadow-subtle)',
            cursor: 'pointer'
          }}
        >
          <span>🔄</span>
          <span>Refresh</span>
        </button>
      </div>

      {/* Tabs: Active Running Orders vs All Punched Orders */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '6px',
          background: 'var(--bg-surface)',
          padding: '4px',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--border-light)',
          marginBottom: '10px'
        }}
      >
        <button
          type="button"
          onClick={() => setActiveSubTab('active')}
          style={{
            padding: '8px 10px',
            borderRadius: 'var(--radius-xs)',
            border: 'none',
            background: activeSubTab === 'active' ? 'var(--apple-blue)' : 'transparent',
            color: activeSubTab === 'active' ? '#fff' : 'var(--text-secondary)',
            fontSize: '0.78rem',
            fontWeight: 850,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '5px',
            transition: 'all 0.15s ease'
          }}
        >
          <span>🟢 Active Running ({myActiveTables.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('recent')}
          style={{
            padding: '8px 10px',
            borderRadius: 'var(--radius-xs)',
            border: 'none',
            background: activeSubTab === 'recent' ? 'var(--apple-blue)' : 'transparent',
            color: activeSubTab === 'recent' ? '#fff' : 'var(--text-secondary)',
            fontSize: '0.78rem',
            fontWeight: 850,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '5px',
            transition: 'all 0.15s ease'
          }}
        >
          <span>📜 All Orders ({myRecentOrders.length})</span>
        </button>
      </div>

      {/* Search Input */}
      <div style={{ marginBottom: '10px' }}>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="🔍 Search orders by table, #, or dish..."
          style={{
            width: '100%',
            height: '38px',
            padding: '0 12px',
            background: 'var(--bg-surface)',
            border: '1.5px solid var(--border-medium)',
            borderRadius: 'var(--radius-xs)',
            color: 'var(--text-primary)',
            fontSize: '0.82rem',
            fontWeight: 650,
            outline: 'none',
            boxSizing: 'border-box'
          }}
        />
      </div>

      {msg && (
        <div
          style={{
            padding: '8px 12px',
            borderRadius: 'var(--radius-xs)',
            background: 'var(--apple-green-subtle)',
            border: '1px solid var(--apple-green)',
            color: 'var(--apple-green)',
            fontSize: '0.78rem',
            fontWeight: 800,
            marginBottom: '10px'
          }}
        >
          {msg}
        </div>
      )}

      {/* Main List */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', paddingBottom: '70px' }}>
        {activeSubTab === 'active' ? (
          /* Active Running Tables View */
          filteredActiveTables.length === 0 ? (
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                padding: '40px 16px',
                color: 'var(--text-tertiary)',
                background: 'var(--bg-surface)',
                borderRadius: 'var(--radius-md)',
                border: '1px dashed var(--border-medium)'
              }}
            >
              <span style={{ fontSize: '2.5rem', marginBottom: '8px' }}>🍽️</span>
              <div style={{ fontSize: '0.98rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '4px' }}>
                No Active Orders Running
              </div>
              <p style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', maxWidth: '280px', margin: 0 }}>
                {searchQuery ? 'No matching running tables found.' : 'Select a vacant table, room service, or parcel from the tabs above to punch your first KOT!'}
              </p>
            </div>
          ) : (
            filteredActiveTables.map((t) => {
              const items = t.cart || [];
              const subtotal = t.cart_total || items.reduce((s, it) => s + (it.price * (it.qty || it.quantity || 1)), 0);
              const gst = Math.round((subtotal * 5) / 100);
              const grand = Math.round(subtotal + gst);
              const isBilled = t.status === 'billed';

              return (
                <div
                  key={t.id}
                  onClick={() => setSelectedOrder({ type: 'table', data: t })}
                  style={{
                    background: 'var(--bg-surface)',
                    border: isBilled ? '1.5px solid var(--apple-red)' : '1.5px solid var(--border-medium)',
                    borderRadius: 'var(--radius-md)',
                    padding: '12px 14px',
                    boxShadow: 'var(--shadow-subtle)',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                  title="Click to view full order details & cancel options"
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

                  {/* Quick Items Preview */}
                  <div
                    style={{
                      background: 'var(--bg-surface-secondary)',
                      borderRadius: 'var(--radius-xs)',
                      padding: '6px 10px',
                      marginBottom: '10px'
                    }}
                  >
                    {items.length === 0 ? (
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>No items recorded</div>
                    ) : (
                      items.map((it, idx) => (
                        <div
                          key={idx}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            fontSize: '0.76rem',
                            color: 'var(--text-primary)',
                            padding: '2px 0',
                            borderBottom: idx < items.length - 1 ? '1px solid var(--border-light)' : 'none'
                          }}
                        >
                          <span><strong>{it.qty || it.quantity || 1}x</strong> {it.name}</span>
                          <span style={{ color: 'var(--text-secondary)', fontWeight: 700 }}>
                            ₹{((it.price || 0) * (it.qty || it.quantity || 1)).toLocaleString('en-IN')}
                          </span>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Actions for this table */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1.2fr', gap: '5px' }}>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectDestinationForMore({
                          type: 'table',
                          id: t.id,
                          label: t.table_number || `Table ${t.id}`,
                          rawTable: t
                        });
                      }}
                      style={{
                        padding: '6px 4px',
                        borderRadius: 'var(--radius-xs)',
                        background: isBar ? 'var(--apple-purple-subtle)' : 'var(--apple-orange-subtle)',
                        border: isBar ? '1px solid var(--apple-purple)' : '1px solid var(--apple-orange)',
                        color: isBar ? 'var(--apple-purple)' : 'var(--apple-orange)',
                        fontSize: '0.72rem',
                        fontWeight: 800,
                        cursor: 'pointer'
                      }}
                    >
                      + Add
                    </button>

                    <button
                      type="button"
                      disabled={actionInProgress === `print-${t.id}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePrintPrebill(t);
                      }}
                      style={{
                        padding: '6px 4px',
                        borderRadius: 'var(--radius-xs)',
                        background: 'var(--bg-surface-secondary)',
                        border: '1px solid var(--apple-blue)',
                        color: 'var(--apple-blue)',
                        fontSize: '0.72rem',
                        fontWeight: 800,
                        cursor: 'pointer'
                      }}
                    >
                      {actionInProgress === `print-${t.id}` ? '...' : '🧾 Bill'}
                    </button>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSettleModalTable(t);
                      }}
                      style={{
                        padding: '6px 4px',
                        borderRadius: 'var(--radius-xs)',
                        background: 'var(--apple-green-subtle)',
                        border: '1px solid var(--apple-green)',
                        color: 'var(--apple-green)',
                        fontSize: '0.72rem',
                        fontWeight: 800,
                        cursor: 'pointer'
                      }}
                    >
                      💵 Settle
                    </button>

                    {/* Cancel Table Order Button */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setOrderToCancel({ type: 'table', target: t });
                      }}
                      style={{
                        padding: '6px 4px',
                        borderRadius: 'var(--radius-xs)',
                        background: 'var(--apple-red-subtle)',
                        border: '1px solid var(--apple-red)',
                        color: 'var(--apple-red)',
                        fontSize: '0.72rem',
                        fontWeight: 800,
                        cursor: 'pointer'
                      }}
                    >
                      ❌ Cancel
                    </button>
                  </div>
                </div>
              );
            })
          )
        ) : (
          /* Recent / All Orders View */
          filteredRecentOrders.length === 0 ? (
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                padding: '40px 16px',
                color: 'var(--text-tertiary)',
                background: 'var(--bg-surface)',
                borderRadius: 'var(--radius-md)',
                border: '1px dashed var(--border-medium)'
              }}
            >
              <span style={{ fontSize: '2.5rem', marginBottom: '8px' }}>📜</span>
              <div style={{ fontSize: '0.98rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '4px' }}>
                No Recent Orders Found
              </div>
              <p style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', margin: 0 }}>
                {searchQuery ? 'Try a different search keyword.' : 'Punched orders will be listed here.'}
              </p>
            </div>
          ) : (
            filteredRecentOrders.map((o) => {
              let items = [];
              try {
                items = typeof o.items_json === 'string' ? JSON.parse(o.items_json) : (o.items || []);
              } catch {
                items = o.items || [];
              }

              return (
                <div
                  key={o.id}
                  onClick={() => setSelectedOrder({ type: 'order', data: o, items })}
                  style={{
                    padding: '12px 14px',
                    background: 'var(--bg-surface)',
                    border: '1.5px solid var(--border-medium)',
                    borderRadius: 'var(--radius-sm)',
                    boxShadow: 'var(--shadow-subtle)',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                  title="Click to view full order details & cancel option"
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '0.90rem', fontWeight: 900, color: 'var(--text-primary)' }}>
                          #{o.order_number || o.id}
                        </span>
                        <span
                          style={{
                            fontSize: '0.64rem',
                            fontWeight: 800,
                            padding: '1px 6px',
                            borderRadius: '4px',
                            background: 'var(--apple-blue-subtle)',
                            color: 'var(--apple-blue)',
                            border: '1px solid var(--apple-blue)',
                            textTransform: 'uppercase'
                          }}
                        >
                          {o.payment_mode || o.payment_method || 'Order'}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                        <strong>{o.table_number || o.customer_name || 'Counter'}</strong>
                        {o.created_at && ` • ${new Date(o.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
                        {o.waiter_name && ` • 👤 ${o.waiter_name}`}
                      </div>
                    </div>

                    <div style={{ textAlign: 'right', display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div style={{ fontSize: '1rem', fontWeight: 900, color: 'var(--apple-blue)' }}>
                        ₹{Number(o.total || o.grand_total || 0).toLocaleString('en-IN')}
                      </div>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOrderToCancel({ type: 'order', target: o });
                        }}
                        title="Cancel this order"
                        style={{
                          padding: '4px 8px',
                          borderRadius: 'var(--radius-xs)',
                          background: 'var(--apple-red-subtle)',
                          border: '1px solid var(--apple-red)',
                          color: 'var(--apple-red)',
                          fontSize: '0.70rem',
                          fontWeight: 800,
                          cursor: 'pointer'
                        }}
                      >
                        ❌ Cancel
                      </button>
                    </div>
                  </div>

                  {/* Items preview snippet */}
                  {items.length > 0 && (
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '6px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {items.map((it) => `${it.qty || it.quantity || 1}x ${it.name}`).join(', ')}
                    </div>
                  )}
                </div>
              );
            })
          )
        )}
      </div>

      {/* Full Order Detail Modal */}
      {selectedOrder && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.55)',
            backdropFilter: 'blur(6px)',
            zIndex: 10000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px'
          }}
          onClick={() => setSelectedOrder(null)}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '380px',
              maxHeight: '85dvh',
              background: 'var(--bg-surface)',
              borderRadius: 'var(--radius-lg, 16px)',
              border: '1.5px solid var(--border-medium)',
              boxShadow: 'var(--shadow-modal)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div
              style={{
                padding: '14px 18px',
                borderBottom: '1px solid var(--border-light)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: 'var(--bg-surface-secondary)'
              }}
            >
              <div>
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 900, color: 'var(--text-primary)' }}>
                  {selectedOrder.type === 'table'
                    ? `Order: ${selectedOrder.data.table_number || `Table ${selectedOrder.data.id}`}`
                    : `Order #${selectedOrder.data.order_number || selectedOrder.data.id}`}
                </h3>
                <div style={{ fontSize: '0.70rem', color: 'var(--text-secondary)', marginTop: '1px' }}>
                  {selectedOrder.type === 'table'
                    ? `Token #${selectedOrder.data.token_number || 1} • KOT #${selectedOrder.data.kot_count || 1}`
                    : `Settled • ${selectedOrder.data.created_at || 'Recent'}`}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setSelectedOrder(null)}
                style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '50%',
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-medium)',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer'
                }}
              >
                ✕
              </button>
            </div>

            {/* Modal Items List */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px' }}>
              <div style={{ fontSize: '0.70rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '8px' }}>
                All Order Dishes &amp; Items:
              </div>

              {(() => {
                let items = [];
                if (selectedOrder.type === 'table') {
                  items = selectedOrder.data.cart || [];
                } else {
                  try {
                    items = typeof selectedOrder.data.items_json === 'string'
                      ? JSON.parse(selectedOrder.data.items_json)
                      : (selectedOrder.data.items || selectedOrder.items || []);
                  } catch {
                    items = selectedOrder.data.items || [];
                  }
                }

                if (items.length === 0) {
                  return <div style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>No items found.</div>;
                }

                return items.map((it, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '6px 0',
                      borderBottom: '1px solid var(--border-light)',
                      fontSize: '0.80rem'
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 800, color: 'var(--text-primary)' }}>
                        {it.qty || it.quantity || 1}x {it.name}
                      </div>
                      {it.notes && (
                        <div style={{ fontSize: '0.68rem', color: 'var(--apple-orange)', fontStyle: 'italic' }}>
                          Note: {it.notes}
                        </div>
                      )}
                    </div>
                    <div style={{ fontWeight: 800, color: 'var(--text-primary)' }}>
                      ₹{((it.price || 0) * (it.qty || it.quantity || 1)).toLocaleString('en-IN')}
                    </div>
                  </div>
                ));
              })()}

              {/* Total Calculation */}
              <div style={{ marginTop: '14px', paddingTop: '10px', borderTop: '1.5px solid var(--border-medium)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.96rem', fontWeight: 900, color: 'var(--text-primary)' }}>
                  <span>Grand Total:</span>
                  <span style={{ color: 'var(--apple-blue)' }}>
                    ₹{Number(
                      selectedOrder.type === 'table'
                        ? (selectedOrder.data.cart_total || selectedOrder.data.cart?.reduce((s, it) => s + (it.price * (it.qty || 1)), 0) || 0) * 1.05
                        : (selectedOrder.data.total || selectedOrder.data.grand_total || 0)
                    ).toFixed(0)}
                  </span>
                </div>
              </div>
            </div>

            {/* Modal Bottom Actions */}
            <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border-light)', display: 'flex', gap: '8px' }}>
              <button
                type="button"
                onClick={() => {
                  const target = selectedOrder.type === 'table' ? selectedOrder.data : selectedOrder.data;
                  setOrderToCancel({ type: selectedOrder.type, target });
                }}
                style={{
                  flex: 1,
                  height: '40px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--apple-red-subtle)',
                  border: '1.5px solid var(--apple-red)',
                  color: 'var(--apple-red)',
                  fontSize: '0.82rem',
                  fontWeight: 850,
                  cursor: 'pointer'
                }}
              >
                ❌ Cancel Order
              </button>

              <button
                type="button"
                onClick={() => setSelectedOrder(null)}
                style={{
                  flex: 1,
                  height: '40px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--bg-surface-secondary)',
                  border: '1px solid var(--border-medium)',
                  color: 'var(--text-secondary)',
                  fontSize: '0.82rem',
                  fontWeight: 800,
                  cursor: 'pointer'
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Dialog: Cancel Order */}
      {orderToCancel && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.65)',
            backdropFilter: 'blur(6px)',
            zIndex: 10001,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px'
          }}
          onClick={() => setOrderToCancel(null)}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '340px',
              background: 'var(--bg-surface)',
              borderRadius: 'var(--radius-lg, 16px)',
              padding: '20px',
              border: '1.5px solid var(--apple-red)',
              boxShadow: 'var(--shadow-modal)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ textAlign: 'center', marginBottom: '14px' }}>
              <div style={{ fontSize: '2.4rem', marginBottom: '4px' }}>⚠️</div>
              <h3 style={{ margin: '0 0 6px', fontSize: '1.05rem', fontWeight: 900, color: 'var(--apple-red)' }}>
                Cancel &amp; Void Order?
              </h3>
              <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                {orderToCancel.type === 'table'
                  ? `Are you sure you want to cancel the running order for ${orderToCancel.target.table_number || `Table ${orderToCancel.target.id}`}? This will void all items.`
                  : `Are you sure you want to permanently cancel Order #${orderToCancel.target.order_number || orderToCancel.target.id}?`}
              </p>
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                onClick={() => setOrderToCancel(null)}
                style={{
                  flex: 1,
                  height: '40px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--bg-surface-secondary)',
                  border: '1px solid var(--border-medium)',
                  color: 'var(--text-secondary)',
                  fontWeight: 800,
                  fontSize: '0.80rem',
                  cursor: 'pointer'
                }}
              >
                No, Keep
              </button>
              <button
                type="button"
                disabled={actionInProgress?.startsWith('cancel-')}
                onClick={() => {
                  if (orderToCancel.type === 'table') {
                    handleConfirmCancelTable(orderToCancel.target);
                  } else {
                    handleConfirmCancelOrder(orderToCancel.target);
                  }
                }}
                style={{
                  flex: 1.2,
                  height: '40px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--apple-red)',
                  border: 'none',
                  color: '#fff',
                  fontWeight: 900,
                  fontSize: '0.82rem',
                  cursor: 'pointer'
                }}
              >
                {actionInProgress?.startsWith('cancel-') ? 'Canceling...' : 'Yes, Cancel Order'}
              </button>
            </div>
          </div>
        </div>
      )}

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
