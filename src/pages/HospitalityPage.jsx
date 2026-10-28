import React, { useState, useMemo, useEffect } from 'react';
import { useHospitality } from '../context/HospitalityContext';
import { useApp } from '../context/AppContext';
import { api } from '../services/api';
import RoomCard from '../components/hospitality/RoomCard';
import RoomContextMenu from '../components/hospitality/RoomContextMenu';
import RoomCleaningModal from '../components/hospitality/RoomCleaningModal';
import HospitalityHistory from '../components/hospitality/HospitalityHistory';
import AdvanceBookingModal from '../components/hospitality/AdvanceBookingModal';
import OccupancyChartModal from '../components/hospitality/OccupancyChartModal';
import CashHandoverModal from '../components/hospitality/CashHandoverModal';
import { formatCurrency } from '../utils/formatters';

const FLOOR_ORDER = [
  'Basement',
  'First Floor',
  'Second Floor',
  'Third Floor',
  'Fourth Floor',
  'Fifth Floor'
];

function getRoomFloor(room) {
  if (room.floor && room.floor.trim()) {
    return room.floor.trim();
  }
  const num = String(room.room_number || '').trim();
  if (/^b/i.test(num)) return 'Basement';
  if (/^1/.test(num)) return 'First Floor';
  if (/^2/.test(num)) return 'Second Floor';
  if (/^3/.test(num)) return 'Third Floor';
  if (/^4/.test(num)) return 'Fourth Floor';
  if (/^5/.test(num)) return 'Fifth Floor';
  return 'First Floor';
}

export default function HospitalityPage({ onStartCheckin, onOpenFolio, onOpenVisitors, onViewHistoryDetail }) {
  const {
    rooms,
    activeFilter,
    setActiveFilter,
    activeSubTab,
    setActiveSubTab,
    loadRooms,
    loadStats,
    markRoomClean,
    toggleRoomMaintenance,
    openContextMenu,
    dashboardSelectedRoomIds,
    setDashboardSelectedRoomIds
  } = useHospitality();
  const { showToast, setActivePanel, previousPanel, goBackPanel, currentUser, openStaffLogin } = useApp();

  const [hoveredLinkedGroup, setHoveredLinkedGroup] = useState('');
  const [cleaningModalRoom, setCleaningModalRoom] = useState(null);

  // Occupancy Chart State
  const [isOccupancyChartOpen, setIsOccupancyChartOpen] = useState(false);

  // Cash Handover State
  const [isCashHandoverOpen, setIsCashHandoverOpen] = useState(false);

  // Advance Booking & 48-Hour Alert State
  const [isAdvBookingOpen, setIsAdvBookingOpen] = useState(false);
  const [advInitialTab, setAdvInitialTab] = useState('pending');
  const [advPendingCount, setAdvPendingCount] = useState(0);
  const [urgentBookings, setUrgentBookings] = useState([]);
  const [urgentIndex, setUrgentIndex] = useState(0);

  const loadAdvanceAlerts = async () => {
    try {
      const res = await api.getAdvanceBookings();
      if (res && res.success) {
        setAdvPendingCount(res.totalPending || 0);
        setUrgentBookings(res.urgent48h || []);
      }
    } catch (_) {}
  };

  useEffect(() => {
    loadAdvanceAlerts();
    const interval = setInterval(loadAdvanceAlerts, 15000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (urgentBookings.length <= 1) {
      setUrgentIndex(0);
      return;
    }
    const timer = setInterval(() => {
      setUrgentIndex((prev) => (prev + 1) % urgentBookings.length);
    }, 3800);
    return () => clearInterval(timer);
  }, [urgentBookings.length]);

  const handleOpenAdvanceBooking = (tab = 'pending') => {
    setAdvInitialTab(tab);
    setIsAdvBookingOpen(true);
  };

  const handleStartCheckinFromBooking = (booking) => {
    const targetRoom = rooms.find((r) => String(r.room_number) === String(booking.room_number));
    if (targetRoom) {
      if (targetRoom.status === 'occupied') {
        showToast(
          `Room #${targetRoom.room_number} is currently occupied! Please clear or shift room first, or choose another room.`,
          'warning',
          5000
        );
      }
      if (onStartCheckin) {
        onStartCheckin(targetRoom, [], {
          guestName: booking.customer_name,
          mobile: booking.phone,
          address: booking.address,
          adultsMale: booking.adults || 1,
          children: booking.children || 0,
          advanceBookingId: booking.id,
          advanceAmount: booking.advance_amount || 0
        });
      }
    } else {
      showToast(`Room #${booking.room_number} not found in room inventory.`, 'error', 4000);
    }
  };

  // Room Transfer (same room type to same room type) state
  const [isTransferMode, setIsTransferMode] = useState(false);
  const [transferSourceRoom, setTransferSourceRoom] = useState(null);
  const [dropTargetRoomId, setDropTargetRoomId] = useState(null);
  const [transferConfirmData, setTransferConfirmData] = useState(null);
  const [isTransferring, setIsTransferring] = useState(false);

  const [dashboardFilter, setDashboardFilter] = useState('all'); // 'all' | 'occupied' | 'empty'

  const occupiedCount = useMemo(() => rooms.filter((r) => r.status === 'occupied').length, [rooms]);
  const emptyCount = useMemo(() => rooms.filter((r) => r.status !== 'occupied').length, [rooms]);

  const filteredRooms = useMemo(() => {
    if (dashboardFilter === 'occupied') {
      return rooms.filter((r) => r.status === 'occupied');
    }
    if (dashboardFilter === 'empty') {
      return rooms.filter((r) => r.status !== 'occupied');
    }
    return rooms;
  }, [rooms, dashboardFilter]);

  const floorGroups = useMemo(() => {
    const groups = {};
    filteredRooms.forEach((room) => {
      const floor = getRoomFloor(room);
      if (!groups[floor]) {
        groups[floor] = [];
      }
      groups[floor].push(room);
    });

    const sortedFloors = Object.keys(groups).sort((a, b) => {
      const idxA = FLOOR_ORDER.indexOf(a);
      const idxB = FLOOR_ORDER.indexOf(b);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return a.localeCompare(b);
    });

    return sortedFloors.map((floor) => ({
      floor,
      rooms: groups[floor]
    }));
  }, [filteredRooms]);

  const handleRoomClick = (room) => {
    // User Requirement: If nobody is logged in, clicking any room must show unclosable login modal
    if (!currentUser) {
      showToast('Please log in with staff credentials to access rooms.', 'warning', 3000);
      if (openStaffLogin) openStaffLogin('hospitality', true);
      return;
    }

    if (dashboardSelectedRoomIds.size > 0) {
      if (room.status !== 'ready') {
        showToast('Only available (ready) rooms can be selected for combined booking.', 'warning', 3000);
        return;
      }
      setDashboardSelectedRoomIds((prev) => {
        const next = new Set(prev);
        if (next.has(room.id)) {
          next.delete(room.id);
        } else {
          next.add(room.id);
        }
        return next;
      });
      return;
    }

    if (room.status === 'ready') {
      if (onStartCheckin) onStartCheckin(room);
    } else if (room.status === 'occupied') {
      if (onOpenFolio) onOpenFolio(room);
    } else if (room.status === 'needs_cleaning') {
      setCleaningModalRoom(room);
    } else if (room.status === 'maintenance') {
      // Left-click disabled for under construction / maintenance rooms
      showToast(`Room #${room.room_number} is under construction / maintenance. Right-click for options.`, 'info', 3000);
    }
  };

  const handleContextMenuWithAuth = (e, room) => {
    if (!currentUser) {
      if (e?.preventDefault) e.preventDefault();
      showToast('Please log in with staff credentials to access rooms.', 'warning', 3000);
      if (openStaffLogin) openStaffLogin('hospitality', true);
      return;
    }
    openContextMenu(e, room);
  };

  const handleLongPress = (room) => {
    if (!currentUser) {
      showToast('Please log in with staff credentials to access rooms.', 'warning', 3000);
      if (openStaffLogin) openStaffLogin('hospitality', true);
      return;
    }
    if (room.status === 'ready') {
      setDashboardSelectedRoomIds(new Set([room.id]));
      showToast('✓ Multi-Room Selection Active: Click ready room cards to add/remove.', 'info', 4500);
    }
  };

  const cancelMultiSelect = () => {
    setDashboardSelectedRoomIds(new Set());
  };

  const confirmMultiRoomBooking = () => {
    if (dashboardSelectedRoomIds.size === 0) return;
    const selectedRooms = Array.from(dashboardSelectedRoomIds)
      .map((id) => rooms.find((r) => r.id === id))
      .filter(Boolean);
    const primary = selectedRooms[0];
    const additional = selectedRooms.slice(1);
    setDashboardSelectedRoomIds(new Set());
    if (onStartCheckin) onStartCheckin(primary, additional);
  };

  // Multi-room banner info calculation
  const selectedRoomsList = Array.from(dashboardSelectedRoomIds)
    .map((id) => rooms.find((r) => r.id === id))
    .filter(Boolean);
  const selectedRoomNums = selectedRoomsList.map((r) => `#${r.room_number}`).join(', ');
  const totalTariff = selectedRoomsList.reduce((sum, r) => sum + (r.price || 0), 0);
  const totalCap = selectedRoomsList.reduce((sum, r) => sum + (r.max_adults || 2), 0);

  const totalCount = rooms.length;
  const readyCount = rooms.filter((r) => r.status === 'ready').length;
  const cleaningCount = rooms.filter((r) => r.status === 'needs_cleaning').length;
  const maintenanceCount = rooms.filter((r) => r.status === 'maintenance').length;
  const occupancyPct = totalCount > 0 ? Math.round((occupiedCount / totalCount) * 100) : 0;

  // ==========================================
  // ROOM TRANSFER LOGIC (Same room type shift)
  // ==========================================
  const handleToggleTransferMode = () => {
    setIsTransferMode((prev) => {
      const next = !prev;
      if (!next) {
        setTransferSourceRoom(null);
        setDropTargetRoomId(null);
      } else {
        showToast('Room Transfer Mode: Drag or click an occupied room to shift into an empty room of the same type.', 'info', 4000);
      }
      return next;
    });
  };

  const handleTransferDragStart = (e, room) => {
    if (room.status !== 'occupied') return;
    setTransferSourceRoom(room);
    if (e?.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      try {
        e.dataTransfer.setData('text/plain', JSON.stringify({ roomId: room.id, roomNumber: room.room_number, roomType: room.room_type }));
      } catch (_) {
        e.dataTransfer.setData('text/plain', String(room.id));
      }
    }
  };

  const handleTransferDragEnd = () => {
    setDropTargetRoomId(null);
  };

  const handleTransferDragOver = (e, room) => {
    if (e?.preventDefault) e.preventDefault();
    if (e?.dataTransfer) e.dataTransfer.dropEffect = 'move';
    if (dropTargetRoomId !== room.id) {
      setDropTargetRoomId(room.id);
    }
  };

  const handleTransferDragLeave = (e, room) => {
    if (dropTargetRoomId === room.id) {
      setDropTargetRoomId(null);
    }
  };

  const handleTransferDrop = (e, targetRoom) => {
    if (e?.preventDefault) e.preventDefault();
    setDropTargetRoomId(null);

    let source = transferSourceRoom;
    if (!source && e?.dataTransfer) {
      try {
        const dataStr = e.dataTransfer.getData('text/plain');
        if (dataStr) {
          if (dataStr.startsWith('{')) {
            const parsed = JSON.parse(dataStr);
            source = rooms.find((r) => r.id === parsed.roomId);
          } else {
            source = rooms.find((r) => String(r.id) === dataStr);
          }
        }
      } catch (_) {}
    }

    if (!source) {
      showToast('Please select or drag an occupied room to transfer.', 'warning', 3000);
      return;
    }

    if (source.id === targetRoom.id) {
      return;
    }

    if (targetRoom.status !== 'ready') {
      showToast(`Room #${targetRoom.room_number} is not ready (Status: ${targetRoom.status}). Only available rooms can be transferred into.`, 'warning', 3500);
      return;
    }

    const srcType = String(source.room_type || '').trim().toLowerCase();
    const destType = String(targetRoom.room_type || '').trim().toLowerCase();
    const isCrossCategory = srcType !== destType;

    // Target is valid! Prompt confirmation (same category direct, cross category with admin approval)
    setTransferConfirmData({
      sourceRoom: source,
      targetRoom,
      isCrossCategory,
      approvalStatus: 'idle',
      approvalId: null
    });
  };

  const handleTransferSelect = (room) => {
    if (!transferSourceRoom) {
      if (room.status === 'occupied') {
        setTransferSourceRoom(room);
        showToast(`Selected Room #${room.room_number} (${room.room_type}). Drag or click an available room to shift.`, 'info', 4000);
      } else {
        showToast('Click an occupied room first to begin transfer.', 'info', 3000);
      }
      return;
    }

    if (room.id === transferSourceRoom.id) {
      setTransferSourceRoom(null);
      showToast(`Deselected Room #${room.room_number}.`, 'info', 2000);
      return;
    }

    if (room.status === 'ready') {
      const srcType = String(transferSourceRoom.room_type || '').trim().toLowerCase();
      const destType = String(room.room_type || '').trim().toLowerCase();
      const isCrossCategory = srcType !== destType;

      setTransferConfirmData({
        sourceRoom: transferSourceRoom,
        targetRoom: room,
        isCrossCategory,
        approvalStatus: 'idle',
        approvalId: null
      });
    } else {
      showToast(`Only available (ready) rooms can receive a transfer.`, 'warning', 3000);
    }
  };

  const executeTransfer = async () => {
    if (!transferConfirmData?.sourceRoom || !transferConfirmData?.targetRoom) return;
    setIsTransferring(true);
    try {
      const staffName = currentUser?.full_name || currentUser?.name || currentUser?.username || 'Front Desk';
      const res = await api.transferRoom({
        from_room_id: transferConfirmData.sourceRoom.id,
        to_room_id: transferConfirmData.targetRoom.id,
        transferred_by: staffName,
        reason: transferConfirmData.isCrossCategory
          ? `Cross-category room shift from ${transferConfirmData.sourceRoom.room_type} to ${transferConfirmData.targetRoom.room_type} (Rates preserved)`
          : 'Guest room shift (same room type)'
      });

      if (res?.success) {
        showToast(
          `✓ Successfully shifted Room #${transferConfirmData.sourceRoom.room_number} to Room #${transferConfirmData.targetRoom.room_number} (${transferConfirmData.targetRoom.room_type})!`,
          'green',
          4500
        );
        // Automatic uncheck requirement: "if drop that transfer button wil automatcically uncheck"
        setIsTransferMode(false);
        setTransferSourceRoom(null);
        setDropTargetRoomId(null);
        setTransferConfirmData(null);
        await loadRooms(true);
        if (loadStats) loadStats();
      } else {
        showToast(res?.error || 'Room transfer failed.', 'error', 5000);
      }
    } catch (err) {
      showToast(err.message || 'Room transfer failed.', 'error', 5000);
    } finally {
      setIsTransferring(false);
    }
  };

  const requestTransferApproval = async () => {
    if (!transferConfirmData?.sourceRoom || !transferConfirmData?.targetRoom) return;
    setIsTransferring(true);
    try {
      const staffName = currentUser?.full_name || currentUser?.name || currentUser?.username || 'Front Desk';
      const source = transferConfirmData.sourceRoom;
      const target = transferConfirmData.targetRoom;

      const res = await api.post('/owner/approvals/request', {
        type: 'room_transfer',
        dept: 'Room',
        room_number: String(source.room_number),
        guest_name: source.guest_name || 'Guest',
        requested_by: staffName,
        current_total: source.price || 0,
        amount: 0,
        reason: `Cross-category shift: Room #${source.room_number} (${source.room_type}) ➔ Room #${target.room_number} (${target.room_type}) • Declared check-in tariff preserved (${formatCurrency(source.price || 0)}) • Raised by ${staffName}`,
        metadata: {
          from_room_id: source.id,
          to_room_id: target.id,
          from_room_number: source.room_number,
          to_room_number: target.room_number,
          from_room_type: source.room_type,
          to_room_type: target.room_type,
          guest_name: source.guest_name || 'Guest',
          current_rate: source.price || 0,
          requested_by: staffName,
          reason: `Cross-category room shift: ${source.room_type} ➔ ${target.room_type}`
        }
      });

      if (res && (res.id || res.approval_id || res.success)) {
        const approvalId = res.id || res.approval_id;
        setTransferConfirmData((prev) => ({
          ...prev,
          approvalStatus: 'waiting',
          approvalId
        }));
        showToast('Room shift permission request sent to Admin phone!', 'blue', 4000);
      } else {
        showToast('Could not send approval request.', 'error', 4000);
      }
    } catch (err) {
      showToast('Error requesting approval: ' + (err.message || 'Server error'), 'error', 5000);
    } finally {
      setIsTransferring(false);
    }
  };

  // Polling for Admin Approval on cross-category shift (instant 1-second check)
  useEffect(() => {
    if (transferConfirmData?.approvalStatus !== 'waiting' || !transferConfirmData?.approvalId) return;

    let isMounted = true;
    const checkStatus = async () => {
      try {
        const res = await api.get(`/owner/approvals/${transferConfirmData.approvalId}/status`);
        if (!isMounted) return;
        if (res && res.status === 'APPROVED') {
          clearInterval(interval);
          const fromNum = transferConfirmData.sourceRoom?.room_number || '';
          const toNum = transferConfirmData.targetRoom?.room_number || '';
          const toType = transferConfirmData.targetRoom?.room_type || '';

          // DIRECT CLOSE: Immediately close modal and reset shift mode
          setTransferConfirmData(null);
          setIsTransferMode(false);
          setTransferSourceRoom(null);
          setDropTargetRoomId(null);

          // DIRECT REFRESH: Immediately show the shifted room on screen
          await loadRooms(true);
          if (loadStats) loadStats();

          showToast(
            `✓ Admin APPROVED! Room #${fromNum} shifted to Room #${toNum} (${toType}). Check-in rates preserved.`,
            'green',
            5000
          );
        } else if (res && res.status === 'REJECTED') {
          clearInterval(interval);
          setTransferConfirmData(null);
          setIsTransferMode(false);
          setTransferSourceRoom(null);
          setDropTargetRoomId(null);
          showToast('✕ Admin REJECTED the room shift request.', 'error', 4500);
        }
      } catch (err) {
        // silent retry
      }
    };

    // Immediate check right away, then poll every 1 second
    checkStatus();
    const interval = setInterval(checkStatus, 1000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [transferConfirmData?.approvalStatus, transferConfirmData?.approvalId]);

  return (
    <section className="panel-view active" id="view-hospitality">
      {/* If viewing history, show a quick Back to Rooms button */}
      {activeSubTab === 'history' && (
        <div style={{ marginBottom: '14px', display: 'flex', alignItems: 'center' }}>
          <button
            type="button"
            className="universal-back-btn"
            id="btn-hosp-back-rooms"
            onClick={() => setActiveSubTab('rooms')}
            title="Back to Live Rooms & Grid"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            <span>Back to Rooms</span>
          </button>
        </div>
      )}

      {activeSubTab === 'rooms' ? (
        <div className="hosp-sub-content active" id="hosp-subview-rooms">
          {/* Room Transfer Toolbar on Dashboard */}
          <div
            className={`room-transfer-toolbar ${isTransferMode ? 'active-mode' : ''}`}
            id="room-transfer-toolbar"
          >
            {isTransferMode ? (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '0.80rem', color: '#6d28d9', fontWeight: 650 }}>
                {!transferSourceRoom ? (
                  <span>👉 <strong>Step 1:</strong> Drag or click an <strong>Occupied Room</strong> to shift.</span>
                ) : (
                  <span>
                    🎯 Shifting <strong>Room #{transferSourceRoom.room_number}</strong> ({transferSourceRoom.room_type}): Drop into <strong style={{ color: '#059669' }}>🟢 Same Category</strong> for direct shift, or <strong style={{ color: '#d97706' }}>⚡ Cross-Category</strong> for Admin approval (rates preserved)!
                  </span>
                )}
              </div>
            ) : (
              <div
                className="dashboard-occupancy-summary"
                id="dashboard-occupancy-summary"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  userSelect: 'none'
                }}
              >
                {/* Occupied Badge */}
                <button
                  type="button"
                  id="dash-badge-occupied"
                  className={`dash-occ-pill occupied ${dashboardFilter === 'occupied' ? 'active-filter' : ''}`}
                  onClick={() => setDashboardFilter((prev) => (prev === 'occupied' ? 'all' : 'occupied'))}
                  title={dashboardFilter === 'occupied' ? 'Showing occupied rooms. Click to show all rooms.' : 'Click to filter occupied rooms only'}
                >
                  <span className="dash-occ-dot" />
                  <span>Occupied:</span>
                  <span className="dash-occ-num">{occupiedCount}</span>
                </button>

                {/* Empty / Ready Badge */}
                <button
                  type="button"
                  id="dash-badge-empty"
                  className={`dash-occ-pill empty ${dashboardFilter === 'empty' ? 'active-filter' : ''}`}
                  onClick={() => setDashboardFilter((prev) => (prev === 'empty' ? 'all' : 'empty'))}
                  title={dashboardFilter === 'empty' ? 'Showing empty rooms. Click to show all rooms.' : 'Click to filter empty rooms only'}
                >
                  <span className="dash-occ-dot" />
                  <span>Empty:</span>
                  <span className="dash-occ-num">{emptyCount}</span>
                </button>

                {/* All Rooms Badge */}
                <button
                  type="button"
                  id="dash-badge-total"
                  className={`dash-occ-pill total ${dashboardFilter === 'all' ? 'active-filter' : ''}`}
                  onClick={() => setDashboardFilter('all')}
                  title="Show all hotel rooms"
                >
                  <span>All:</span>
                  <span className="dash-occ-num">{rooms.length}</span>
                </button>
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: 'auto', flexWrap: 'wrap' }}>
              {/* 48-Hour Urgent Blinking Alert Popup (Little left side of Advance Booking button) */}
              {urgentBookings.length > 0 && urgentBookings[urgentIndex] && (
                <div
                  className="adv-urgent-blinking-popup"
                  id="adv-urgent-blinking-popup"
                  onClick={() => handleOpenAdvanceBooking('pending')}
                  title="⚠️ Check-in due within 48 hours! Click to view pending advance bookings"
                >
                  <span style={{ fontSize: '0.82rem' }}>🔴</span>
                  <span>
                    <strong>c/n :</strong> {urgentBookings[urgentIndex].checkin_date} {urgentBookings[urgentIndex].checkin_time || '12:00'} ·{' '}
                    <strong>c/o :</strong> {urgentBookings[urgentIndex].checkout_date} {urgentBookings[urgentIndex].checkout_time || '11:00'} |{' '}
                    <strong>Room :</strong> #{urgentBookings[urgentIndex].room_number} |{' '}
                    <strong>Adults :</strong> {urgentBookings[urgentIndex].adults}
                    {urgentBookings[urgentIndex].children > 0 ? ` (${urgentBookings[urgentIndex].children} children)` : ''}
                  </span>
                  {urgentBookings.length > 1 && (
                    <span
                      style={{
                        background: '#7f1d1d',
                        padding: '1px 5px',
                        borderRadius: '6px',
                        fontSize: '0.66rem',
                        marginLeft: '3px'
                      }}
                    >
                      {urgentIndex + 1}/{urgentBookings.length}
                    </span>
                  )}
                </div>
              )}

              {/* Shift Cash Handover Button */}
              <button
                type="button"
                className="btn-occupancy-chart"
                id="btn-cash-handover"
                onClick={() => setIsCashHandoverOpen(true)}
                title="View & Print Front Office Cash Handover Statement (Shift handover, 2-copy A4 print)"
                style={{ background: 'linear-gradient(135deg, #059669, #047857)', borderColor: '#059669', color: '#fff' }}
              >
                <span style={{ fontSize: '0.88rem' }}>💵</span>
                <span>Cash Handover</span>
              </button>

              {/* Occupancy Chart Button (Left side of Advance Booking) */}
              <button
                type="button"
                className="btn-occupancy-chart"
                id="btn-occupancy-chart"
                onClick={() => setIsOccupancyChartOpen(true)}
                title="View & Print Room Occupancy Chart (Live in-house guests, meal plans, pax allotment)"
              >
                <span style={{ fontSize: '0.88rem' }}>📋</span>
                <span>Occupancy Chart</span>
              </button>

              {/* Advance Booking Button (Left side of Room Transfer) */}
              <button
                type="button"
                className="btn-advance-booking"
                id="btn-advance-booking"
                onClick={() => handleOpenAdvanceBooking('pending')}
                title="Manage Advance Pre-Bookings, Pendings & Completed Reservations"
              >
                <span style={{ fontSize: '0.88rem' }}>📅</span>
                <span>Advance Booking</span>
                {advPendingCount > 0 && (
                  <span className="adv-badge-count">{advPendingCount}</span>
                )}
              </button>

              <button
                type="button"
                className={`btn-room-transfer-mode ${isTransferMode ? 'active' : ''}`}
                id="btn-toggle-room-transfer"
                onClick={handleToggleTransferMode}
                title="Shift guests between rooms of the same type (Price remains identical)"
              >
                <span style={{ fontSize: '0.88rem' }}>🔄</span>
                <span>Room Transfer</span>
                {isTransferMode && (
                  <span
                    style={{
                      fontSize: '0.64rem',
                      background: '#ffffff',
                      color: '#7c3aed',
                      padding: '1px 6px',
                      borderRadius: '10px',
                      fontWeight: 800,
                      letterSpacing: '0.4px',
                      marginLeft: '2px'
                    }}
                  >
                    ON
                  </span>
                )}
              </button>

              {isTransferMode && (
                <>
                  {transferSourceRoom && (
                    <button
                      type="button"
                      className="btn-secondary"
                      style={{ padding: '3px 10px', fontSize: '0.74rem', borderRadius: '12px' }}
                      onClick={() => {
                        setTransferSourceRoom(null);
                        setDropTargetRoomId(null);
                      }}
                    >
                      Clear Selection
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn-secondary"
                    style={{ padding: '3px 10px', fontSize: '0.74rem', borderRadius: '12px', color: '#ef4444', borderColor: '#fca5a5' }}
                    onClick={() => {
                      setIsTransferMode(false);
                      setTransferSourceRoom(null);
                      setDropTargetRoomId(null);
                    }}
                  >
                    Cancel Mode
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Rooms Grid Floor-wise */}
          {filteredRooms.length === 0 ? (
            <div className="rooms-grid" id="rooms-grid-container">
              <div
                style={{
                  gridColumn: '1/-1',
                  textAlign: 'center',
                  padding: '60px 20px',
                  background: '#fff',
                  borderRadius: 'var(--radius-lg, 18px)',
                  border: '1.5px solid #e2e8f0',
                  boxShadow: '0 2px 10px rgba(0,0,0,0.03)'
                }}
              >
                <div style={{ fontSize: '2.5rem', marginBottom: '8px' }}>
                  {rooms.length === 0 ? '🏨' : '🔍'}
                </div>
                <h3 style={{ color: '#1e293b', fontSize: '1.15rem', fontWeight: 700 }}>
                  {rooms.length === 0 ? 'No rooms added yet' : `No rooms matching "${activeFilter}"`}
                </h3>
                <p style={{ color: '#64748b', fontSize: '0.86rem', marginTop: '4px', marginBottom: '16px' }}>
                  {rooms.length === 0
                    ? 'Your hotel room inventory is currently empty. Go to Manage to add your rooms.'
                    : 'There are currently no rooms with this filter status.'}
                </p>
                {rooms.length === 0 ? (
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => setActivePanel && setActivePanel('manage')}
                    style={{
                      borderRadius: '20px',
                      padding: '8px 22px',
                      fontSize: '0.86rem',
                      fontWeight: 750,
                      background: 'linear-gradient(135deg, #0071e3 0%, #005bb5 100%)',
                      color: '#ffffff',
                      border: 'none',
                      cursor: 'pointer',
                      boxShadow: '0 4px 12px rgba(0, 113, 227, 0.25)'
                    }}
                  >
                    + Add Rooms in Manage
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setActiveFilter('all')}
                    style={{ borderRadius: '20px', padding: '6px 18px', fontSize: '0.84rem' }}
                  >
                    Show All Rooms ({totalCount})
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="floor-sections-container" id="rooms-grid-container">
              {floorGroups.map(({ floor, rooms: floorRooms }) => (
                <div key={floor} className="floor-section">
                  <div className="floor-section-header">
                    <div className="floor-divider-line" />
                    <div className="floor-section-badge">
                      <span className="floor-icon">🏢</span>
                      <span className="floor-name">{floor}</span>
                      <span className="floor-room-count">({floorRooms.length})</span>
                    </div>
                    <div className="floor-divider-line" />
                  </div>

                  <div className="rooms-grid">
                    {floorRooms.map((room) => {
                      const isGroupHovered =
                        hoveredLinkedGroup &&
                        hoveredLinkedGroup.split(',').map((s) => s.trim()).includes(String(room.room_number));

                      const isTransferSource = Boolean(isTransferMode && transferSourceRoom?.id === room.id);
                      const isSameRoomType = Boolean(
                        transferSourceRoom &&
                        String(room.room_type || '').trim().toLowerCase() === String(transferSourceRoom.room_type || '').trim().toLowerCase()
                      );
                      const isDroppable = Boolean(isTransferMode && transferSourceRoom && room.status === 'ready');
                      const isDroppableSame = Boolean(isDroppable && isSameRoomType);
                      const isDroppableCross = Boolean(isDroppable && !isSameRoomType);
                      const isDropTarget = Boolean(isDroppable && dropTargetRoomId === room.id);
                      const isDimmed = Boolean(
                        isTransferMode &&
                        transferSourceRoom &&
                        room.id !== transferSourceRoom.id &&
                        room.status !== 'ready'
                      );

                      return (
                        <RoomCard
                          key={room.id}
                          room={room}
                          onClick={handleRoomClick}
                          onContextMenu={handleContextMenuWithAuth}
                          isMultiSelected={dashboardSelectedRoomIds.has(room.id)}
                          isGroupHovered={isGroupHovered}
                          onGroupHover={setHoveredLinkedGroup}
                          onGroupLeave={() => setHoveredLinkedGroup('')}
                          onLongPress={handleLongPress}
                          isTransferMode={isTransferMode}
                          transferSourceRoom={transferSourceRoom}
                          isTransferSource={isTransferSource}
                          isDroppable={isDroppable}
                          isSameRoomType={isSameRoomType}
                          isDroppableSame={isDroppableSame}
                          isDroppableCross={isDroppableCross}
                          isDimmed={isDimmed}
                          isDropTarget={isDropTarget}
                          onTransferDragStart={handleTransferDragStart}
                          onTransferDragEnd={handleTransferDragEnd}
                          onTransferDragOver={handleTransferDragOver}
                          onTransferDragLeave={handleTransferDragLeave}
                          onTransferDrop={handleTransferDrop}
                          onTransferSelect={handleTransferSelect}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <HospitalityHistory onViewDetail={onViewHistoryDetail} />
      )}

      {/* Multi-Room Long-Press Banner */}
      {dashboardSelectedRoomIds.size > 0 && (
        <div id="dashboard-multi-room-bar" className="dashboard-multi-room-banner active">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span className="multi-bar-badge">Multi-Room Selection</span>
            <span className="multi-bar-info" id="multi-bar-room-info">
              {selectedRoomsList.length} Rooms Selected (<strong>{selectedRoomNums}</strong>) •{' '}
              {formatCurrency(totalTariff)} / 24 hrs • 👥 Max {totalCap} Adults
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button type="button" className="btn-cancel-multi" onClick={cancelMultiSelect}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-book-combined"
              id="btn-confirm-multi-booking"
              onClick={confirmMultiRoomBooking}
            >
              <span>🚀</span> Book Combined Rooms ({dashboardSelectedRoomIds.size})
            </button>
          </div>
        </div>
      )}

      {/* Room Transfer Confirmation Modal (Entire Screen Centered Modal) */}
      {transferConfirmData && (
        <div
          className="modal-overlay active"
          id="room-transfer-confirm-modal"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            width: '100vw',
            height: '100vh',
            zIndex: 999999,
            background: 'rgba(15, 23, 42, 0.78)',
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
            margin: 0
          }}
          onClick={(e) => {
            if (e.target.id === 'room-transfer-confirm-modal' && !isTransferring && transferConfirmData.approvalStatus !== 'approved') {
              setTransferConfirmData(null);
            }
          }}
        >
          <div
            className="modal-container"
            style={{
              maxWidth: '560px',
              width: '94%',
              borderRadius: '24px',
              padding: '26px',
              background: '#ffffff',
              boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.1)',
              position: 'relative',
              margin: 'auto'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px', borderBottom: '1px solid #f1f5f9', paddingBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '1.6rem' }}>🔄</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, color: '#1e293b' }}>
                    {transferConfirmData.isCrossCategory ? 'Room Category Shift' : 'Confirm Room Shift'}
                  </h3>
                  <p style={{ margin: 0, fontSize: '0.82rem', color: transferConfirmData.isCrossCategory ? '#b45309' : '#64748b', fontWeight: transferConfirmData.isCrossCategory ? 700 : 500 }}>
                    {transferConfirmData.isCrossCategory
                      ? '⚠️ Different Room Category • Admin APK Approval Required'
                      : 'Same room type shift • Tariff remains unchanged'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setTransferConfirmData(null)}
                disabled={isTransferring || transferConfirmData.approvalStatus === 'approved'}
                style={{ background: 'none', border: 'none', fontSize: '1.3rem', cursor: 'pointer', color: '#94a3b8' }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: '12px', alignItems: 'center', marginBottom: '20px' }}>
              {/* Source Room */}
              <div style={{ background: '#f8fafc', border: '1.5px solid #cbd5e1', borderRadius: '14px', padding: '14px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.74rem', textTransform: 'uppercase', letterSpacing: '0.5px', color: '#64748b', fontWeight: 700 }}>
                  Current Room
                </div>
                <div style={{ fontSize: '1.4rem', fontWeight: 900, color: '#1e293b', margin: '4px 0' }}>
                  #{transferConfirmData.sourceRoom.room_number}
                </div>
                <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#475569' }}>
                  {transferConfirmData.sourceRoom.room_type}
                </div>
                <div style={{ fontSize: '0.78rem', color: '#0369a1', marginTop: '4px', fontWeight: 600 }}>
                  👤 {transferConfirmData.sourceRoom.guest_name || 'Guest'}
                </div>
              </div>

              {/* Shift Arrow */}
              <div style={{ fontSize: '1.8rem', color: transferConfirmData.isCrossCategory ? '#d97706' : '#7c3aed', textAlign: 'center', fontWeight: 900 }}>
                ➔
              </div>

              {/* Destination Room */}
              <div style={{ background: '#ecfdf5', border: '2px solid #059669', borderRadius: '14px', padding: '14px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.74rem', textTransform: 'uppercase', letterSpacing: '0.5px', color: '#047857', fontWeight: 700 }}>
                  New Room
                </div>
                <div style={{ fontSize: '1.4rem', fontWeight: 900, color: '#065f46', margin: '4px 0' }}>
                  #{transferConfirmData.targetRoom.room_number}
                </div>
                <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#047857' }}>
                  {transferConfirmData.targetRoom.room_type}
                </div>
                <div style={{ fontSize: '0.78rem', color: '#059669', marginTop: '4px', fontWeight: 700 }}>
                  ✨ Ready / Available
                </div>
              </div>
            </div>

            <div style={{ background: transferConfirmData.isCrossCategory ? '#fffbeb' : '#f8fafc', border: transferConfirmData.isCrossCategory ? '1.5px solid #fde68a' : '1px solid #e2e8f0', borderRadius: '12px', padding: '12px 14px', marginBottom: '22px', fontSize: '0.82rem', color: '#475569', lineHeight: 1.5 }}>
              <div>💰 <strong>Tariff:</strong> {formatCurrency(transferConfirmData.sourceRoom.price || 0)} / 24 hrs ({transferConfirmData.isCrossCategory ? 'Declared check-in rates strictly preserved • No extra cost' : 'Unchanged'})</div>
              <div style={{ marginTop: '4px' }}>📋 Active booking, folio charges, food &amp; beverage room service tabs, and visitors will move automatically to <strong>Room #{transferConfirmData.targetRoom.room_number}</strong>.</div>
              <div style={{ marginTop: '4px' }}>🧹 <strong>Room #{transferConfirmData.sourceRoom.room_number}</strong> will be marked as <em>Needs Cleaning</em>.</div>

              {transferConfirmData.approvalStatus === 'waiting' && (
                <div style={{ marginTop: '12px', padding: '10px 14px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '10px', color: '#1d4ed8', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '1.2rem' }}>📱</span>
                  <span>Permission request sent to Admin phone! Waiting for Admin approval on Admin APK... ⏳</span>
                </div>
              )}

              {transferConfirmData.approvalStatus === 'approved' && (
                <div style={{ marginTop: '12px', padding: '10px 14px', background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: '10px', color: '#065f46', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '1.2rem' }}>✓</span>
                  <span>Admin APPROVED the category shift! Room transferred with check-in rates preserved.</span>
                </div>
              )}

              {transferConfirmData.approvalStatus === 'rejected' && (
                <div style={{ marginTop: '12px', padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '10px', color: '#b91c1c', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '1.2rem' }}>✕</span>
                  <span>Admin REJECTED this room shift request.</span>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                className="btn-secondary"
                disabled={isTransferring || transferConfirmData.approvalStatus === 'approved'}
                onClick={() => setTransferConfirmData(null)}
                style={{ padding: '8px 18px', borderRadius: '12px' }}
              >
                {transferConfirmData.approvalStatus === 'waiting' ? 'Cancel Request' : (transferConfirmData.approvalStatus === 'rejected' ? 'Close' : 'Cancel')}
              </button>

              {transferConfirmData.isCrossCategory ? (
                transferConfirmData.approvalStatus === 'waiting' ? (
                  <button
                    type="button"
                    disabled
                    style={{
                      padding: '8px 24px',
                      borderRadius: '12px',
                      background: '#94a3b8',
                      color: '#fff',
                      fontWeight: 800,
                      border: 'none',
                      cursor: 'wait'
                    }}
                  >
                    Waiting for Admin ⏳
                  </button>
                ) : transferConfirmData.approvalStatus === 'approved' ? (
                  <button
                    type="button"
                    disabled
                    style={{
                      padding: '8px 24px',
                      borderRadius: '12px',
                      background: '#059669',
                      color: '#fff',
                      fontWeight: 800,
                      border: 'none'
                    }}
                  >
                    Shift Completed ✓
                  </button>
                ) : transferConfirmData.approvalStatus === 'rejected' ? null : (
                  <button
                    type="button"
                    className="btn-primary"
                    id="btn-request-shift-approval-submit"
                    disabled={isTransferring}
                    onClick={requestTransferApproval}
                    style={{
                      padding: '8px 24px',
                      borderRadius: '12px',
                      background: 'linear-gradient(135deg, #d97706 0%, #b45309 100%)',
                      color: '#fff',
                      fontWeight: 800,
                      border: 'none',
                      cursor: isTransferring ? 'wait' : 'pointer',
                      boxShadow: '0 4px 14px rgba(217, 119, 6, 0.35)'
                    }}
                  >
                    {isTransferring ? 'Sending Request...' : 'Request Admin Approval 📱'}
                  </button>
                )
              ) : (
                <button
                  type="button"
                  className="btn-primary"
                  id="btn-confirm-room-transfer-submit"
                  disabled={isTransferring}
                  onClick={executeTransfer}
                  style={{
                    padding: '8px 24px',
                    borderRadius: '12px',
                    background: 'linear-gradient(135deg, #7c3aed 0%, #6366f1 100%)',
                    color: '#fff',
                    fontWeight: 800,
                    border: 'none',
                    cursor: isTransferring ? 'wait' : 'pointer',
                    boxShadow: '0 4px 14px rgba(124, 58, 237, 0.35)'
                  }}
                >
                  {isTransferring ? 'Transferring...' : 'Confirm Transfer 🚀'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Context Menu Component */}
      <RoomContextMenu
        onOpenCheckin={onStartCheckin}
        onOpenFolio={onOpenFolio}
        onOpenVisitors={onOpenVisitors}
        onOpenCleaningModal={(room) => setCleaningModalRoom(room)}
      />

      {/* Mandatory Cleaner Room Cleaning Modal */}
      <RoomCleaningModal
        isOpen={Boolean(cleaningModalRoom)}
        room={cleaningModalRoom}
        onClose={() => setCleaningModalRoom(null)}
        onCleanSuccess={() => {
          setCleaningModalRoom(null);
          showToast(`Room #${cleaningModalRoom?.room_number} marked clean & ready!`, 'green', 3500);
          loadRooms(true);
          loadStats();
        }}
      />

      {/* Room Occupancy Chart Modal & Print */}
      <OccupancyChartModal
        isOpen={isOccupancyChartOpen}
        onClose={() => setIsOccupancyChartOpen(false)}
      />

      {/* Front Office Cash Handover Statement Modal & Print */}
      <CashHandoverModal
        isOpen={isCashHandoverOpen}
        onClose={() => setIsCashHandoverOpen(false)}
        currentUser={currentUser}
      />

      {/* Advance Booking & Pre-Reservations Modal */}
      <AdvanceBookingModal
        isOpen={isAdvBookingOpen}
        onClose={() => {
          setIsAdvBookingOpen(false);
          loadAdvanceAlerts();
        }}
        rooms={rooms}
        initialTab={advInitialTab}
        onStartCheckinFromBooking={handleStartCheckinFromBooking}
      />
    </section>
  );
}
