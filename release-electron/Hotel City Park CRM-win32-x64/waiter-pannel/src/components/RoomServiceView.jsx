import React, { useState } from 'react';

export default function RoomServiceView({
  rooms,
  onSelectRoom,
  isLoading
}) {
  const [searchTerm, setSearchTerm] = useState('');

  const filtered = rooms.filter(r => {
    const q = searchTerm.toLowerCase();
    const roomNum = (r.room_number || '').toLowerCase();
    const guestName = (r.guest_name || '').toLowerCase();
    const phone = (r.guest_phone || r.guest_mobile || '').toLowerCase();
    return roomNum.includes(q) || guestName.includes(q) || phone.includes(q);
  });

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '12px', background: 'var(--bg-app)' }}>
      {/* Search Bar */}
      <div style={{ position: 'relative', marginBottom: '12px' }}>
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search occupied room, guest name, or mobile..."
          style={{
            width: '100%',
            height: '40px',
            padding: '0 12px 0 34px',
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-medium)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--text-primary)',
            fontSize: '0.86rem',
            outline: 'none',
            boxShadow: 'var(--shadow-subtle)'
          }}
        />
        <span style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', opacity: 0.5, fontSize: '0.9rem' }}>
          🔍
        </span>
      </div>

      {/* Header Info */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <span style={{ fontSize: '0.78rem', fontWeight: 800, color: 'var(--text-primary)' }}>
          🛏️ Live Occupied Hotel Rooms ({rooms.length})
        </span>
        <span style={{ fontSize: '0.70rem', color: 'var(--text-secondary)' }}>
          Tap room to take order
        </span>
      </div>

      {/* Rooms List */}
      {isLoading && rooms.length === 0 ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>
          <span>⏳ Loading occupied rooms &amp; guests...</span>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)', gap: '6px' }}>
          <span style={{ fontSize: '2rem' }}>🛏️</span>
          <span>No occupied rooms found</span>
        </div>
      ) : (
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            paddingBottom: '80px'
          }}
        >
          {filtered.map((room) => {
            const guestDisplayName = (room.guest_name && room.guest_name.trim()) ? room.guest_name.trim() : 'In-House Guest';
            const rawPhone = room.guest_phone || room.guest_mobile || room.mobile;
            const guestDisplayPhone = (rawPhone && rawPhone !== '—' && rawPhone.trim()) ? rawPhone.trim() : null;

            return (
              <button
                key={room.room_number || room.id}
                type="button"
                id={`room-card-${room.room_number || room.id}`}
                onClick={() => onSelectRoom(room)}
                style={{
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-medium)',
                  borderRadius: 'var(--radius-md)',
                  padding: '12px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  textAlign: 'left',
                  boxShadow: 'var(--shadow-subtle)',
                  cursor: 'pointer',
                  transition: 'all var(--transition-fast)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  {/* Room Number Badge */}
                  <div
                    style={{
                      width: '48px',
                      height: '48px',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--apple-blue)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--text-on-accent)',
                      flexShrink: 0,
                      boxShadow: 'var(--shadow-subtle)'
                    }}
                  >
                    <span style={{ fontSize: '0.60rem', fontWeight: 700, textTransform: 'uppercase' }}>ROOM</span>
                    <span style={{ fontSize: '1.15rem', fontWeight: 900, lineHeight: 1 }}>{room.room_number}</span>
                  </div>

                  {/* Guest Details */}
                  <div>
                    <div style={{ fontSize: '0.96rem', fontWeight: 850, color: 'var(--text-primary)', marginBottom: '2px' }}>
                      {guestDisplayName}
                    </div>
                    <div style={{ fontSize: '0.78rem', color: guestDisplayPhone ? 'var(--apple-blue)' : 'var(--text-tertiary)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span>📞</span>
                      <span>{guestDisplayPhone || 'Mobile Not Stored'}</span>
                    </div>
                    <div style={{ fontSize: '0.70rem', color: 'var(--text-secondary)', marginTop: '1px' }}>
                      {room.room_type || 'Standard Room'} • Floor {room.floor || '1'}
                    </div>
                  </div>
                </div>

              {/* Action Chevron */}
              <div
                style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '50%',
                  background: 'var(--bg-surface-secondary)',
                  border: '1px solid var(--border-light)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--apple-blue)',
                  fontSize: '0.90rem'
                }}
              >
                ➔
              </div>
            </button>
          );
        })}
      </div>
      )}
    </div>
  );
}
