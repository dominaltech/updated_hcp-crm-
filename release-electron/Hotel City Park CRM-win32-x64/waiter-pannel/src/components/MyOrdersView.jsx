import React, { useState } from 'react';
import { api } from '../api/client';

export default function MyOrdersView({
  department,
  currentUser,
  tables = [],
  recentOrders = [],
  occupiedRooms = [],
  onSelectDestinationForMore,
  onRefresh,
  isLoading,
  setTables
}) {
  const [activeSubTab, setActiveSubTab] = useState('active'); // 'active' | 'recent'
  const [actionInProgress, setActionInProgress] = useState(null);
  const [msg, setMsg] = useState('');
  const [selectedOrder, setSelectedOrder] = useState(null); // Full order view modal
  const [orderToCancel, setOrderToCancel] = useState(null); // Cancel confirmation modal
  const [settleModalTable, setSettleModalTable] = useState(null);
  const [rsSettleMode, setRsSettleMode] = useState('pay'); // 'pay' | 'room'
  const [rsPayMethod, setRsPayMethod] = useState('cash'); // 'cash' | 'upi' | 'card'
  const [paymentMode, setPaymentMode] = useState('cash');
  const [selectedRoomId, setSelectedRoomId] = useState('');
  const [isPaidAtRoom, setIsPaidAtRoom] = useState(false);
  const [selectedOwner, setSelectedOwner] = useState('Jaijeet sir');
  const [ownerNote, setOwnerNote] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const isBar = department === 'bar';
  const myName = currentUser?.full_name || currentUser?.username || 'Waiter';
  const myId = currentUser?.id;

  // Show all active running tables and room service orders for this department
  const myActiveTables = tables.filter((t) => {
    const isRS = t.table_type === 'room_service' || String(t.table_number || '').startsWith('RS-');
    const isParcel = t.table_type === 'parcel' || t.is_parcel || t.is_takeaway || String(t.table_number || '').startsWith('P-');
    const hasActiveOrder = (t.status !== 'available' && t.status !== '') || (t.cart && t.cart.length > 0);
    return hasActiveOrder;
  });

  // Recent orders in this department
  const allDepartmentOrders = recentOrders.filter((o) => {
    if (!o) return false;
    if (department && o.department && o.department.toLowerCase() !== department.toLowerCase()) return false;
    return true;
  });

  // Filter active tables by search query
  const filteredActiveTables = myActiveTables.filter((t) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    const matchTable = String(t.table_number || t.name || '').toLowerCase().includes(q);
    const matchItems = Array.isArray(t.cart) && t.cart.some((it) => it.name && it.name.toLowerCase().includes(q));
    const matchWaiter = String(t.waiter_name || '').toLowerCase().includes(q);
    return matchTable || matchItems || matchWaiter;
  });

  // Filter recent orders by search query
  const filteredRecentOrders = allDepartmentOrders.filter((o) => {
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
    const matchWaiter = String(o.waiter_name || '').toLowerCase().includes(q);
    return matchNum || matchDest || matchItems || matchWaiter;
  });

  // Cancel Active Table Order (Void Table)
  const handleConfirmCancelTable = async (table) => {
    try {
      setActionInProgress(`cancel-table-${table.id}`);

      // Optimistically remove table from view immediately for instant 0ms response
      if (typeof setTables === 'function') {
        setTables((prev) => prev.map((t) => {
          if (String(t.id) === String(table.id) || t.table_number === table.table_number) {
            return {
              ...t,
              status: 'available',
              cart: [],
              cart_total: 0,
              token_number: 0,
              kot_count: 0,
              order_started_at: null,
              waiter_name: '',
              special_notes: ''
            };
          }
          return t;
        }).filter((t) => {
          if (String(t.id) === String(table.id) || t.table_number === table.table_number) {
            const num = String(t.table_number || '');
            if (t.table_type === 'room_service' || t.table_type === 'parcel' || num.startsWith('RS-') || num.startsWith('P-')) {
              return false;
            }
          }
          return true;
        }));
      }

      await api.cancelTable(department, table.id, table);
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
      await api.cancelOrder(department, order.id, order);
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
      setMsg(`🧾 Pre-Bill sent to CRM Printer for ${table.table_number || table.name}!`);
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
      
      const isRS = settleModalTable.table_type === 'room_service' || String(settleModalTable.table_number || '').startsWith('RS-');

      let settlePayload;

      if (isRS) {
        // Room Service Order: 2 distinct options
        const rawRoomNum = String(settleModalTable.table_number || '').replace(/^RS-/i, '').trim();
        const matchedRoom = occupiedRooms.find(r => String(r.room_number) === rawRoomNum || String(r.id) === String(settleModalTable.room_id));
        const resolvedRoomId = matchedRoom?.id || settleModalTable.room_id || null;

        if (rsSettleMode === 'pay') {
          // 1. Pay Now -> Shows in green "✓ Paid" in room folio
          settlePayload = {
            payment_mode: rsPayMethod || 'cash',
            payment_method: rsPayMethod || 'cash',
            is_paid: 1,
            room_id: resolvedRoomId,
            room_number: rawRoomNum,
            waiter_name: myName,
            customer_name: matchedRoom?.guest_name ? `Room ${rawRoomNum} - ${matchedRoom.guest_name}` : (settleModalTable.customer_name || `Room ${rawRoomNum}`),
            guest_phone: matchedRoom?.guest_phone || settleModalTable.customer_phone || ''
          };
        } else {
          // 2. Add to Room -> Shows in red "⏳ Pending" in room folio
          settlePayload = {
            payment_mode: 'room_folio',
            payment_method: 'room_folio',
            is_paid: 0,
            room_id: resolvedRoomId,
            room_number: rawRoomNum,
            waiter_name: myName,
            customer_name: matchedRoom?.guest_name ? `Room ${rawRoomNum} - ${matchedRoom.guest_name}` : (settleModalTable.customer_name || `Room ${rawRoomNum}`),
            guest_phone: matchedRoom?.guest_phone || settleModalTable.customer_phone || ''
          };
        }
      } else {
        // Dine-in table or parcel settlement
        settlePayload = {
          payment_method: paymentMode,
          payment_mode: paymentMode,
          waiter_name: myName
        };

        if (paymentMode === 'room_folio') {
          if (!selectedRoomId) {
            setMsg('⚠️ Please select an occupied room for Room Folio settlement.');
            setTimeout(() => setMsg(''), 4000);
            setActionInProgress(null);
            return;
          }
          const roomObj = occupiedRooms.find(r => String(r.id) === String(selectedRoomId));
          settlePayload.room_id = selectedRoomId;
          settlePayload.room_number = roomObj?.room_number || '';
          settlePayload.is_paid = isPaidAtRoom ? 1 : 0;
          if (roomObj?.guest_name) settlePayload.customer_name = `Room ${roomObj.room_number} - ${roomObj.guest_name}`;
          if (roomObj?.guest_phone && roomObj.guest_phone !== '—') settlePayload.guest_phone = roomObj.guest_phone;
        } else if (paymentMode === 'owner') {
          settlePayload.payment_mode = 'owner';
          settlePayload.payment_method = 'owner';
          settlePayload.owner_name = selectedOwner;
          settlePayload.customer_name = `${selectedOwner} (Owner)`;
          settlePayload.is_paid = 0; // Unpaid / Owner charge, zero cash discrepancy
          settlePayload.room_service_for = `Owner: ${selectedOwner}${ownerNote.trim() ? ` - ${ownerNote.trim()}` : ''}`;
          settlePayload.special_notes = ownerNote.trim() || `Charged to ${selectedOwner}`;
        } else {
          settlePayload.is_paid = 1;
        }
      }

      await api.settleTable(department, settleModalTable.id, settlePayload);
      setMsg(`✅ Order for ${settleModalTable.table_number || settleModalTable.name} settled successfully!`);
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
          <span>📜 All Orders ({allDepartmentOrders.length})</span>
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
                          {t.order_started_at && ` • 🕒 ${new Date(t.order_started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
                          {t.waiter_name && ` • 👤 ${t.waiter_name}`}
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
                  <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr 1fr 1.1fr', gap: '5px' }}>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        const numStr = String(t.table_number || '');
                        const isRS = t.table_type === 'room_service' || numStr.startsWith('RS-');
                        const isP = t.table_type === 'parcel' || numStr.startsWith('P-');
                        onSelectDestinationForMore({
                          type: isRS ? 'room' : (isP ? 'parcel' : 'table'),
                          id: t.id,
                          label: t.table_number || `Table ${t.id}`,
                          rawTable: t,
                          isExistingOrder: true
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
                      + Add Items
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
                      {actionInProgress === `print-${t.id}` ? '...' : '🧾 Pre-Bill'}
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
                        {o.created_at && ` • 🕒 ${new Date(o.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
                        {o.waiter_name && ` • 👤 ${o.waiter_name}`}
                      </div>
                    </div>

                    <div style={{ textAlign: 'right', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <div style={{ fontSize: '0.98rem', fontWeight: 900, color: 'var(--apple-blue)', marginRight: '4px' }}>
                        ₹{Number(o.total || o.grand_total || 0).toLocaleString('en-IN')}
                      </div>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          const tableStr = String(o.table_number || '');
                          const isRS = tableStr.startsWith('RS-') || o.destination_type === 'room';
                          const isP = tableStr.startsWith('P-') || o.destination_type === 'parcel';
                          onSelectDestinationForMore({
                            type: isRS ? 'room' : (isP ? 'parcel' : 'table'),
                            id: o.room_id || o.table_id || o.id,
                            label: o.table_number || `Order #${o.id}`,
                            rawOrder: o,
                            isExistingOrder: true
                          });
                        }}
                        title="Add more items to this order"
                        style={{
                          padding: '5px 8px',
                          borderRadius: 'var(--radius-xs)',
                          background: isBar ? 'var(--apple-purple-subtle)' : 'var(--apple-orange-subtle)',
                          border: isBar ? '1px solid var(--apple-purple)' : '1px solid var(--apple-orange)',
                          color: isBar ? 'var(--apple-purple)' : 'var(--apple-orange)',
                          fontSize: '0.70rem',
                          fontWeight: 800,
                          cursor: 'pointer'
                        }}
                      >
                        + Add Items
                      </button>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOrderToCancel({ type: 'order', target: o });
                        }}
                        title="Cancel this order"
                        style={{
                          padding: '5px 8px',
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
                  const data = selectedOrder.data;
                  const numStr = String(data.table_number || data.name || '');
                  const isRS = data.table_type === 'room_service' || numStr.startsWith('RS-');
                  const isP = data.table_type === 'parcel' || numStr.startsWith('P-');
                  setSelectedOrder(null);
                  onSelectDestinationForMore({
                    type: isRS ? 'room' : (isP ? 'parcel' : 'table'),
                    id: data.id,
                    label: data.table_number || data.customer_name || `Order #${data.id}`,
                    rawTable: selectedOrder.type === 'table' ? data : null,
                    rawOrder: selectedOrder.type === 'order' ? data : null,
                    isExistingOrder: true
                  });
                }}
                style={{
                  flex: 1.2,
                  height: '40px',
                  borderRadius: 'var(--radius-sm)',
                  background: isBar ? 'var(--apple-purple-subtle)' : 'var(--apple-orange-subtle)',
                  border: isBar ? '1.5px solid var(--apple-purple)' : '1.5px solid var(--apple-orange)',
                  color: isBar ? 'var(--apple-purple)' : 'var(--apple-orange)',
                  fontSize: '0.82rem',
                  fontWeight: 850,
                  cursor: 'pointer'
                }}
              >
                + Add Items
              </button>

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
            {(() => {
              const isRS = settleModalTable.table_type === 'room_service' || String(settleModalTable.table_number || '').startsWith('RS-');
              const rawRoomNum = String(settleModalTable.table_number || '').replace(/^RS-/i, '').trim();
              const settleItems = settleModalTable.cart || [];
              const settleSubtotal = settleModalTable.cart_total || settleItems.reduce((s, it) => s + ((Number(it.price) || 0) * (it.qty || it.quantity || 1)), 0);
              const settleGst = Math.round((settleSubtotal * 5) / 100);
              const settleGrand = Math.round(settleSubtotal + settleGst);

              if (isRS) {
                return (
                  <div>
                    <h3 style={{ fontSize: '1.10rem', fontWeight: 900, color: 'var(--text-primary)', margin: '0 0 2px' }}>
                      🛎️ Room Service - Room {rawRoomNum}
                    </h3>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '4px 0 12px', padding: '6px 10px', background: 'var(--bg-surface-secondary)', borderRadius: 'var(--radius-xs)' }}>
                      <span style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>Amount to Settle:</span>
                      <span style={{ fontSize: '1.05rem', fontWeight: 900, color: 'var(--apple-blue)' }}>₹{settleGrand.toLocaleString('en-IN')}</span>
                    </div>

                    <p style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', margin: '0 0 10px' }}>
                      Choose how this room service bill should be settled:
                    </p>

                    {/* 2 Clear Options Requested by User */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '14px' }}>
                      {/* Option 1: Pay Now */}
                      <button
                        type="button"
                        onClick={() => setRsSettleMode('pay')}
                        style={{
                          padding: '12px 8px',
                          borderRadius: 'var(--radius-sm)',
                          border: rsSettleMode === 'pay' ? '2px solid #16a34a' : '1px solid var(--border-medium)',
                          background: rsSettleMode === 'pay' ? 'rgba(22, 163, 74, 0.12)' : 'var(--bg-surface-secondary)',
                          color: rsSettleMode === 'pay' ? '#16a34a' : 'var(--text-secondary)',
                          cursor: 'pointer',
                          textAlign: 'center',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: '3px'
                        }}
                      >
                        <span style={{ fontSize: '1.3rem' }}>💵</span>
                        <span style={{ fontSize: '0.86rem', fontWeight: 900, color: rsSettleMode === 'pay' ? '#16a34a' : 'var(--text-primary)' }}>
                          Pay Now
                        </span>
                        <span style={{ fontSize: '0.64rem', color: '#16a34a', fontWeight: 750, marginTop: '2px' }}>
                          ✓ Shows Green "Paid" in Room
                        </span>
                      </button>

                      {/* Option 2: Add to Room */}
                      <button
                        type="button"
                        onClick={() => setRsSettleMode('room')}
                        style={{
                          padding: '12px 8px',
                          borderRadius: 'var(--radius-sm)',
                          border: rsSettleMode === 'room' ? '2px solid #dc2626' : '1px solid var(--border-medium)',
                          background: rsSettleMode === 'room' ? 'rgba(220, 38, 38, 0.10)' : 'var(--bg-surface-secondary)',
                          color: rsSettleMode === 'room' ? '#dc2626' : 'var(--text-secondary)',
                          cursor: 'pointer',
                          textAlign: 'center',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: '3px'
                        }}
                      >
                        <span style={{ fontSize: '1.3rem' }}>🏨</span>
                        <span style={{ fontSize: '0.86rem', fontWeight: 900, color: rsSettleMode === 'room' ? '#dc2626' : 'var(--text-primary)' }}>
                          Add to Room
                        </span>
                        <span style={{ fontSize: '0.64rem', color: '#dc2626', fontWeight: 750, marginTop: '2px' }}>
                          ⏳ Shows Red "Pending" in Room
                        </span>
                      </button>
                    </div>

                    {/* Method details based on selected option */}
                    {rsSettleMode === 'pay' ? (
                      <div style={{ background: 'var(--bg-surface-secondary)', padding: '10px', borderRadius: 'var(--radius-sm)', marginBottom: '14px', border: '1px solid var(--border-medium)' }}>
                        <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 800, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                          Payment Method Received:
                        </label>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
                          {[
                            { id: 'cash', label: '💵 Cash' },
                            { id: 'upi', label: '📱 UPI' },
                            { id: 'card', label: '💳 Card' }
                          ].map((m) => (
                            <button
                              key={m.id}
                              type="button"
                              onClick={() => setRsPayMethod(m.id)}
                              style={{
                                padding: '8px 4px',
                                borderRadius: 'var(--radius-xs)',
                                background: rsPayMethod === m.id ? 'var(--apple-blue-subtle)' : 'var(--bg-surface)',
                                border: rsPayMethod === m.id ? '1.5px solid var(--apple-blue)' : '1px solid var(--border-medium)',
                                color: rsPayMethod === m.id ? 'var(--apple-blue)' : 'var(--text-primary)',
                                fontSize: '0.76rem',
                                fontWeight: 800,
                                cursor: 'pointer'
                              }}
                            >
                              {m.label}
                            </button>
                          ))}
                        </div>
                        <div style={{ fontSize: '0.68rem', color: '#16a34a', fontWeight: 700, marginTop: '8px', textAlign: 'center' }}>
                          Guest paid ₹{settleGrand.toLocaleString('en-IN')} via {rsPayMethod.toUpperCase()}. Room folio will reflect as <strong>PAID (Green)</strong>.
                        </div>
                      </div>
                    ) : (
                      <div style={{ background: 'rgba(220, 38, 38, 0.08)', padding: '10px 12px', borderRadius: 'var(--radius-sm)', marginBottom: '14px', border: '1px dashed #fca5a5' }}>
                        <div style={{ fontSize: '0.74rem', color: '#b91c1c', fontWeight: 800, marginBottom: '2px' }}>
                          ⏳ Unpaid Room Folio Charge
                        </div>
                        <div style={{ fontSize: '0.70rem', color: '#b91c1c', lineHeight: 1.35 }}>
                          ₹{settleGrand.toLocaleString('en-IN')} will be posted to Room {rawRoomNum}'s checkout balance. It will display in <strong>RED as "Pending"</strong> in Room Folio.
                        </div>
                      </div>
                    )}
                  </div>
                );
              }

              return (
                <div>
                  <h3 style={{ fontSize: '1.10rem', fontWeight: 900, color: 'var(--text-primary)', margin: '0 0 4px' }}>
                    💵 Settle {settleModalTable.table_number || settleModalTable.name}
                  </h3>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '4px 0 12px', padding: '6px 10px', background: 'var(--bg-surface-secondary)', borderRadius: 'var(--radius-xs)' }}>
                    <span style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>Bill Total:</span>
                    <span style={{ fontSize: '1.05rem', fontWeight: 900, color: 'var(--apple-blue)' }}>₹{settleGrand.toLocaleString('en-IN')}</span>
                  </div>
                  <p style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', margin: '0 0 14px' }}>
                    Select payment mode received from guest:
                  </p>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px', marginBottom: '14px' }}>
                    {[
                      { id: 'cash', label: '💵 Cash' },
                      { id: 'upi', label: '📱 UPI / QR' },
                      { id: 'card', label: '💳 Card POS' },
                      { id: 'room_folio', label: '🛏️ Room Folio' },
                      { id: 'owner', label: '👤 Owner Account' }
                    ].map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setPaymentMode(m.id)}
                        style={{
                          padding: '9px 6px',
                          borderRadius: 'var(--radius-sm)',
                          background: paymentMode === m.id ? 'var(--apple-blue-subtle)' : 'var(--bg-surface-secondary)',
                          border: paymentMode === m.id ? '1.5px solid var(--apple-blue)' : '1px solid var(--border-medium)',
                          color: paymentMode === m.id ? 'var(--apple-blue)' : 'var(--text-secondary)',
                          fontSize: '0.76rem',
                          fontWeight: 800,
                          cursor: 'pointer',
                          textAlign: 'center',
                          gridColumn: m.id === 'owner' ? 'span 2' : 'auto'
                        }}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>

                  {/* Room Folio Sub-options for Dine-in Table */}
                  {paymentMode === 'room_folio' && (
                    <div style={{ background: 'var(--bg-surface-secondary)', padding: '12px', borderRadius: 'var(--radius-sm)', marginBottom: '14px', border: '1px solid var(--border-medium)' }}>
                      <label style={{ display: 'block', fontSize: '0.74rem', fontWeight: 800, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                        Select In-House Room:
                      </label>
                      <select
                        value={selectedRoomId}
                        onChange={(e) => setSelectedRoomId(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '8px 10px',
                          borderRadius: 'var(--radius-xs)',
                          border: '1px solid var(--border-medium)',
                          background: 'var(--bg-surface)',
                          color: 'var(--text-primary)',
                          fontSize: '0.82rem',
                          fontWeight: 700,
                          marginBottom: '10px'
                        }}
                      >
                        <option value="">-- Choose Occupied Room --</option>
                        {occupiedRooms.map((r) => (
                          <option key={r.id} value={r.id}>
                            Room {r.room_number} {r.guest_name ? `(${r.guest_name})` : ''}
                          </option>
                        ))}
                      </select>

                      <label style={{ display: 'block', fontSize: '0.74rem', fontWeight: 800, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                        Billing Status in Room Folio:
                      </label>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                        <button
                          type="button"
                          onClick={() => setIsPaidAtRoom(false)}
                          style={{
                            padding: '8px 6px',
                            borderRadius: 'var(--radius-xs)',
                            border: !isPaidAtRoom ? '1.5px solid var(--apple-red)' : '1px solid var(--border-medium)',
                            background: !isPaidAtRoom ? 'rgba(220, 38, 38, 0.10)' : 'var(--bg-surface)',
                            color: !isPaidAtRoom ? 'var(--apple-red)' : 'var(--text-secondary)',
                            fontSize: '0.72rem',
                            fontWeight: 800,
                            cursor: 'pointer'
                          }}
                        >
                          ⏳ Pending (Red)
                        </button>
                        <button
                          type="button"
                          onClick={() => setIsPaidAtRoom(true)}
                          style={{
                            padding: '8px 6px',
                            borderRadius: 'var(--radius-xs)',
                            border: isPaidAtRoom ? '1.5px solid #16a34a' : '1px solid var(--border-medium)',
                            background: isPaidAtRoom ? 'rgba(22, 163, 74, 0.12)' : 'var(--bg-surface)',
                            color: isPaidAtRoom ? '#16a34a' : 'var(--text-secondary)',
                            fontSize: '0.72rem',
                            fontWeight: 800,
                            cursor: 'pointer'
                          }}
                        >
                          ✓ Paid (Green)
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Owner Account Sub-options */}
                  {paymentMode === 'owner' && (
                    <div style={{ background: 'var(--bg-surface-secondary)', padding: '12px', borderRadius: 'var(--radius-sm)', marginBottom: '14px', border: '1px solid var(--border-medium)' }}>
                      <label style={{ display: 'block', fontSize: '0.74rem', fontWeight: 800, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                        Select Owner Account:
                      </label>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '10px' }}>
                        {['Jaijeet sir', 'Mahesh Sir'].map((owner) => (
                          <button
                            key={owner}
                            type="button"
                            onClick={() => setSelectedOwner(owner)}
                            style={{
                              padding: '10px 8px',
                              borderRadius: 'var(--radius-xs)',
                              border: selectedOwner === owner ? '1.5px solid var(--apple-blue)' : '1px solid var(--border-medium)',
                              background: selectedOwner === owner ? 'var(--apple-blue-subtle)' : 'var(--bg-surface)',
                              color: selectedOwner === owner ? 'var(--apple-blue)' : 'var(--text-secondary)',
                              fontSize: '0.78rem',
                              fontWeight: 850,
                              cursor: 'pointer'
                            }}
                          >
                            {owner}
                          </button>
                        ))}
                      </div>

                      <input
                        type="text"
                        value={ownerNote}
                        onChange={(e) => setOwnerNote(e.target.value)}
                        placeholder="Note / Reference (e.g. Guest hospitality, meeting)..."
                        style={{
                          width: '100%',
                          padding: '8px 10px',
                          borderRadius: 'var(--radius-xs)',
                          border: '1px solid var(--border-medium)',
                          background: 'var(--bg-surface)',
                          color: 'var(--text-primary)',
                          fontSize: '0.76rem',
                          boxSizing: 'border-box',
                          marginBottom: '8px'
                        }}
                      />

                      <p style={{ margin: 0, fontSize: '0.68rem', color: 'var(--text-tertiary)', lineHeight: 1.3 }}>
                        ℹ️ Logged as Owner Unpaid Khata. Cash register total will not be altered.
                      </p>
                    </div>
                  )}
                </div>
              );
            })()}

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
