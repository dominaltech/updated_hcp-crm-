import React, { useState, useMemo } from 'react';
import { api } from '../api/client';

export const extractOrderItems = (target) => {
  if (!target) return [];
  // Direct array check
  if (Array.isArray(target.cart) && target.cart.length > 0) return target.cart;
  if (Array.isArray(target.items) && target.items.length > 0) return target.items;
  // Parse active_cart_json
  if (typeof target.active_cart_json === 'string' && target.active_cart_json.trim()) {
    try {
      const p = JSON.parse(target.active_cart_json);
      if (Array.isArray(p) && p.length > 0) return p;
    } catch (_) {}
  }
  // Parse printed_cart_json
  if (typeof target.printed_cart_json === 'string' && target.printed_cart_json.trim()) {
    try {
      const p = JSON.parse(target.printed_cart_json);
      if (Array.isArray(p) && p.length > 0) return p;
    } catch (_) {}
  }
  // Parse items_json
  if (typeof target.items_json === 'string' && target.items_json.trim()) {
    try {
      const p = JSON.parse(target.items_json);
      if (Array.isArray(p) && p.length > 0) return p;
    } catch (_) {}
  }
  // If target itself is an array
  if (Array.isArray(target)) return target;
  return [];
};

export const formatCleanOrderNumber = (order) => {
  if (!order) return 'KOT';
  if (order.order_number && order.order_number !== 'KOT' && !order.order_number.includes('-4') && !order.order_number.includes('undefined')) {
    return order.order_number;
  }
  if (order.bill_no && order.bill_no !== 'KOT') {
    return order.bill_no;
  }
  const idStr = String(order.id || '');
  if (idStr.length > 8) {
    const cleanId = idStr.replace(/^cloud-/, '');
    return 'KOT-' + cleanId.slice(-6).toUpperCase();
  }
  return idStr || 'KOT';
};

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

  const isManagerOrCaptain = 
    currentUser?.role === 'manager' || 
    currentUser?.role === 'admin' || 
    currentUser?.role === 'restaurant' ||
    String(currentUser?.username || '').toLowerCase().includes('cap') ||
    String(currentUser?.username || '').toLowerCase().includes('admin');

  const [captainViewMode, setCaptainViewMode] = useState('my'); // 'my' | 'all'

  // Show running tables and room service orders for this department
  // Regular waiters ONLY see their own active orders
  const myActiveTables = useMemo(() => {
    const rawActive = tables.filter((t) => {
      const items = extractOrderItems(t);
      const hasActiveOrder = (t.status !== 'available' && t.status !== '') || items.length > 0;
      if (!hasActiveOrder) return false;

      const isMine =
        (t.waiter_id && t.waiter_id === myId) ||
        (t.waiter_name && (
          String(t.waiter_name).toLowerCase() === String(myName).toLowerCase() ||
          String(t.waiter_name).toLowerCase() === String(currentUser?.username || '').toLowerCase()
        ));

      // Regular waiters ONLY see their own active tables (cannot see or settle another waiter's table)
      if (!isManagerOrCaptain) {
        return isMine;
      }

      // If Captain / Manager chooses 'my' vs 'all'
      if (isManagerOrCaptain && captainViewMode === 'my') {
        return isMine;
      }

      return true;
    });

    const dedupedMap = new Map();
    for (const t of rawActive) {
      const rawNum = String(t.table_number || t.name || t.id || '');
      const cleanNum = rawNum.replace(/^RS-/i, '').replace(/^Room\s*/i, '').replace(/•.*$/, '').trim();
      const isRS = t.table_type === 'room_service' || rawNum.startsWith('RS-') || rawNum.startsWith('Room ');
      const key = isRS ? `room_${cleanNum}` : (rawNum.startsWith('P-') ? `parcel_${rawNum}` : `table_${cleanNum || rawNum}`);

      if (!dedupedMap.has(key)) {
        dedupedMap.set(key, { ...t });
      } else {
        // Merge duplicate table into single card
        const existing = dedupedMap.get(key);
        const existingItems = extractOrderItems(existing);
        const newItems = extractOrderItems(t);
        const mergedItems = [...existingItems];
        for (const it of newItems) {
          const mIdx = mergedItems.findIndex(m => String(m.id) === String(it.id));
          if (mIdx < 0) {
            mergedItems.push(it);
          } else {
            mergedItems[mIdx] = {
              ...mergedItems[mIdx],
              qty: Math.max(Number(mergedItems[mIdx].qty || mergedItems[mIdx].quantity) || 1, Number(it.qty || it.quantity) || 1),
              quantity: Math.max(Number(mergedItems[mIdx].qty || mergedItems[mIdx].quantity) || 1, Number(it.qty || it.quantity) || 1)
            };
          }
        }
        existing.cart = mergedItems;
        existing.active_cart_json = JSON.stringify(mergedItems);
        const sub = mergedItems.reduce((s, it) => s + ((Number(it.price) || 0) * (Number(it.qty || it.quantity) || 1)), 0);
        const grand = Math.round(sub + (sub * 0.05));
        existing.cart_total = grand;
        existing.total_amount = grand;
        if (t.customer_name && !existing.customer_name) existing.customer_name = t.customer_name;
      }
    }
    return Array.from(dedupedMap.values());
  }, [tables]);

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
    const items = extractOrderItems(t);
    const matchItems = items.some((it) => it.name && it.name.toLowerCase().includes(q));
    const matchWaiter = String(t.waiter_name || '').toLowerCase().includes(q);
    return matchTable || matchItems || matchWaiter;
  });

  // Filter recent orders by search query
  const filteredRecentOrders = allDepartmentOrders.filter((o) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    const orderNum = formatCleanOrderNumber(o);
    const matchNum = String(orderNum || o.id || '').toLowerCase().includes(q);
    const matchDest = String(o.table_number || o.customer_name || '').toLowerCase().includes(q);
    const items = extractOrderItems(o);
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
      await api.requestBillPrint(department, table.id, table);
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
      const rawRoomNum = isRS
        ? String(settleModalTable.table_number || '').replace(/^RS-/i, '').replace(/^Room\s*/i, '').replace(/•.*$/, '').trim()
        : '';

      // Extract items and calculate exact financial totals
      const items = extractOrderItems(settleModalTable);
      const subtotal = items.reduce((s, it) => s + ((Number(it.price) || 0) * (Number(it.qty || it.quantity) || 1)), 0);
      const gst = Math.round((subtotal * 5) / 100);
      const grand = Math.round(Number(settleModalTable.total_amount || settleModalTable.cart_total || (subtotal + gst)) || (subtotal + gst));

      let settlePayload;

      if (isRS) {
        // Room Service Order: 2 distinct options
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
            guest_phone: matchedRoom?.guest_phone || settleModalTable.customer_phone || '',
            items,
            subtotal,
            gst,
            grand_total: grand,
            total: grand,
            amount: grand
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
            guest_phone: matchedRoom?.guest_phone || settleModalTable.customer_phone || '',
            items,
            subtotal,
            gst,
            grand_total: grand,
            total: grand,
            amount: grand
          };
        }
      } else {
        // Dine-in table or parcel settlement
        settlePayload = {
          payment_method: paymentMode,
          payment_mode: paymentMode,
          waiter_name: myName,
          items,
          subtotal,
          gst,
          grand_total: grand,
          total: grand,
          amount: grand
        };

        if (paymentMode === 'room_folio') {
          if (!selectedRoomId) {
            setMsg('⚠️ Please select an occupied room for Room Folio settlement.');
            setTimeout(() => setMsg(''), 4000);
            setActionInProgress(null);
            return;
          }
          const roomObj = occupiedRooms.find(r => 
            String(r.room_number) === String(selectedRoomId) || 
            String(r.id) === String(selectedRoomId)
          );
          const targetRoomNumber = String(roomObj?.room_number || selectedRoomId).replace(/^RS-/i, '').replace(/^Room\s*/i, '').trim();
          const targetRoomId = roomObj?.room_id || (typeof roomObj?.id === 'number' ? roomObj.id : null);

          settlePayload.room_id = targetRoomId;
          settlePayload.room_number = targetRoomNumber;
          settlePayload.target_room_number = targetRoomNumber;
          settlePayload.charge_to_room = targetRoomNumber;
          settlePayload.is_paid = isPaidAtRoom ? 1 : 0;
          settlePayload.customer_name = roomObj?.guest_name 
            ? `Room ${targetRoomNumber} - ${roomObj.guest_name}`
            : `Room ${targetRoomNumber}`;
          if (roomObj?.guest_phone && roomObj.guest_phone !== '—') {
            settlePayload.guest_phone = roomObj.guest_phone;
          }
          settlePayload.special_notes = `Transferred from ${settleModalTable.table_number || settleModalTable.name || 'Table'} to Room ${targetRoomNumber}`;
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

      // Optimistically remove settled table from active list immediately (0ms instant response)
      if (typeof setTables === 'function') {
        setTables(prev => prev.filter(t => {
          const tClean = String(t.table_number || '').replace(/^RS-/i, '').replace(/^Room\s*/i, '').replace(/•.*$/, '').trim();
          if (String(t.id) === String(settleModalTable.id)) return false;
          if (t.table_number === settleModalTable.table_number) return false;
          if (rawRoomNum && tClean && tClean === rawRoomNum) return false;
          return true;
        }));
      }

      await api.settleTable(department, settleModalTable.id, settlePayload, settleModalTable);
      const targetDisplay = (paymentMode === 'room_folio' && settlePayload.room_number)
        ? `Order settled to Room ${settlePayload.room_number} successfully!`
        : `Order for ${settleModalTable.table_number || settleModalTable.name} settled successfully!`;
      setMsg(`✅ ${targetDisplay}`);
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
          <h2 style={{ fontSize: '1.10rem', fontWeight: 900, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.02em' }}>
            📋 My Orders
          </h2>
          <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', margin: '2px 0 0', fontWeight: 600 }}>
            Attended by: <strong style={{ color: 'var(--apple-blue)', fontWeight: 800 }}>{myName}</strong>
          </p>
        </div>

        <button
          type="button"
          onClick={onRefresh}
          disabled={isLoading}
          style={{
            padding: '6px 14px',
            borderRadius: 'var(--radius-sm, 10px)',
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-medium)',
            color: 'var(--text-primary)',
            fontSize: '0.76rem',
            fontWeight: 800,
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
            boxShadow: 'var(--shadow-subtle)',
            cursor: 'pointer',
            transition: 'all 0.15s ease'
          }}
        >
          <span>🔄</span>
          <span>Refresh</span>
        </button>
      </div>

      {/* Tabs: Active Running Orders vs All Punched Orders */}
      <div
        role="tablist"
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '4px',
          background: 'var(--bg-surface-secondary)',
          padding: '4px',
          borderRadius: 'var(--radius-sm, 12px)',
          border: '1px solid var(--border-light)',
          marginBottom: '10px'
        }}
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeSubTab === 'active'}
          onClick={() => setActiveSubTab('active')}
          style={{
            padding: '9px 12px',
            borderRadius: 'var(--radius-xs, 8px)',
            border: activeSubTab === 'active' ? '1px solid var(--border-medium)' : '1px solid transparent',
            background: activeSubTab === 'active' ? 'var(--bg-surface)' : 'transparent',
            color: activeSubTab === 'active' ? 'var(--text-primary)' : 'var(--text-secondary)',
            fontSize: '0.80rem',
            fontWeight: activeSubTab === 'active' ? 900 : 650,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            boxShadow: activeSubTab === 'active' ? 'var(--shadow-card)' : 'none',
            transition: 'all 0.18s cubic-bezier(0.16, 1, 0.3, 1)'
          }}
        >
          <span style={{ fontSize: '0.85rem' }}>🟢</span>
          <span>Active Running ({myActiveTables.length})</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeSubTab === 'recent'}
          onClick={() => setActiveSubTab('recent')}
          style={{
            padding: '9px 12px',
            borderRadius: 'var(--radius-xs, 8px)',
            border: activeSubTab === 'recent' ? '1px solid var(--border-medium)' : '1px solid transparent',
            background: activeSubTab === 'recent' ? 'var(--bg-surface)' : 'transparent',
            color: activeSubTab === 'recent' ? 'var(--text-primary)' : 'var(--text-secondary)',
            fontSize: '0.80rem',
            fontWeight: activeSubTab === 'recent' ? 900 : 650,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            boxShadow: activeSubTab === 'recent' ? 'var(--shadow-card)' : 'none',
            transition: 'all 0.18s cubic-bezier(0.16, 1, 0.3, 1)'
          }}
        >
          <span style={{ fontSize: '0.85rem' }}>📜</span>
          <span>All Orders ({allDepartmentOrders.length})</span>
        </button>
      </div>

      {/* Captain / Admin Floor Super-Filter */}
      {isManagerOrCaptain && activeSubTab === 'active' && (
        <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
          <button
            type="button"
            onClick={() => setCaptainViewMode('my')}
            style={{
              flex: 1,
              padding: '6px 10px',
              borderRadius: 'var(--radius-xs, 8px)',
              border: captainViewMode === 'my' ? '1.5px solid var(--apple-blue)' : '1px solid var(--border-medium)',
              background: captainViewMode === 'my' ? 'rgba(59, 130, 246, 0.12)' : 'var(--bg-surface)',
              color: captainViewMode === 'my' ? 'var(--apple-blue)' : 'var(--text-secondary)',
              fontSize: '0.74rem',
              fontWeight: 850,
              cursor: 'pointer'
            }}
          >
            👤 My Assigned Tables
          </button>
          <button
            type="button"
            onClick={() => setCaptainViewMode('all')}
            style={{
              flex: 1,
              padding: '6px 10px',
              borderRadius: 'var(--radius-xs, 8px)',
              border: captainViewMode === 'all' ? '1.5px solid var(--apple-blue)' : '1px solid var(--border-medium)',
              background: captainViewMode === 'all' ? 'rgba(59, 130, 246, 0.12)' : 'var(--bg-surface)',
              color: captainViewMode === 'all' ? 'var(--apple-blue)' : 'var(--text-secondary)',
              fontSize: '0.74rem',
              fontWeight: 850,
              cursor: 'pointer'
            }}
          >
            🛡️ All Floor Tables ({tables.filter(t => (t.status !== 'available' && t.status !== '') || (t.cart && t.cart.length > 0)).length})
          </button>
        </div>
      )}

      {/* Search Input */}
      <div style={{ marginBottom: '10px', position: 'relative' }}>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search orders by table, #, or dish..."
          style={{
            width: '100%',
            height: '40px',
            padding: '0 12px 0 36px',
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-medium)',
            borderRadius: 'var(--radius-sm, 10px)',
            color: 'var(--text-primary)',
            fontSize: '0.84rem',
            fontWeight: 600,
            outline: 'none',
            boxSizing: 'border-box',
            boxShadow: 'var(--shadow-subtle)'
          }}
        />
        <span style={{ position: 'absolute', left: '11px', top: '50%', transform: 'translateY(-50%)', opacity: 0.5, fontSize: '0.90rem' }}>
          🔍
        </span>
      </div>

      {msg && (
        <div
          style={{
            padding: '9px 14px',
            borderRadius: 'var(--radius-sm, 10px)',
            background: 'var(--apple-green-subtle)',
            border: '1px solid var(--apple-green)',
            color: 'var(--apple-green)',
            fontSize: '0.80rem',
            fontWeight: 800,
            marginBottom: '10px'
          }}
        >
          {msg}
        </div>
      )}

      {/* Main List with ample bottom padding so Netlify badge never covers cards */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', paddingBottom: '120px' }}>
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
                borderRadius: 'var(--radius-md, 14px)',
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
              const items = extractOrderItems(t);
              const subtotal = items.reduce((s, it) => s + ((Number(it.price) || 0) * (Number(it.qty || it.quantity) || 1)), 0);
              const gst = Math.round((subtotal * 5) / 100);
              const grand = Math.round(t.total_amount || t.cart_total || (subtotal + gst));
              const isBilled = t.status === 'billed';

              const rawDest = String(t.table_number || `Table ${t.id}`);
              const cleanDest = rawDest.replace(/•.*$/, '').trim();
              const guestSubtitle = t.customer_name || (rawDest.includes('•') ? rawDest.split('•')[1]?.trim() : '');

              return (
                <div
                  key={t.id}
                  onClick={() => setSelectedOrder({ type: 'table', data: t })}
                  style={{
                    background: 'var(--bg-surface)',
                    border: isBilled ? '1.5px solid var(--apple-red)' : '1px solid var(--border-medium)',
                    borderRadius: 'var(--radius-md, 14px)',
                    padding: '13px 14px',
                    boxShadow: 'var(--shadow-card, 0 2px 10px rgba(0,0,0,0.04))',
                    cursor: 'pointer',
                    transition: 'all 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '9px'
                  }}
                  title="Click to view full order details & cancel options"
                >
                  {/* Table Header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div
                        style={{
                          width: '38px',
                          height: '38px',
                          borderRadius: 'var(--radius-sm, 10px)',
                          background: 'var(--bg-surface-secondary)',
                          border: '1px solid var(--border-light)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '1.25rem',
                          flexShrink: 0
                        }}
                      >
                        {isBar ? '🍸' : '🍽️'}
                      </div>
                      <div>
                        <div style={{ fontSize: '1.02rem', fontWeight: 900, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
                          {cleanDest}
                        </div>
                        {guestSubtitle ? (
                          <div style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--apple-blue)', marginTop: '1px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span>👤</span>
                            <span>{guestSubtitle}</span>
                          </div>
                        ) : null}
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', marginTop: '2px', fontWeight: 600 }}>
                          Token #{t.token_number || 1} • KOT #{t.kot_count || t.bot_count || 1}
                          {t.order_started_at && ` • 🕒 ${new Date(t.order_started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
                          {t.waiter_name && ` • 👤 ${t.waiter_name}`}
                        </div>
                      </div>
                    </div>

                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <span
                        style={{
                          display: 'inline-block',
                          fontSize: '0.64rem',
                          fontWeight: 900,
                          padding: '2px 8px',
                          borderRadius: '999px',
                          background: isBilled ? 'var(--apple-red-subtle)' : 'rgba(22, 163, 74, 0.12)',
                          color: isBilled ? 'var(--apple-red)' : '#16a34a',
                          border: isBilled ? '1px solid var(--apple-red)' : '1px solid rgba(22, 163, 74, 0.3)',
                          textTransform: 'uppercase',
                          letterSpacing: '0.04em'
                        }}
                      >
                        {isBilled ? '🧾 BILLED' : '🟢 RUNNING'}
                      </span>
                      <div style={{ fontSize: '1.12rem', fontWeight: 900, color: 'var(--text-primary)', marginTop: '3px', letterSpacing: '-0.02em' }}>
                        ₹{grand.toLocaleString('en-IN')}
                      </div>
                    </div>
                  </div>

                  {/* Quick Items Preview */}
                  <div
                    style={{
                      background: 'var(--bg-surface-secondary)',
                      borderRadius: 'var(--radius-sm, 10px)',
                      padding: '7px 10px',
                      border: '1px solid var(--border-light)'
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
                            alignItems: 'center',
                            fontSize: '0.78rem',
                            color: 'var(--text-primary)',
                            padding: '4px 0',
                            borderBottom: idx < items.length - 1 ? '1px solid var(--border-light)' : 'none'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span
                              style={{
                                background: 'var(--bg-surface)',
                                border: '1px solid var(--border-medium)',
                                padding: '1px 5px',
                                borderRadius: '4px',
                                fontSize: '0.70rem',
                                fontWeight: 900
                              }}
                            >
                              {it.qty || it.quantity || 1}×
                            </span>
                            <span style={{ fontWeight: 700 }}>{it.name}</span>
                            {it.added_at && (
                              <span style={{ fontSize: '0.64rem', color: 'var(--text-tertiary)' }}>
                                🕒 {new Date(it.added_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            )}
                          </div>
                          <span style={{ color: 'var(--text-secondary)', fontWeight: 800 }}>
                            ₹{((Number(it.price) || 0) * (Number(it.qty || it.quantity) || 1)).toLocaleString('en-IN')}
                          </span>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Actions for this table */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px', marginTop: '2px' }}>
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
                        height: '36px',
                        padding: '0 4px',
                        borderRadius: 'var(--radius-xs, 8px)',
                        background: 'var(--bg-surface-secondary)',
                        border: '1px solid var(--border-medium)',
                        color: 'var(--text-primary)',
                        fontSize: '0.72rem',
                        fontWeight: 800,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '3px'
                      }}
                    >
                      <span>+</span>
                      <span>Items</span>
                    </button>

                    <button
                      type="button"
                      disabled={actionInProgress === `print-${t.id}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePrintPrebill(t);
                      }}
                      style={{
                        height: '36px',
                        padding: '0 4px',
                        borderRadius: 'var(--radius-xs, 8px)',
                        background: 'var(--bg-surface-secondary)',
                        border: '1px solid var(--border-medium)',
                        color: 'var(--apple-blue)',
                        fontSize: '0.72rem',
                        fontWeight: 800,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '3px'
                      }}
                    >
                      <span>🧾</span>
                      <span>{actionInProgress === `print-${t.id}` ? '...' : 'Pre-Bill'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        const isRoom = t.table_type === 'room_service' || String(t.table_number || '').startsWith('RS-');
                        const rawNum = String(t.table_number || '').replace(/^RS-/i, '').replace(/^Room\s*/i, '').replace(/•.*$/, '').trim();
                        if (isRoom && rawNum) setSelectedRoomId(rawNum);
                        else setSelectedRoomId('');
                        setSettleModalTable(t);
                      }}
                      style={{
                        height: '36px',
                        padding: '0 4px',
                        borderRadius: 'var(--radius-xs, 8px)',
                        background: '#16a34a',
                        border: 'none',
                        color: '#ffffff',
                        fontSize: '0.74rem',
                        fontWeight: 900,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '4px',
                        boxShadow: '0 2px 6px rgba(22, 163, 74, 0.3)'
                      }}
                    >
                      <span>💵</span>
                      <span>Settle</span>
                    </button>

                    {/* Cancel Table Order Button */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setOrderToCancel({ type: 'table', target: t });
                      }}
                      style={{
                        height: '36px',
                        padding: '0 4px',
                        borderRadius: 'var(--radius-xs, 8px)',
                        background: 'var(--apple-red-subtle)',
                        border: '1px solid rgba(220, 38, 38, 0.25)',
                        color: 'var(--apple-red)',
                        fontSize: '0.72rem',
                        fontWeight: 800,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '3px'
                      }}
                    >
                      <span>❌</span>
                      <span>Cancel</span>
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
              const items = extractOrderItems(o);
              const orderNum = formatCleanOrderNumber(o);

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
                          #{orderNum}
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
                      <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', marginTop: '2px', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '5px' }}>
                        <strong style={{ color: 'var(--text-primary)' }}>{o.table_number || o.customer_name || 'Counter'}</strong>
                        {o.room_number && (
                          <span style={{
                            background: 'rgba(59, 130, 246, 0.12)',
                            color: 'var(--apple-blue)',
                            fontWeight: 850,
                            fontSize: '0.68rem',
                            padding: '1px 6px',
                            borderRadius: '4px',
                            border: '1px solid rgba(59, 130, 246, 0.3)'
                          }}>
                            🛏️ Room {o.room_number}
                          </span>
                        )}
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
                            label: o.table_number || `Order #${orderNum}`,
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

                  {/* Items preview snippet with timestamps */}
                  {items.length > 0 && (
                    <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', marginTop: '8px', borderTop: '1px solid var(--border-light)', paddingTop: '6px' }}>
                      {items.map((it, idx) => (
                        <span key={idx} style={{ display: 'inline-block', marginRight: '8px', color: 'var(--text-primary)', fontWeight: 650 }}>
                          {it.qty || it.quantity || 1}x {it.name}
                          {it.added_at && (
                            <span style={{ fontSize: '0.64rem', color: 'var(--text-tertiary)', marginLeft: '4px' }}>
                              (🕒 {new Date(it.added_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})
                            </span>
                          )}
                        </span>
                      ))}
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
              maxWidth: '430px',
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
                    : `Order #${formatCleanOrderNumber(selectedOrder.data)}`}
                </h3>
                <div style={{ fontSize: '0.70rem', color: 'var(--text-secondary)', marginTop: '2px', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '5px' }}>
                  <span>
                    {selectedOrder.type === 'table'
                      ? `Token #${selectedOrder.data.token_number || 1} • KOT #${selectedOrder.data.kot_count || 1}`
                      : `Settled • ${selectedOrder.data.payment_mode || selectedOrder.data.payment_method || 'Order'}`}
                  </span>
                  {selectedOrder.data.room_number && (
                    <span style={{
                      background: 'rgba(59, 130, 246, 0.12)',
                      color: 'var(--apple-blue)',
                      fontWeight: 850,
                      padding: '1px 5px',
                      borderRadius: '4px',
                      border: '1px solid rgba(59, 130, 246, 0.3)'
                    }}>
                      🛏️ Room {selectedOrder.data.room_number}
                    </span>
                  )}
                  {(selectedOrder.data.order_started_at || selectedOrder.data.created_at) && (
                    <span>• 🕒 {new Date(selectedOrder.data.order_started_at || selectedOrder.data.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  )}
                  {selectedOrder.data.waiter_name && <span>• 👤 {selectedOrder.data.waiter_name}</span>}
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
            <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px' }}>
              <div style={{ fontSize: '0.70rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '8px' }}>
                All Order Dishes &amp; Items:
              </div>

              {/* 4 Column Header: Dish, Price, Quantity, Amount */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '2.1fr 0.9fr 0.7fr 1.1fr',
                  gap: '6px',
                  padding: '6px 4px',
                  background: 'var(--bg-surface-secondary)',
                  borderRadius: 'var(--radius-xs)',
                  borderBottom: '2px solid var(--border-medium)',
                  fontSize: '0.68rem',
                  fontWeight: 900,
                  color: 'var(--text-secondary)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px'
                }}
              >
                <div>Dish</div>
                <div style={{ textAlign: 'right' }}>Price</div>
                <div style={{ textAlign: 'center' }}>Qty</div>
                <div style={{ textAlign: 'right' }}>Amount</div>
              </div>

              {(() => {
                const items = extractOrderItems(selectedOrder.data);

                if (items.length === 0) {
                  return (
                    <div style={{ padding: '20px 0', textAlign: 'center', fontSize: '0.80rem', color: 'var(--text-tertiary)' }}>
                      No items found.
                    </div>
                  );
                }

                return items.map((it, idx) => {
                  const itemQty = Number(it.qty || it.quantity) || 1;
                  const itemPrice = Number(it.price) || 0;
                  const itemAmount = itemPrice * itemQty;

                  return (
                    <div
                      key={idx}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '2.1fr 0.9fr 0.7fr 1.1fr',
                        gap: '6px',
                        alignItems: 'center',
                        padding: '9px 4px',
                        borderBottom: '1px solid var(--border-light)',
                        fontSize: '0.78rem'
                      }}
                    >
                      {/* Dish Column */}
                      <div style={{ minWidth: 0, paddingRight: '4px' }}>
                        <div style={{ fontWeight: 800, color: 'var(--text-primary)', wordBreak: 'break-word', lineHeight: 1.25 }}>
                          {it.name}
                        </div>
                        {(it.added_at || it.time) && (
                          <div style={{ fontSize: '0.64rem', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                            🕒 Added at {new Date(it.added_at || it.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        )}
                        {it.notes && (
                          <div style={{ fontSize: '0.66rem', color: 'var(--apple-orange)', fontStyle: 'italic', marginTop: '1px' }}>
                            Note: {it.notes}
                          </div>
                        )}
                      </div>

                      {/* Price Column */}
                      <div style={{ textAlign: 'right', color: 'var(--text-secondary)', fontWeight: 700 }}>
                        ₹{itemPrice.toLocaleString('en-IN')}
                      </div>

                      {/* Quantity Column */}
                      <div style={{ textAlign: 'center', fontWeight: 850, color: 'var(--text-primary)' }}>
                        {itemQty}
                      </div>

                      {/* Amount Column */}
                      <div style={{ textAlign: 'right', fontWeight: 900, color: 'var(--text-primary)' }}>
                        ₹{itemAmount.toLocaleString('en-IN')}
                      </div>
                    </div>
                  );
                });
              })()}

              {/* Bill Summary: Sub Total, GST Charges, Total Payable */}
              {(() => {
                const items = extractOrderItems(selectedOrder.data);
                const subtotal = items.reduce((s, it) => s + ((Number(it.price) || 0) * (Number(it.qty || it.quantity) || 1)), 0);
                const gst = Math.round((subtotal * 5) / 100);
                const totalPayable = selectedOrder.type === 'table'
                  ? (Number(selectedOrder.data.total_amount || selectedOrder.data.cart_total) || Math.round(subtotal + gst))
                  : (Number(selectedOrder.data.grand_total || selectedOrder.data.total) || Math.round(subtotal + gst));

                return (
                  <div style={{ marginTop: '14px', paddingTop: '10px', borderTop: '2px dashed var(--border-medium)' }}>
                    {/* Sub Total */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.80rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                      <span style={{ fontWeight: 700 }}>Sub Total:</span>
                      <span style={{ fontWeight: 800, color: 'var(--text-primary)' }}>₹{subtotal.toLocaleString('en-IN')}</span>
                    </div>

                    {/* GST Charges (5%) */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.80rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>
                      <span style={{ fontWeight: 700 }}>GST Charges (5%):</span>
                      <span style={{ fontWeight: 800, color: 'var(--text-primary)' }}>₹{gst.toLocaleString('en-IN')}</span>
                    </div>

                    {/* Total Payable */}
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        paddingTop: '8px',
                        borderTop: '1.5px solid var(--border-medium)',
                        fontSize: '1rem',
                        fontWeight: 900,
                        color: 'var(--text-primary)'
                      }}
                    >
                      <span>Total Payable:</span>
                      <span style={{ color: 'var(--apple-blue)', fontSize: '1.14rem', fontWeight: 950 }}>
                        ₹{totalPayable.toLocaleString('en-IN')}
                      </span>
                    </div>
                  </div>
                );
              })()}
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
              const settleItems = extractOrderItems(settleModalTable);
              const settleSubtotal = settleModalTable.cart_total || settleItems.reduce((s, it) => s + ((Number(it.price) || 0) * (it.qty || it.quantity || 1)), 0);
              const settleGst = Math.round((settleSubtotal * 5) / 100);
              const settleGrand = Math.round(Number(settleModalTable.total_amount || (settleSubtotal + settleGst)) || (settleSubtotal + settleGst));

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
                  {paymentMode === 'room_folio' && (() => {
                    const selectedRoomObj = occupiedRooms.find(r => 
                      String(r.room_number) === String(selectedRoomId) || 
                      String(r.id) === String(selectedRoomId)
                    );
                    return (
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
                            border: '1.5px solid var(--border-medium)',
                            background: 'var(--bg-surface)',
                            color: 'var(--text-primary)',
                            fontSize: '0.84rem',
                            fontWeight: 700,
                            marginBottom: '10px'
                          }}
                        >
                          <option value="">-- Choose Occupied Room ({occupiedRooms.length} available) --</option>
                          {occupiedRooms.map((r) => (
                            <option key={r.room_number || r.id} value={r.room_number}>
                              Room {r.room_number} {r.guest_name ? `• ${r.guest_name}` : ''}
                            </option>
                          ))}
                        </select>

                        {/* Prominent Selected Room Confirmation Card */}
                        {selectedRoomObj && (
                          <div style={{
                            background: 'rgba(59, 130, 246, 0.12)',
                            border: '1.5px solid var(--apple-blue)',
                            borderRadius: 'var(--radius-xs, 8px)',
                            padding: '8px 10px',
                            marginBottom: '12px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px'
                          }}>
                            <div style={{
                              background: 'var(--apple-blue)',
                              color: '#ffffff',
                              padding: '5px 8px',
                              borderRadius: '5px',
                              fontWeight: 900,
                              fontSize: '0.86rem',
                              letterSpacing: '0.02em',
                              flexShrink: 0
                            }}>
                              ROOM {selectedRoomObj.room_number}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: 850, fontSize: '0.85rem', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {selectedRoomObj.guest_name || 'In-House Guest'}
                              </div>
                              <div style={{ fontSize: '0.70rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                                📞 {selectedRoomObj.guest_phone || selectedRoomObj.guest_mobile || 'No mobile stored'}
                              </div>
                            </div>
                          </div>
                        )}

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
                  );
                })()}

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
