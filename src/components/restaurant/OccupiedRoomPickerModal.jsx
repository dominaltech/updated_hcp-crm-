import React, { useState, useMemo } from 'react';
import { formatCurrency, formatDateTime } from '../../utils/formatters';

export default function OccupiedRoomPickerModal({
  isOpen,
  onClose,
  occupiedRooms = [],
  selectedRoomId = '',
  onSelectRoom,
  tableName = '',
  billAmount = 0
}) {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredRooms = useMemo(() => {
    if (!searchTerm.trim()) return occupiedRooms;
    const q = searchTerm.toLowerCase().trim();
    return occupiedRooms.filter((r) => {
      const rNum = String(r.room_number || '').toLowerCase();
      const rType = String(r.room_type || '').toLowerCase();
      const gName = String(r.guest_name || r.customer_name || r.name || '').toLowerCase();
      const gMobile = String(r.guest_mobile || r.mobile || r.phone || '').toLowerCase();
      return rNum.includes(q) || rType.includes(q) || gName.includes(q) || gMobile.includes(q);
    });
  }, [occupiedRooms, searchTerm]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="room-picker-title"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.72)',
        backdropFilter: 'blur(6px)',
        zIndex: 1200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        animation: 'fadeIn 0.15s ease-out'
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: 'var(--bg-surface, #ffffff)',
          color: 'var(--text-primary, #0f172a)',
          width: '100%',
          maxWidth: '680px',
          maxHeight: '90vh',
          borderRadius: '20px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.35), 0 0 0 1px rgba(255, 255, 255, 0.1)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          border: '1.5px solid var(--border-color, #cbd5e1)'
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '20px 24px',
            borderBottom: '1px solid var(--border-color, #e2e8f0)',
            background: 'linear-gradient(135deg, rgba(37, 99, 235, 0.08) 0%, rgba(59, 130, 246, 0.02) 100%)',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '16px'
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '1.5rem' }}>🏨</span>
              <h3
                id="room-picker-title"
                style={{
                  margin: 0,
                  fontSize: '1.28rem',
                  fontWeight: 900,
                  color: 'var(--text-primary, #0f172a)',
                  letterSpacing: '-0.01em'
                }}
              >
                Select In-House Guest Room
              </h3>
            </div>
            <p
              style={{
                margin: '4px 0 0 34px',
                fontSize: '0.88rem',
                color: 'var(--text-secondary, #64748b)',
                fontWeight: 600
              }}
            >
              Link and settle {tableName ? `bill for ${tableName}` : 'dining bill'} {billAmount > 0 ? `(${formatCurrency(billAmount)})` : ''} to guest folio
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              fontSize: '1.4rem',
              color: 'var(--text-secondary, #64748b)',
              padding: '4px 8px',
              borderRadius: '8px',
              lineHeight: 1
            }}
          >
            ✕
          </button>
        </div>

        {/* Search Bar */}
        <div style={{ padding: '16px 24px 10px', background: 'var(--bg-surface, #ffffff)' }}>
          <div style={{ position: 'relative' }}>
            <span
              style={{
                position: 'absolute',
                left: '14px',
                top: '50%',
                transform: 'translateY(-50%)',
                fontSize: '1rem',
                color: '#64748b',
                pointerEvents: 'none'
              }}
            >
              🔍
            </span>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by Room #, Guest Name, or Mobile Number..."
              autoFocus
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '11px 16px 11px 40px',
                borderRadius: '12px',
                border: '1.5px solid var(--border-color, #cbd5e1)',
                fontSize: '0.94rem',
                fontWeight: 600,
                outline: 'none',
                background: 'var(--bg-surface-secondary, #f8fafc)',
                color: 'var(--text-primary, #0f172a)',
                transition: 'border-color 0.15s ease'
              }}
              onFocus={(e) => { e.target.style.borderColor = '#2563eb'; }}
              onBlur={(e) => { e.target.style.borderColor = 'var(--border-color, #cbd5e1)'; }}
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                style={{
                  position: 'absolute',
                  right: '12px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: '#e2e8f0',
                  border: 'none',
                  borderRadius: '50%',
                  width: '20px',
                  height: '20px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.75rem',
                  cursor: 'pointer',
                  color: '#475569'
                }}
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Room List Content */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '10px 24px 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px'
          }}
        >
          {occupiedRooms.length === 0 ? (
            <div
              style={{
                padding: '36px 20px',
                textAlign: 'center',
                background: 'rgba(239, 68, 68, 0.05)',
                border: '1.5px dashed rgba(239, 68, 68, 0.3)',
                borderRadius: '14px',
                color: '#b91c1c'
              }}
            >
              <div style={{ fontSize: '2.4rem', marginBottom: '8px' }}>⚠️</div>
              <h4 style={{ margin: '0 0 6px', fontSize: '1.05rem', fontWeight: 800 }}>No In-House Rooms Occupied</h4>
              <p style={{ margin: 0, fontSize: '0.88rem', color: '#64748b' }}>
                There are currently no guests checked in to any room. Please check in a guest in the Hospitality section first.
              </p>
            </div>
          ) : filteredRooms.length === 0 ? (
            <div
              style={{
                padding: '32px 20px',
                textAlign: 'center',
                color: 'var(--text-secondary, #64748b)'
              }}
            >
              <p style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 4px' }}>
                No rooms match "{searchTerm}"
              </p>
              <p style={{ fontSize: '0.85rem', margin: 0 }}>Try searching with a different room number, guest name, or mobile number.</p>
            </div>
          ) : (
            filteredRooms.map((room) => {
              const isSelected = String(room.id) === String(selectedRoomId) || String(room.room_number) === String(selectedRoomId);
              const guestName = room.guest_name || room.customer_name || room.name || 'In-House Guest';
              const guestMobile = room.guest_mobile || room.mobile || room.phone || 'N/A';
              const checkinDisplay = room.checkin_time ? formatDateTime(room.checkin_time) : 'Active Stay';

              return (
                <div
                  key={room.id || room.room_number}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    onSelectRoom(room);
                    onClose();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelectRoom(room);
                      onClose();
                    }
                  }}
                  style={{
                    padding: '14px 18px',
                    borderRadius: '14px',
                    border: isSelected
                      ? '2.5px solid #2563eb'
                      : '1.5px solid var(--border-color, #e2e8f0)',
                    background: isSelected
                      ? 'rgba(37, 99, 235, 0.08)'
                      : 'var(--bg-surface, #ffffff)',
                    boxShadow: isSelected
                      ? '0 4px 14px rgba(37, 99, 235, 0.15)'
                      : '0 2px 6px rgba(0, 0, 0, 0.03)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '16px',
                    transition: 'all 0.15s ease'
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.borderColor = '#93c5fd';
                      e.currentTarget.style.background = 'rgba(239, 246, 255, 0.6)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.borderColor = 'var(--border-color, #e2e8f0)';
                      e.currentTarget.style.background = 'var(--bg-surface, #ffffff)';
                    }
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flex: 1, minWidth: 0 }}>
                    {/* Room Badge */}
                    <div
                      style={{
                        minWidth: '82px',
                        padding: '8px 10px',
                        borderRadius: '10px',
                        background: isSelected ? '#2563eb' : '#0f172a',
                        color: '#ffffff',
                        textAlign: 'center',
                        flexShrink: 0
                      }}
                    >
                      <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.85, fontWeight: 700 }}>
                        ROOM
                      </div>
                      <div style={{ fontSize: '1.18rem', fontWeight: 900, lineHeight: 1.1 }}>
                        #{room.room_number}
                      </div>
                      {room.room_type && (
                        <div style={{ fontSize: '0.68rem', marginTop: '2px', opacity: 0.9, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {room.room_type}
                        </div>
                      )}
                    </div>

                    {/* Guest Details: Name, Mobile, Check-in Date */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span
                          style={{
                            fontSize: '1.02rem',
                            fontWeight: 900,
                            color: 'var(--text-primary, #0f172a)'
                          }}
                        >
                          👤 {guestName}
                        </span>
                        {isSelected && (
                          <span
                            style={{
                              fontSize: '0.72rem',
                              fontWeight: 800,
                              color: '#16a34a',
                              background: '#dcfce7',
                              padding: '2px 8px',
                              borderRadius: '6px'
                            }}
                          >
                            ✓ CURRENTLY SELECTED
                          </span>
                        )}
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '16px',
                          marginTop: '4px',
                          flexWrap: 'wrap',
                          fontSize: '0.86rem',
                          color: 'var(--text-secondary, #475569)'
                        }}
                      >
                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 700, color: '#1e293b' }}>
                          <span>📞</span> {guestMobile}
                        </span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}>
                          <span>📅</span> Check-in: <strong>{checkinDisplay}</strong>
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Action Button */}
                  <div style={{ flexShrink: 0 }}>
                    <button
                      type="button"
                      style={{
                        padding: '8px 16px',
                        borderRadius: '10px',
                        border: 'none',
                        background: isSelected ? '#16a34a' : '#2563eb',
                        color: '#ffffff',
                        fontSize: '0.88rem',
                        fontWeight: 850,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        boxShadow: '0 2px 6px rgba(0, 0, 0, 0.1)'
                      }}
                    >
                      {isSelected ? 'Selected ✓' : 'Select Room →'}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '14px 24px',
            borderTop: '1px solid var(--border-color, #e2e8f0)',
            background: 'var(--bg-surface-secondary, #f8fafc)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '0.86rem',
            color: 'var(--text-secondary, #64748b)'
          }}
        >
          <span>
            Showing <strong>{filteredRooms.length}</strong> of <strong>{occupiedRooms.length}</strong> Occupied Rooms
          </span>
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            style={{
              padding: '8px 20px',
              fontSize: '0.9rem',
              fontWeight: 800,
              borderRadius: '10px'
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
