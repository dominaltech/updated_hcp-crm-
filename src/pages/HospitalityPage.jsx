import React, { useState, useMemo } from 'react';
import { useHospitality } from '../context/HospitalityContext';
import { useApp } from '../context/AppContext';
import { api } from '../services/api';
import RoomCard from '../components/hospitality/RoomCard';
import RoomContextMenu from '../components/hospitality/RoomContextMenu';
import RoomCleaningModal from '../components/hospitality/RoomCleaningModal';
import HospitalityHistory from '../components/hospitality/HospitalityHistory';
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
  const { showToast, setActivePanel, previousPanel, goBackPanel, currentUser } = useApp();

  const [hoveredLinkedGroup, setHoveredLinkedGroup] = useState('');
  const [cleaningModalRoom, setCleaningModalRoom] = useState(null);

  // Room Transfer (same room type to same room type) state
  const [isTransferMode, setIsTransferMode] = useState(false);
  const [transferSourceRoom, setTransferSourceRoom] = useState(null);
  const [dropTargetRoomId, setDropTargetRoomId] = useState(null);
  const [transferConfirmData, setTransferConfirmData] = useState(null);
  const [isTransferring, setIsTransferring] = useState(false);

  const filteredRooms = rooms;

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

  const handleLongPress = (room) => {
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
  const occupiedCount = rooms.filter((r) => r.status === 'occupied').length;
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
    if (srcType !== destType) {
      showToast(`Cannot transfer: Room #${source.room_number} is "${source.room_type}" but Room #${targetRoom.room_number} is "${targetRoom.room_type}". Room types must match!`, 'warning', 4500);
      return;
    }

    // Target is valid and has same room type! Prompt confirmation
    setTransferConfirmData({ sourceRoom: source, targetRoom });
  };

  const handleTransferSelect = (room) => {
    if (!transferSourceRoom) {
      if (room.status === 'occupied') {
        setTransferSourceRoom(room);
        showToast(`Selected Room #${room.room_number} (${room.room_type}). Drag or click an available room of the same type to shift.`, 'info', 4000);
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
      if (srcType !== destType) {
        showToast(`Cannot transfer: Room #${room.room_number} is "${room.room_type}" but Room #${transferSourceRoom.room_number} is "${transferSourceRoom.room_type}". Room types must match!`, 'warning', 4500);
        return;
      }
      setTransferConfirmData({ sourceRoom: transferSourceRoom, targetRoom: room });
    } else {
      showToast(`Only available (ready) rooms of the same type can receive a transfer.`, 'warning', 3000);
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
        reason: 'Guest room shift (same room type)'
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
            {isTransferMode && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '0.80rem', color: '#6d28d9', fontWeight: 650 }}>
                {!transferSourceRoom ? (
                  <span>👉 <strong>Step 1:</strong> Drag or click an <strong>Occupied Room</strong> to shift.</span>
                ) : (
                  <span>
                    🎯 Shifting <strong>Room #{transferSourceRoom.room_number}</strong> ({transferSourceRoom.room_type}): Drop or click into any highlighted ready room of same type!
                  </span>
                )}
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: 'auto' }}>
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
                      const isDroppable = Boolean(isTransferMode && transferSourceRoom && room.status === 'ready' && isSameRoomType);
                      const isDropTarget = Boolean(isDroppable && dropTargetRoomId === room.id);
                      const isDimmed = Boolean(
                        isTransferMode &&
                        transferSourceRoom &&
                        room.id !== transferSourceRoom.id &&
                        !isDroppable
                      );

                      return (
                        <RoomCard
                          key={room.id}
                          room={room}
                          onClick={handleRoomClick}
                          onContextMenu={openContextMenu}
                          isMultiSelected={dashboardSelectedRoomIds.has(room.id)}
                          isGroupHovered={isGroupHovered}
                          onGroupHover={setHoveredLinkedGroup}
                          onGroupLeave={() => setHoveredLinkedGroup('')}
                          onLongPress={handleLongPress}
                          isTransferMode={isTransferMode}
                          transferSourceRoom={transferSourceRoom}
                          isTransferSource={isTransferSource}
                          isDroppable={isDroppable}
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

      {/* Room Transfer Confirmation Modal */}
      {transferConfirmData && (
        <div className="modal-backdrop active" style={{ zIndex: 9999 }}>
          <div className="modal-container" style={{ maxWidth: '540px', width: '92%', borderRadius: '20px', padding: '24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px', borderBottom: '1px solid #f1f5f9', paddingBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '1.6rem' }}>🔄</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, color: '#1e293b' }}>
                    Confirm Room Shift
                  </h3>
                  <p style={{ margin: 0, fontSize: '0.82rem', color: '#64748b' }}>
                    Same room type shift • Tariff remains unchanged
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setTransferConfirmData(null)}
                disabled={isTransferring}
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
              <div style={{ fontSize: '1.8rem', color: '#7c3aed', textAlign: 'center', fontWeight: 900 }}>
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

            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '12px 14px', marginBottom: '22px', fontSize: '0.82rem', color: '#475569', lineHeight: 1.5 }}>
              <div>💰 <strong>Tariff:</strong> {formatCurrency(transferConfirmData.sourceRoom.price || 0)} / 24 hrs (Unchanged)</div>
              <div style={{ marginTop: '4px' }}>📋 Active booking, folio charges, food &amp; beverage room service tabs, and visitors will move automatically to <strong>Room #{transferConfirmData.targetRoom.room_number}</strong>.</div>
              <div style={{ marginTop: '4px' }}>🧹 <strong>Room #{transferConfirmData.sourceRoom.room_number}</strong> will be marked as <em>Needs Cleaning</em>.</div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                className="btn-secondary"
                disabled={isTransferring}
                onClick={() => setTransferConfirmData(null)}
                style={{ padding: '8px 18px', borderRadius: '12px' }}
              >
                Cancel
              </button>
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
    </section>
  );
}
