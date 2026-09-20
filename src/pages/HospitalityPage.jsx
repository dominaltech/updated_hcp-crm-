import React, { useState } from 'react';
import { useHospitality } from '../context/HospitalityContext';
import { useApp } from '../context/AppContext';
import RoomCard from '../components/hospitality/RoomCard';
import RoomContextMenu from '../components/hospitality/RoomContextMenu';
import RoomCleaningModal from '../components/hospitality/RoomCleaningModal';
import HospitalityHistory from '../components/hospitality/HospitalityHistory';
import { formatCurrency } from '../utils/formatters';

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
  const { showToast, setActivePanel, previousPanel, goBackPanel } = useApp();

  const [hoveredLinkedGroup, setHoveredLinkedGroup] = useState('');
  const [cleaningModalRoom, setCleaningModalRoom] = useState(null);

  const filteredRooms = rooms.filter((room) => {
    if (activeFilter === 'all') return true;
    return room.status === activeFilter;
  });

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

  const filterTabs = [
    { key: 'all', label: 'All Rooms', count: totalCount },
    { key: 'ready', label: 'Ready (Check-In)', count: readyCount },
    { key: 'occupied', label: 'Occupied', count: occupiedCount },
    { key: 'needs_cleaning', label: 'Needs Cleaning', count: cleaningCount },
    { key: 'maintenance', label: 'Maintenance', count: maintenanceCount }
  ];

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
          {/* Toolbar */}
          <div className="section-toolbar">
            <div className="toolbar-title">
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
                <h2>Rooms</h2>
              </div>
            </div>

            <div className="filter-group">
              {filterTabs.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  className={`filter-chip ${activeFilter === f.key ? 'active' : ''}`}
                  onClick={() => setActiveFilter(f.key)}
                >
                  <span>{f.label}</span>
                  <span className="filter-chip-count">{f.count}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Rooms Grid */}
          <div className="rooms-grid" id="rooms-grid-container">
            {filteredRooms.length === 0 ? (
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
            ) : (
              filteredRooms.map((room) => {
                const isGroupHovered =
                  hoveredLinkedGroup &&
                  hoveredLinkedGroup.split(',').map((s) => s.trim()).includes(String(room.room_number));

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
                  />
                );
              })
            )}
          </div>
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
              {formatCurrency(totalTariff)}/nt • 👥 Max {totalCap} Adults
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
