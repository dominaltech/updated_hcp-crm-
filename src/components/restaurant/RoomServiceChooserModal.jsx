import React, { useState, useEffect, useMemo } from 'react';

export default function RoomServiceChooserModal({
  isOpen,
  onClose,
  occupiedRooms = [],
  activeRSTables = [],
  onSelectRoom
}) {
  const [searchQuery, setSearchQuery] = useState('');

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Reset search when modal opens
  useEffect(() => {
    if (isOpen) {
      setSearchQuery('');
    }
  }, [isOpen]);

  // Map active room service tables by room number / id
  const activeMap = useMemo(() => {
    const map = new Map();
    activeRSTables.forEach((t) => {
      const rNum = String(t.table_number || '').replace(/^RS-/i, '').trim();
      if (rNum) map.set(rNum, t);
      if (t.room_id) map.set(String(t.room_id), t);
    });
    return map;
  }, [activeRSTables]);

  // Filter occupied rooms based on search query
  const filteredRooms = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return occupiedRooms;
    return occupiedRooms.filter((r) => {
      const numMatch = String(r.room_number || '').toLowerCase().includes(q);
      const nameMatch = String(r.guest_name || '').toLowerCase().includes(q);
      const mobileMatch = String(r.guest_mobile || r.mobile || '').includes(q);
      const typeMatch = String(r.room_type || '').toLowerCase().includes(q);
      return numMatch || nameMatch || mobileMatch || typeMatch;
    });
  }, [occupiedRooms, searchQuery]);

  if (!isOpen) return null;

  return (
    <div
      className="modal-backdrop-fixed"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10050,
        background: 'rgba(15, 23, 42, 0.8)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'stretch',
        justifyContent: 'stretch',
        padding: 0
      }}
      onClick={onClose}
    >
      <div
        className="modal-card modal-container"
        style={{
          width: '100vw',
          height: '100vh',
          maxWidth: '100vw',
          maxHeight: '100vh',
          background: 'var(--bg-app, #f8fafc)',
          display: 'flex',
          flexDirection: 'column',
          padding: '20px 36px',
          borderRadius: 0,
          boxShadow: 'none',
          border: 'none',
          position: 'relative',
          zIndex: 10051,
          overflow: 'hidden'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Full-Screen Modal Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '16px',
            paddingBottom: '16px',
            borderBottom: '1.5px solid var(--border-color, #e2e8f0)',
            flexShrink: 0,
            gap: '16px',
            flexWrap: 'wrap'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '14px',
                background: 'var(--bg-surface-secondary, #eff6ff)',
                border: '1.5px solid var(--border-color, #bfdbfe)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1.6rem',
                boxShadow: '0 4px 12px rgba(0, 113, 227, 0.12)'
              }}
            >
              🛎️
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <h3 style={{ margin: 0, fontSize: '1.45rem', fontWeight: 900, color: 'var(--text-primary, #0f172a)', letterSpacing: '-0.02em' }}>
                  Room Service • Select Occupied Room
                </h3>
                <span
                  style={{
                    background: 'rgba(2, 132, 199, 0.15)',
                    color: 'var(--apple-blue, #0369a1)',
                    fontSize: '0.78rem',
                    fontWeight: 800,
                    padding: '3px 10px',
                    borderRadius: '20px',
                    border: '1px solid rgba(2, 132, 199, 0.3)'
                  }}
                >
                  {occupiedRooms.length} Occupied Rooms
                </span>
              </div>
              <p style={{ margin: '4px 0 0 0', fontSize: '0.88rem', color: 'var(--text-secondary, #64748b)' }}>
                Select an occupied guest room to start or resume food &amp; beverage service order.
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {/* Quick Search Bar */}
            <div style={{ position: 'relative', width: '280px' }}>
              <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary, #94a3b8)', fontSize: '0.95rem' }}>
                🔍
              </span>
              <input
                type="text"
                placeholder="Search room # or guest..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  width: '100%',
                  padding: '9px 12px 9px 36px',
                  borderRadius: '12px',
                  border: '1.5px solid var(--border-color, #cbd5e1)',
                  fontSize: '0.88rem',
                  outline: 'none',
                  background: 'var(--bg-surface, #f8fafc)',
                  color: 'var(--text-primary)',
                  fontWeight: 650
                }}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  style={{
                    position: 'absolute',
                    right: '10px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-secondary, #94a3b8)',
                    cursor: 'pointer',
                    fontSize: '0.9rem'
                  }}
                >
                  ✕
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={onClose}
              style={{
                background: 'var(--bg-surface, #ffffff)',
                border: '1.5px solid var(--border-color, #cbd5e1)',
                borderRadius: '12px',
                padding: '8px 16px',
                cursor: 'pointer',
                fontSize: '0.86rem',
                fontWeight: 800,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                color: 'var(--text-primary, #334155)',
                boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                transition: 'all 0.15s ease'
              }}
              title="Close (Esc)"
            >
              <span style={{ fontSize: '0.95rem' }}>✕</span>
              <span>Back to Floor</span>
            </button>
          </div>
        </div>

        {/* Spacious Rooms Grid */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '4px 6px 16px 2px' }}>
          {occupiedRooms.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '64px 20px', background: 'var(--bg-surface-secondary, #f8fafc)', borderRadius: '18px', border: '2px dashed var(--border-color, #cbd5e1)', marginTop: '20px' }}>
              <div style={{ fontSize: '3rem', marginBottom: '12px' }}>🏨</div>
              <h4 style={{ margin: 0, color: 'var(--text-primary, #0f172a)', fontSize: '1.2rem', fontWeight: 800 }}>No Occupied Rooms Available</h4>
              <p style={{ color: 'var(--text-secondary, #64748b)', fontSize: '0.92rem', marginTop: '8px', maxWidth: '440px', marginInline: 'auto' }}>
                There are currently no guests checked into the hotel. Check in guests from the Front Desk / Hospitality tab first.
              </p>
            </div>
          ) : filteredRooms.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 20px', background: 'var(--bg-surface-secondary, #f8fafc)', borderRadius: '18px', border: '2px dashed var(--border-color, #cbd5e1)' }}>
              <div style={{ fontSize: '2.4rem', marginBottom: '10px' }}>🔍</div>
              <h4 style={{ margin: 0, color: 'var(--text-primary, #0f172a)', fontSize: '1.1rem', fontWeight: 800 }}>No rooms match "{searchQuery}"</h4>
              <p style={{ color: 'var(--text-secondary, #64748b)', fontSize: '0.88rem', marginTop: '6px' }}>
                Try searching by a different room number or guest name.
              </p>
            </div>
          ) : (
            <div
              className="rooms-grid"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))',
                gap: '18px'
              }}
            >
              {filteredRooms.map((room) => {
                const activeOrder = activeMap.get(String(room.room_number)) || activeMap.get(String(room.id));
                const mobileNum = (room.guest_mobile || room.mobile || '').trim();

                return (
                  <div
                    key={room.id}
                    className="room-card status-occupied"
                    style={{
                      cursor: 'pointer',
                      border: activeOrder ? '2.5px solid var(--apple-blue, #0071e3)' : '2px solid var(--border-color, #e2e8f0)',
                      background: activeOrder ? 'var(--bg-surface-secondary, #f0f7ff)' : 'var(--bg-surface, #ffffff)',
                      borderRadius: '16px',
                      padding: '18px 20px',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'stretch',
                      textAlign: 'left',
                      gap: '10px',
                      minHeight: '150px',
                      position: 'relative',
                      boxShadow: activeOrder ? '0 8px 24px rgba(0, 113, 227, 0.16)' : '0 2px 10px rgba(0, 0, 0, 0.04)',
                      transition: 'all 0.18s cubic-bezier(0.16, 1, 0.3, 1)'
                    }}
                    onClick={() => {
                      onSelectRoom(room, activeOrder);
                      onClose();
                    }}
                    title={`Click to order room service for Room #${room.room_number}`}
                  >
                    {/* Top Row: Room Number + Status Badges */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                        <span style={{ fontSize: '2.2rem', fontWeight: 950, lineHeight: 1, color: 'var(--text-primary, #0f172a)', letterSpacing: '-0.03em' }}>
                          {room.room_number}
                        </span>
                        <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary, #64748b)' }}>
                          {room.room_type || 'Room'}
                        </span>
                      </div>

                      {activeOrder ? (
                        <div
                          style={{
                            background: activeOrder.status === 'ready' ? '#10b981' : '#f59e0b',
                            color: '#ffffff',
                            fontSize: '0.72rem',
                            fontWeight: 850,
                            padding: '3px 9px',
                            borderRadius: '20px',
                            boxShadow: '0 2px 6px rgba(245, 158, 11, 0.3)',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}
                        >
                          <span>🛎️</span>
                          <span>{activeOrder.status === 'ready' ? 'READY' : 'IN PROCESS'}</span>
                        </div>
                      ) : (
                        <div
                          style={{
                            background: 'rgba(2, 132, 199, 0.15)',
                            color: 'var(--apple-blue, #1d4ed8)',
                            fontSize: '0.72rem',
                            fontWeight: 800,
                            padding: '3px 9px',
                            borderRadius: '20px',
                            border: '1px solid rgba(2, 132, 199, 0.3)'
                          }}
                        >
                          OCCUPIED
                        </div>
                      )}
                    </div>

                    {/* Guest Information */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '2px' }}>
                      {room.guest_name ? (
                        <div
                          style={{
                            fontSize: '0.92rem',
                            fontWeight: 800,
                            color: 'var(--text-primary, #1e293b)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis'
                          }}
                          title={room.guest_name}
                        >
                          <span style={{ color: 'var(--apple-blue, #0071e3)', fontSize: '0.95rem' }}>👤</span>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{room.guest_name}</span>
                        </div>
                      ) : (
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary, #94a3b8)', fontStyle: 'italic' }}>
                          👤 Guest In-House
                        </div>
                      )}

                      {mobileNum && (
                        <div
                          style={{
                            fontSize: '0.80rem',
                            fontWeight: 700,
                            color: 'var(--text-secondary, #475569)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px'
                          }}
                        >
                          <span style={{ color: '#16a34a' }}>📞</span>
                          <span>{mobileNum}</span>
                        </div>
                      )}
                    </div>

                    {/* Bottom Order Status & Action CTA */}
                    <div
                      style={{
                        marginTop: 'auto',
                        paddingTop: '8px',
                        borderTop: '1px dashed var(--border-color, #e2e8f0)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                      }}
                    >
                      {activeOrder && activeOrder.cart_total > 0 ? (
                        <div style={{ fontSize: '0.92rem', fontWeight: 900, color: 'var(--apple-blue, #0071e3)' }}>
                          Running Bill: ₹{activeOrder.cart_total.toLocaleString('en-IN')}
                        </div>
                      ) : (
                        <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary, #64748b)', fontWeight: 650 }}>
                          No food order yet
                        </span>
                      )}

                      <span
                        style={{
                          fontSize: '0.82rem',
                          fontWeight: 850,
                          color: 'var(--apple-blue, #0071e3)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px'
                        }}
                      >
                        {activeOrder ? 'Open Order →' : 'Take Order +'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
