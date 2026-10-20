import React, { useState } from 'react';

export default function TablesView({
  tables,
  department,
  currentUser,
  onSelectTable,
  isLoading
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const isBar = department === 'bar';

  const isRoomService = (t) => {
    const num = String(t.table_number || t.name || '').toUpperCase();
    return t.table_type === 'room_service' || num.startsWith('RS-') || num.includes('ROOM');
  };
  const isParcel = (t) => {
    const num = String(t.table_number || t.name || '').toUpperCase();
    return t.table_type === 'parcel' || num.startsWith('P-');
  };

  const filtered = tables.filter(t => {
    // Room Service and Parcels belong in their respective tabs / My Orders, not the Tables grid
    if (isRoomService(t) || isParcel(t)) return false;
    const num = (t.table_number || t.name || '').toLowerCase();
    return num.includes(searchTerm.toLowerCase());
  });

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '12px', background: 'var(--bg-app)' }}>
      {/* Search & Status Summary Bar */}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '12px' }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={`Search ${isBar ? 'bar tables...' : 'restaurant tables...'}`}
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

        {/* Legend */}
        <div style={{ display: 'flex', gap: '6px', fontSize: '0.70rem', fontWeight: 800, color: 'var(--text-secondary)', flexShrink: 0 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: 'var(--apple-green)' }} /> Vacant
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: 'var(--apple-orange)' }} /> Mine
          </span>
        </div>
      </div>

      {/* Tables Grid */}
      {isLoading ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>
          <span>⏳ Loading tables...</span>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)' }}>
          <span>No tables found</span>
        </div>
      ) : (
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: '12px',
            alignContent: 'start',
            paddingBottom: '80px'
          }}
        >
          {filtered.map((t) => {
            const hasCart = (t.cart && t.cart.length > 0) || (t.running_orders && t.running_orders.length > 0);
            const isOccupied = t.status === 'occupied' || hasCart;
            const isBilled = t.status === 'billed';
            const isMyTable = isOccupied && (
              t.waiter_id === currentUser?.id ||
              t.waiter_name === currentUser?.full_name ||
              t.waiter_name === currentUser?.username
            );

            let cardBg = 'var(--bg-surface)';
            let borderColor = 'var(--border-medium)';
            let statusText = 'VACANT';
            let badgeBg = 'var(--apple-green-subtle)';
            let badgeColor = 'var(--apple-green)';
            let badgeBorder = 'var(--apple-green)';

            if (isBilled) {
              cardBg = 'var(--apple-red-subtle)';
              borderColor = 'var(--apple-red)';
              statusText = 'BILLED';
              badgeBg = 'var(--apple-red-subtle)';
              badgeColor = 'var(--apple-red)';
              badgeBorder = 'var(--apple-red)';
            } else if (isMyTable) {
              cardBg = isBar ? 'var(--apple-purple-subtle)' : 'var(--apple-orange-subtle)';
              borderColor = isBar ? 'var(--apple-purple)' : 'var(--apple-orange)';
              statusText = 'MINE';
              badgeBg = isBar ? 'var(--apple-purple-subtle)' : 'var(--apple-orange-subtle)';
              badgeColor = isBar ? 'var(--apple-purple)' : 'var(--apple-orange)';
              badgeBorder = isBar ? 'var(--apple-purple)' : 'var(--apple-orange)';
            } else if (isOccupied) {
              cardBg = 'var(--apple-blue-subtle)';
              borderColor = 'var(--apple-blue)';
              statusText = t.waiter_name ? t.waiter_name : 'OCCUPIED';
              badgeBg = 'var(--apple-blue-subtle)';
              badgeColor = 'var(--apple-blue)';
              badgeBorder = 'var(--apple-blue)';
            }

            const billTotal = t.total_amount || t.cart_total || (t.cart ? t.cart.reduce((s, it) => s + (it.price * (it.qty || 1)), 0) : 0);

            return (
              <button
                key={t.id}
                type="button"
                id={`table-card-${t.id}`}
                onClick={() => onSelectTable(t)}
                style={{
                  background: cardBg,
                  border: `1.5px solid ${borderColor}`,
                  borderRadius: 'var(--radius-md)',
                  padding: '14px 10px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  textAlign: 'center',
                  boxShadow: 'var(--shadow-subtle)',
                  cursor: 'pointer',
                  position: 'relative',
                  minHeight: '124px',
                  overflow: 'hidden',
                  transition: 'all var(--transition-fast)'
                }}
              >
                {/* Status Badge in Top-Right Corner */}
                <div style={{ position: 'absolute', top: '8px', right: '8px', zIndex: 2 }}>
                  <span
                    style={{
                      fontSize: '0.62rem',
                      fontWeight: 850,
                      color: badgeColor,
                      padding: '2px 6px',
                      borderRadius: 'var(--radius-xs)',
                      background: badgeBg,
                      border: `1px solid ${badgeBorder}`,
                      textTransform: 'uppercase',
                      letterSpacing: '0.03em',
                      whiteSpace: 'nowrap',
                      maxWidth: '90px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      display: 'inline-block'
                    }}
                  >
                    {statusText}
                  </span>
                </div>

                {/* Big Bold Table Number with auto-scaling to avoid overflow */}
                {(() => {
                  const label = t.table_number || `T${t.id}`;
                  const len = label.length;
                  const fontSize = len > 9 ? '0.95rem' : (len > 5 ? '1.35rem' : '2.1rem');
                  return (
                    <div
                      style={{
                        fontSize,
                        fontWeight: 900,
                        lineHeight: 1.15,
                        color: 'var(--text-primary)',
                        letterSpacing: len > 5 ? '-0.01em' : '-0.03em',
                        margin: '10px 0 4px',
                        maxWidth: '100%',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        wordBreak: 'break-word',
                        padding: '0 4px'
                      }}
                      title={label}
                    >
                      {label}
                    </div>
                  );
                })()}

                {/* Bill Amount or Table Type */}
                {isOccupied && billTotal > 0 ? (
                  <span style={{ fontSize: '0.86rem', fontWeight: 900, color: 'var(--apple-orange)' }}>
                    ₹{Number(billTotal).toLocaleString('en-IN')}
                  </span>
                ) : (
                  <span style={{ fontSize: '0.70rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                    {isBar ? '🍸 Bar Table' : '🍽️ Dine-In'}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
