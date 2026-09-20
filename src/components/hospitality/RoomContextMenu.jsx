import React, { useEffect, useRef } from 'react';
import { useHospitality } from '../../context/HospitalityContext';

export default function RoomContextMenu({ onOpenCheckin, onOpenFolio, onOpenVisitors, onOpenCleaningModal }) {
  const { contextMenu, closeContextMenu, updateRoomStatus } = useHospitality();
  const menuRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        closeContextMenu();
      }
    };
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') closeContextMenu();
    };

    if (contextMenu.isOpen) {
      document.addEventListener('click', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('click', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [contextMenu.isOpen, closeContextMenu]);

  if (!contextMenu.isOpen || !contextMenu.room || contextMenu.room.status === 'occupied') return null;

  const { room, x, y } = contextMenu;

  const statusLabels = {
    ready: 'Ready (Check-In)',
    occupied: 'Occupied',
    needs_cleaning: 'Needs Cleaning',
    maintenance: 'Under Construction / Maint.'
  };
  const currentStatusLabel = statusLabels[room.status] || room.status;

  return (
    <div
      ref={menuRef}
      id="room-card-context-menu"
      className="room-context-menu"
      style={{
        display: 'block',
        left: `${x}px`,
        top: `${y}px`,
        position: 'fixed',
        zIndex: 9999
      }}
    >
      <div className="room-context-menu-header">
        <span>
          Room {room.room_number} • {room.room_type}
        </span>
        <span
          style={{
            fontSize: '0.7rem',
            padding: '2px 6px',
            borderRadius: '4px',
            background: '#e2e8f0',
            color: '#334155',
            fontWeight: 800
          }}
        >
          {currentStatusLabel}
        </span>
      </div>

      <div
        className="room-context-menu-item status-ready"
        onClick={() => {
          if (room.status === 'needs_cleaning' && onOpenCleaningModal) {
            closeContextMenu();
            onOpenCleaningModal(room);
          } else {
            updateRoomStatus(room.id, 'ready');
          }
        }}
      >
        <span style={{ fontSize: '1.15rem' }}>✨</span>
        <div>
          <div>Cleaning Completed (Ready)</div>
          <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 500 }}>
            Mark ready for new guest check-in
          </div>
        </div>
      </div>

      <div
        className="room-context-menu-item status-cleaning"
        onClick={() => updateRoomStatus(room.id, 'needs_cleaning')}
      >
        <span style={{ fontSize: '1.15rem' }}>🧹</span>
        <div>
          <div>Needs Cleaning</div>
          <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 500 }}>
            Assign to housekeeping staff
          </div>
        </div>
      </div>

      <div
        className="room-context-menu-item status-maint"
        onClick={() => updateRoomStatus(room.id, 'maintenance')}
      >
        <span style={{ fontSize: '1.15rem' }}>🛠️</span>
        <div>
          <div>Under Construction / Maintenance</div>
          <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 500 }}>
            Block room for repairs / painting
          </div>
        </div>
      </div>

      {room.status === 'occupied' && (
        <>
          <div className="room-context-menu-divider" />
          <div
            className="room-context-menu-item"
            onClick={() => {
              closeContextMenu();
              if (onOpenVisitors) onOpenVisitors(room);
            }}
          >
            <span style={{ fontSize: '1.15rem' }}>👥</span>
            <div>
              <div>Log / Manage Visitors</div>
              <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 500 }}>
                Take photo, crop &amp; register visitor
              </div>
            </div>
          </div>
          <div
            className="room-context-menu-item"
            onClick={() => {
              closeContextMenu();
              if (onOpenFolio) onOpenFolio(room);
            }}
          >
            <span style={{ fontSize: '1.15rem' }}>📋</span>
            <div>
              <div>View Room Folio &amp; Checkout</div>
              <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 500 }}>
                Guest: {room.guest_name || 'Active Guest'}
              </div>
            </div>
          </div>
        </>
      )}

      {room.status === 'ready' && (
        <>
          <div className="room-context-menu-divider" />
          <div
            className="room-context-menu-item"
            onClick={() => {
              closeContextMenu();
              if (onOpenCheckin) onOpenCheckin(room);
            }}
          >
            <span style={{ fontSize: '1.15rem' }}>🏨</span>
            <div>
              <div>Start Guest Check-In</div>
              <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 500 }}>
                Open check-in wizard
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
