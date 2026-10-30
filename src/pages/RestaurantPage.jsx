import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';
import { useApp } from '../context/AppContext';
import TableCard from '../components/restaurant/TableCard';
import TableSessionView from '../components/restaurant/TableSessionView';
import TableSettleModal from '../components/restaurant/TableSettleModal';
import SettledBillsView from '../components/restaurant/SettledBillsView';
import RoomServiceChooserModal from '../components/restaurant/RoomServiceChooserModal';
import PosManagerPanel from '../components/restaurant/PosManagerPanel';
import StaffLittleBadge from '../components/common/StaffLittleBadge';
import GuestOrderAcceptModal from '../components/restaurant/GuestOrderAcceptModal';
import { startContinuousOrderAlert, stopContinuousOrderAlert } from '../utils/audioAlert';
import { printKOTSlip, printPreBillSlip, printThermalBillSlip } from '../services/printService';
import { socketClient } from '../services/socketClient';

export default function RestaurantPage({ onPrintKOTSlip, onPrintBillSlip }) {
  const { showToast, setActivePanel, currentUser, restaurantSubTab, setRestaurantSubTab, setIsFnbCashHandoverOpen } = useApp();

  const activeSubTab = restaurantSubTab || 'tables';
  const setActiveSubTab = setRestaurantSubTab || (() => {});
  const [tables, setTables] = useState([]);
  const [menu, setMenu] = useState([]);
  const [categories, setCategories] = useState([]);
  const [occupiedRooms, setOccupiedRooms] = useState([]);
  const [activeSessionTable, setActiveSessionTable] = useState(null);
  const [settleSession, setSettleSession] = useState(null);
  const [isRoomChooserOpen, setIsRoomChooserOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [clockStr, setClockStr] = useState('');
  const [pendingGuestOrders, setPendingGuestOrders] = useState([]);
  const [activeAlertOrder, setActiveAlertOrder] = useState(null);
  const [isAcceptingOrder, setIsAcceptingOrder] = useState(false);

  // Automatically close active session when switching subtabs from header
  useEffect(() => {
    if (activeSubTab !== 'tables') {
      setActiveSessionTable(null);
    }
  }, [activeSubTab]);

  // Live Digital Clock for POS Header
  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      setClockStr(now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }));
    };
    updateClock();
    const timer = setInterval(updateClock, 1000);
    return () => clearInterval(timer);
  }, []);

  const handleOpenRoomChooser = async () => {
    try {
      const roomsData = await api.getRooms();
      const roomList = Array.isArray(roomsData) ? roomsData : (roomsData?.rooms || []);
      let occ = roomList.filter((r) => r.status === 'occupied');
      if (occ.length === 0) {
        try {
          const occData = await api.getOccupiedRooms();
          const cloudOcc = Array.isArray(occData) ? occData : (occData?.rooms || []);
          if (cloudOcc.length > 0) occ = cloudOcc;
        } catch (_) {}
      }
      setOccupiedRooms(occ);
    } catch (e) {
      console.warn('Error refreshing occupied rooms:', e);
    }
    setIsRoomChooserOpen(true);
  };


  useEffect(() => {
    if (settleSession || isRoomChooserOpen) {
      document.documentElement.classList.add('modal-open');
      document.body.classList.add('modal-open');
    } else {
      document.documentElement.classList.remove('modal-open');
      document.body.classList.remove('modal-open');
    }
    return () => {
      document.documentElement.classList.remove('modal-open');
      document.body.classList.remove('modal-open');
    };
  }, [settleSession, isRoomChooserOpen]);

  const loadTables = useCallback(async (isSilent = false) => {
    if (!isSilent) setIsLoading(true);
    try {
      const data = await api.getRestaurantTables();
      const list = Array.isArray(data) ? data : (data?.tables || []);
      setTables(list);
      // Keep active table session in sync with fresh database updates
      setActiveSessionTable(curr => {
        if (!curr) return null;
        const fresh = list.find(t => t.id === curr.id || t.table_number === curr.table_number);
        if (!fresh) return null;
        return fresh;
      });
    } catch (err) {
      if (!isSilent) showToast('Error loading restaurant tables: ' + err.message, 'red');
    } finally {
      if (!isSilent) setIsLoading(false);
    }
  }, [showToast]);

  const loadMenuAndCategories = useCallback(async () => {
    try {
      const [menuData, roomsData] = await Promise.all([
        api.getRestaurantMenu(),
        api.getRooms()
      ]);
      const menuList = Array.isArray(menuData) ? menuData : (menuData?.items || menuData?.dishes || []);
      setMenu(menuList);
      const dbCats = Array.isArray(menuData?.categories) ? menuData.categories : [];
      const itemCatNames = Array.from(new Set(menuList.map((d) => d.category).filter(Boolean)));
      const combinedCats = [...dbCats];
      for (const catName of itemCatNames) {
        if (!combinedCats.some((c) => String(c.name || '').toLowerCase() === String(catName).toLowerCase())) {
          combinedCats.push({ id: catName, name: catName });
        }
      }
      setCategories(combinedCats);

      const roomList = Array.isArray(roomsData) ? roomsData : (roomsData?.rooms || []);
      let occ = roomList.filter((r) => r.status === 'occupied');
      if (occ.length === 0) {
        try {
          const occData = await api.getOccupiedRooms();
          const cloudOcc = Array.isArray(occData) ? occData : (occData?.rooms || []);
          if (cloudOcc.length > 0) occ = cloudOcc;
        } catch (_) {}
      }
      setOccupiedRooms(occ);
    } catch (e) {
      console.warn('Error loading menu or rooms:', e);
    }
  }, []);

  const checkPendingGuestOrders = useCallback(async () => {
    try {
      const res = await api.getGuestPendingOrders();
      const orders = Array.isArray(res) ? res : (res?.orders || []);
      setPendingGuestOrders(orders);
      if (orders.length > 0) {
        setActiveAlertOrder((prev) => {
          if (prev && orders.some((o) => o.id === prev.id)) {
            return orders.find((o) => o.id === prev.id);
          }
          startContinuousOrderAlert();
          return orders[0];
        });
      } else {
        stopContinuousOrderAlert();
        setActiveAlertOrder(null);
      }
    } catch (_) {}
  }, []);

  const handleAcceptGuestOrder = async (order) => {
    if (!order || isAcceptingOrder) return;
    setIsAcceptingOrder(true);
    try {
      const res = await api.acceptGuestOrder(order.id, currentUser?.full_name || 'Kitchen Staff');
      stopContinuousOrderAlert();
      if (res?.kotPayload) {
        if (onPrintKOTSlip) onPrintKOTSlip(res.kotPayload);
        else printKOTSlip(res.kotPayload, res.kotPayload.tableNumber, res.kotPayload.waiterName, res.kotPayload.notes);
      }
      showToast(`✓ Order for Room ${order.room_numbers} accepted & KOT printed!`, 'green');
      await checkPendingGuestOrders();
      loadTables(true);
      setActiveAlertOrder(null);
    } catch (err) {
      showToast('Error accepting order: ' + err.message, 'red');
    } finally {
      setIsAcceptingOrder(false);
    }
  };

  const [isCancellingOrder, setIsCancellingOrder] = useState(false);

  const handleCancelGuestOrder = async (order, reason = 'restaurant_closed') => {
    if (!order || isCancellingOrder) return;
    setIsCancellingOrder(true);
    try {
      await api.cancelGuestOrder(order.id, reason, currentUser?.full_name || 'Restaurant Staff');
      stopContinuousOrderAlert();
      showToast(`✓ Order for Room ${order.room_numbers} cancelled (${reason === 'restaurant_closed' ? 'Restaurant Closed' : reason})`, 'amber');
      await checkPendingGuestOrders();
      setActiveAlertOrder(null);
    } catch (err) {
      showToast('Error cancelling order: ' + err.message, 'red');
    } finally {
      setIsCancellingOrder(false);
    }
  };

  useEffect(() => {
    loadTables();
    loadMenuAndCategories();
    checkPendingGuestOrders();

    // 1. Instant real-time updates via WebSockets
    const unsubTables = socketClient.on('TABLES_UPDATED', (payload) => {
      loadTables(true);
      if (payload && payload.tableNumber) {
        const orderNotice = payload.action === 'cancel'
          ? `🗑️ Table ${payload.tableNumber} cancelled`
          : (payload.status === 'billed'
            ? `🧾 Pre-bill requested: ${payload.tableNumber}`
            : (payload.orderType === 'room'
              ? `🛎️ Room Service order: ${payload.tableNumber}`
              : (payload.orderType === 'parcel'
                ? `📦 Takeaway Parcel: ${payload.tableNumber}`
                : `🛎️ Table ${payload.tableNumber} updated`)));
        showToast(payload.waiterName ? `${orderNotice} (${payload.waiterName})` : orderNotice, 'info', 3000);
      }
    });

    const unsubOrders = socketClient.on('GUEST_ORDERS_UPDATED', () => {
      checkPendingGuestOrders();
    });

    const unsubRooms = socketClient.on('ROOMS_UPDATED', () => {
      loadMenuAndCategories();
    });

    // 2. Continuous real-time background sync (Never freezes when table is open!)
    const interval = setInterval(() => {
      loadTables(true);
      checkPendingGuestOrders();
    }, 8000);

    return () => {
      unsubTables();
      unsubOrders();
      unsubRooms();
      clearInterval(interval);
      stopContinuousOrderAlert();
    };
  }, [loadTables, loadMenuAndCategories, checkPendingGuestOrders]);

  // Separate Dine-In, Room Service, and Parcels
  const dineinTables = tables.filter(
    (t) => t.table_type !== 'parcel' && t.table_type !== 'room_service' && !t.is_parcel && !t.is_takeaway && !String(t.table_number || '').startsWith('RS-')
  );
  const dineInTables = dineinTables;
  const roomServiceTables = tables.filter((t) => {
    const isRS = t.table_type === 'room_service' || String(t.table_number || '').startsWith('RS-');
    if (!isRS) return false;
    const hasItems = Array.isArray(t.cart) && t.cart.length > 0;
    return hasItems || t.status === 'occupied' || t.status === 'billed' || (t.id === activeSessionTable?.id);
  });
  const parcelTables = tables.filter((t) => {
    const isP = t.table_type === 'parcel' || t.is_parcel || t.is_takeaway;
    if (!isP) return false;
    const hasItems = Array.isArray(t.cart) && t.cart.length > 0;
    return hasItems || t.status === 'occupied' || t.status === 'billed' || t.status === 'ready' || (t.id === activeSessionTable?.id);
  });

  // Start Room Service Order for Selected Room
  const handleSelectRoomService = async (room, existingTable) => {
    if (existingTable) {
      setActiveSessionTable(existingTable);
      return;
    }
    try {
      const res = await api.saveRestaurantTable({
        table_number: `RS-${room.room_number}`,
        table_type: 'room_service',
        capacity: 2,
        room_id: room.id,
        special_notes: `Room ${room.room_number} (${room.guest_name || 'Guest'})`
      });
      const newTable = res.table || {
        id: res.tableId,
        table_number: `RS-${room.room_number}`,
        table_type: 'room_service',
        status: 'in_process',
        room_id: room.id,
        special_notes: `Room ${room.room_number} (${room.guest_name || 'Guest'})`
      };
      await loadTables(true);
      setActiveSessionTable(newTable);
    } catch (err) {
      showToast('Error opening Room Service: ' + err.message, 'red');
    }
  };

  // Create New Takeaway Parcel Order
  const handleCreateParcel = async () => {
    try {
      const existingNums = parcelTables.map((t) => {
        const m = String(t.table_number || '').match(/\d+/);
        return m ? parseInt(m[0], 10) : 0;
      });
      const nextNum = existingNums.length > 0 ? Math.max(...existingNums) + 1 : 1;
      const res = await api.saveRestaurantTable({
        table_number: `P-${nextNum}`,
        table_type: 'parcel',
        capacity: 1,
        special_notes: `Takeaway Parcel #${nextNum}`
      });
      const newTable = res.table || {
        id: res.tableId,
        table_number: `P-${nextNum}`,
        table_type: 'parcel',
        status: 'in_process'
      };
      await loadTables(true);
      setActiveSessionTable(newTable);
    } catch (err) {
      showToast('Error creating Parcel: ' + err.message, 'red');
    }
  };

  // Status Change Handler (e.g. In Process -> Ready)
  const handleTableStatusChange = async (table, nextStatus) => {
    try {
      await api.updateRestaurantTableStatus(table.id, nextStatus);
      showToast(`Status updated to ${nextStatus.toUpperCase()}`, 'info', 2000);
      loadTables(true);
    } catch (err) {
      showToast('Error updating status: ' + err.message, 'red');
    }
  };

  // Direct Settle Billing Trigger (to ready -> directly go on billing page)
  const handleOpenSettle = (table) => {
    const isRS = table.table_type === 'room_service' || String(table.table_number || '').startsWith('RS-');
    let rId = table.room_id || null;
    if (!rId && isRS) {
      const rNum = String(table.table_number || '').replace(/^RS-/i, '').trim();
      const matched = occupiedRooms.find((r) => String(r.room_number) === rNum);
      if (matched) rId = matched.id;
    }

    setSettleSession({
      table,
      cart: table.cart || [],
      subtotal: table.cart_total || 0,
      gst: Math.round((table.cart_total || 0) * 0.05),
      grandTotal: (table.cart_total || 0) + Math.round((table.cart_total || 0) * 0.05),
      chargeToRoomId: rId
    });
  };

  return (
    <section
      className="panel-view active"
      id="view-restaurant"
      style={{
        height: '100%',
        maxHeight: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}
    >
      {/* Real-time In-Room Guest Food Order Alert Banner */}
      {pendingGuestOrders.length > 0 && (
        <div
          onClick={() => {
            if (!activeAlertOrder) {
              startContinuousOrderAlert();
              setActiveAlertOrder(pendingGuestOrders[0]);
            }
          }}
          style={{
            backgroundColor: '#fef3c7',
            borderBottom: '2px solid #f59e0b',
            padding: '10px 20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            cursor: 'pointer',
            boxShadow: '0 2px 4px rgba(245, 158, 11, 0.15)',
            zIndex: 10
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '1.2rem', animation: 'pulse 1s infinite alternate' }}>🛎️</span>
            <div>
              <strong style={{ color: '#92400e', fontSize: '0.92rem' }}>
                {pendingGuestOrders.length} In-Room Food Order{pendingGuestOrders.length > 1 ? 's' : ''} Pending Kitchen Acceptance!
              </strong>
              <div style={{ fontSize: '0.75rem', color: '#b45309' }}>
                Room {pendingGuestOrders.map(o => o.room_numbers).join(', ')} • Beep alarm active • Click to view
              </div>
            </div>
          </div>
          <button
            style={{
              backgroundColor: '#d97706',
              color: '#ffffff',
              border: 'none',
              padding: '6px 14px',
              borderRadius: '8px',
              fontWeight: 800,
              fontSize: '0.82rem',
              cursor: 'pointer'
            }}
          >
            Review & Accept ({pendingGuestOrders.length})
          </button>
        </div>
      )}

      {activeSubTab === 'tables' && (
        <div
          className="rest-sub-content active"
          id="rest-subview-tables"
          style={{
            flex: '1 1 auto',
            minHeight: 0,
            height: '100%',
            maxHeight: '100%',
            overflow: activeSessionTable ? 'hidden' : 'auto',
            display: 'flex',
            flexDirection: 'column'
          }}
        >
          {!activeSessionTable ? (
            <div id="rest-floor-view">
              {/* 1. Dine-In Tables Section */}
              <div className="floor-section-card">
                <div className="floor-section-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '1.3rem' }}>🍽️</span>
                    <h3 style={{ margin: 0, fontSize: '1.08rem', fontWeight: 800 }}>Dine-In Tables</h3>
                  </div>
                </div>
                <div
                  className="tables-grid"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                    gap: '14px'
                  }}
                >
                  {dineinTables.length === 0 ? (
                    <div
                      style={{
                        padding: '24px 18px',
                        textAlign: 'center',
                        background: 'var(--bg-surface-secondary, #f8fafc)',
                        borderRadius: '14px',
                        border: '1.5px dashed var(--border-medium, #cbd5e1)',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        minHeight: '136px'
                      }}
                    >
                      <div style={{ fontSize: '1.6rem', marginBottom: '4px' }}>🍽️</div>
                      <div style={{ fontSize: '0.86rem', fontWeight: 700, color: 'var(--text-primary, #334155)' }}>No Dine-In Tables Yet</div>
                      <small style={{ color: 'var(--text-secondary, #64748b)', fontSize: '0.74rem', marginTop: '2px', marginBottom: '8px' }}>
                        Add tables manually in POS Manager
                      </small>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => setActiveSubTab('manager')}
                        style={{ fontSize: '0.76rem', padding: '4px 12px', borderRadius: '8px', cursor: 'pointer' }}
                      >
                        Open POS Manager ⚙️
                      </button>
                    </div>
                  ) : (
                    dineinTables.map((t) => (
                      <TableCard
                        key={t.id}
                        table={t}
                        onClick={setActiveSessionTable}
                        onStatusChange={handleTableStatusChange}
                        onSettle={handleOpenSettle}
                        department="restaurant"
                      />
                    ))
                  )}
                </div>
              </div>

              {/* 2. Room Service Section (Directly ABOVE Parcels) */}
              <div className="floor-section-card" style={{ marginTop: '24px' }}>
                <div className="floor-section-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '1.3rem' }}>🛎️</span>
                    <h3 style={{ margin: 0, fontSize: '1.08rem', fontWeight: 800 }}>Room Service</h3>
                  </div>
                </div>

                <div
                  className="tables-grid"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                    gap: '14px'
                  }}
                >
                  {roomServiceTables.map((t) => (
                    <TableCard
                      key={t.id}
                      table={t}
                      onClick={setActiveSessionTable}
                      onStatusChange={handleTableStatusChange}
                      onSettle={handleOpenSettle}
                      department="restaurant"
                    />
                  ))}

                  {/* Quick Add Dotted Card for Room Service */}
                  <div
                    className="table-card-dotted add-action-card"
                    onClick={handleOpenRoomChooser}
                    style={{
                      border: '2.5px dashed #93c5fd',
                      background: '#f8fbff',
                      borderRadius: '16px',
                      padding: '16px',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      textAlign: 'center',
                      minHeight: '136px',
                      transition: 'all 0.15s ease'
                    }}
                    title="Click to take Room Service order for an occupied room"
                  >
                    <div style={{ fontSize: '1.8rem', color: '#0071e3', marginBottom: '4px' }}>🛎️ +</div>
                    <div style={{ fontWeight: 800, color: '#0071e3', fontSize: '0.86rem' }}>+ Order Room Service</div>
                    <small style={{ color: '#64748b', fontSize: '0.72rem', marginTop: '2px' }}>Pick from Occupied Rooms</small>
                  </div>
                </div>
              </div>

              {/* 3. Parcels & Takeaway Section with + Icon */}
              <div className="floor-section-card" style={{ marginTop: '24px' }}>
                <div className="floor-section-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '1.3rem' }}>📦</span>
                    <h3 style={{ margin: 0, fontSize: '1.08rem', fontWeight: 800 }}>Parcels &amp; Takeaway Section</h3>
                  </div>
                </div>

                <div
                  className="tables-grid"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                    gap: '14px'
                  }}
                >
                  {parcelTables.map((t) => (
                    <TableCard
                      key={t.id}
                      table={t}
                      onClick={setActiveSessionTable}
                      onStatusChange={handleTableStatusChange}
                      onSettle={handleOpenSettle}
                      department="restaurant"
                    />
                  ))}

                  {/* Add Parcel Dotted Card */}
                  <div
                    className="table-card-dotted add-action-card"
                    onClick={handleCreateParcel}
                    style={{
                      border: '2.5px dashed #fcd34d',
                      background: '#fffdfa',
                      borderRadius: '16px',
                      padding: '16px',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      textAlign: 'center',
                      minHeight: '136px',
                      transition: 'all 0.15s ease'
                    }}
                    title="Click to start a new takeaway parcel order"
                  >
                    <div style={{ fontSize: '1.8rem', color: '#d97706', marginBottom: '4px' }}>📦 +</div>
                    <div style={{ fontWeight: 800, color: '#d97706', fontSize: '0.86rem' }}>+ New Parcel</div>
                    <small style={{ color: '#64748b', fontSize: '0.72rem', marginTop: '2px' }}>Takeaway &amp; Delivery</small>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <TableSessionView
              table={activeSessionTable}
              menu={menu}
              categories={categories}
              occupiedRooms={occupiedRooms}
              department="restaurant"
              onBack={() => {
                setActiveSessionTable(null);
                loadTables(true);
              }}
              onSettleBill={(session) => setSettleSession(session)}
              onPrintKOT={(kotData) => {
                if (onPrintKOTSlip) onPrintKOTSlip(kotData);
                else printKOTSlip(kotData?.kot || kotData, kotData?.tableNumber, kotData?.waiterName);
              }}
              onPrintPrebill={(prebillData) => {
                printPreBillSlip(prebillData.table, prebillData.cart || prebillData.items, prebillData.waiterName, 'restaurant');
              }}
            />
          )}
        </div>
      )}

      {activeSubTab === 'settled' && (
        <div style={{ flex: '1 1 auto', minHeight: 0, height: '100%', maxHeight: '100%', overflowY: 'auto' }}>
          <SettledBillsView
            department="restaurant"
            onPrintBill={(bill) => {
              if (onPrintBillSlip) onPrintBillSlip(bill);
              else printThermalBillSlip(bill, 'Restaurant Bill/Cheque');
            }}
            onResettle={() => loadTables(true)}
          />
        </div>
      )}

      {activeSubTab === 'manager' && (
        <div style={{ flex: '1 1 auto', minHeight: 0, height: '100%', maxHeight: '100%', overflowY: 'auto' }}>
          <PosManagerPanel
            department="restaurant"
            onMenuChanged={loadMenuAndCategories}
            onTablesChanged={loadTables}
          />
        </div>
      )}

      {/* Room Service Chooser Modal */}
      <RoomServiceChooserModal
        isOpen={isRoomChooserOpen}
        onClose={() => setIsRoomChooserOpen(false)}
        occupiedRooms={occupiedRooms}
        activeRSTables={roomServiceTables}
        onSelectRoom={handleSelectRoomService}
      />

      {/* Settle Modal */}
      <TableSettleModal
        isOpen={Boolean(settleSession)}
        session={settleSession}
        onClose={() => setSettleSession(null)}
        department="restaurant"
        onSettleSuccess={(res) => {
          setSettleSession(null);
          setActiveSessionTable(null);
          loadTables(true);
          if (onPrintBillSlip) onPrintBillSlip(res);
          else printThermalBillSlip(res, 'Restaurant Bill/Cheque');
        }}
      />

      {/* Guest In-Room Order Alert & Acceptance Modal with continuous beep */}
      <GuestOrderAcceptModal
        order={activeAlertOrder}
        onAccept={handleAcceptGuestOrder}
        onCancel={handleCancelGuestOrder}
        onClose={() => setActiveAlertOrder(null)}
        isAccepting={isAcceptingOrder}
        isCancelling={isCancellingOrder}
      />
    </section>
  );
}
