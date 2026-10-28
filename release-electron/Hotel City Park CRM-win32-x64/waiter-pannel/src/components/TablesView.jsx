import React, { useState } from 'react';

export default function TablesView({
  tables,
  department,
  currentUser,
  onSelectTable,
  isLoading,
  showToast
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
          <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
            <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: 'var(--apple-green)' }} /> Vacant
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
            <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: 'var(--apple-orange)' }} /> Mine
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
            <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#94a3b8' }} /> Locked 🔒
          </span>
        </div>
      </div>

      {/* Tables Grid */}
      {isLoading && tables.length === 0 ? (
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
            const isOccupied = t.status === 'occupied' || hasCart || t.status === 'running';
            const isBilled = t.status === 'billed';

            const isManagerOrCaptain = 
              currentUser?.role === 'manager' || 
              currentUser?.role === 'admin' || 
              currentUser?.role === 'restaurant' ||
              String(currentUser?.username || '').toLowerCase().includes('cap') ||
              String(currentUser?.username || '').toLowerCase().includes('admin');

            const isMyTable = isOccupied && (
              (t.waiter_id && t.waiter_id === currentUser?.id) ||
              (t.waiter_name && (
                String(t.waiter_name).toLowerCase() === String(currentUser?.full_name || '').toLowerCase() ||
                String(t.waiter_name).toLowerCase() === String(currentUser?.username || '').toLowerCase()
              ))
            );

            const isLockedByOther = isOccupied && !isMyTable && !isManagerOrCaptain;
            const isCaptainAssist = isOccupied && !isMyTable && isManagerOrCaptain;

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
            } else if (isLockedByOther) {
              cardBg = 'rgba(148, 163, 184, 0.12)';
              borderColor = 'rgba(148, 163, 184, 0.45)';
              statusText = `🔒 ${t.waiter_name || 'LOCKED'}`;
              badgeBg = 'rgba(148, 163, 184, 0.25)';
              badgeColor = '#475569';
              badgeBorder = '#94a3b8';
            } else if (isCaptainAssist) {
              cardBg = 'var(--apple-blue-subtle)';
              borderColor = 'var(--apple-blue)';
              statusText = `🛡️ ${t.waiter_name || 'ASSIST'}`;
              badgeBg = 'var(--apple-blue-subtle)';
              badgeColor = 'var(--apple-blue)';
              badgeBorder = 'var(--apple-blue)';
            } else if (isOccupied) {
              cardBg = 'var(--apple-blue-subtle)';
              borderColor = 'var(--apple-blue)';
              statusText = t.waiter_name ? t.waiter_name : 'OCCUPIED';
              badgeBg = 'var(--apple-blue-subtle)';
              badgeColor = 'var(--apple-blue)';
              badgeBorder = 'var(--apple-blue)';
            }

            let parsedItems = t.cart || [];
            if ((!parsedItems || parsedItems.length === 0) && t.active_cart_json) {
              try { parsedItems = typeof t.active_cart_json === 'string' ? JSON.parse(t.active_cart_json) : t.active_cart_json; } catch (_) {}
            }
            const billTotal = t.total_amount || t.cart_total || (Array.isArray(parsedItems) ? parsedItems.reduce((s, it) => s + ((Number(it.price) || 0) * (Number(it.qty || it.quantity) || 1)), 0) : 0);

            const handleCardClick = () => {
              if (isLockedByOther) {
                const label = t.table_number || `Table ${t.id}`;
                const toastMsg = `🔒 ${label} is attended by ${t.waiter_name || 'another waiter'}. You cannot take orders or modify it.`;
                if (typeof showToast === 'function') {
                  showToast(toastMsg, 4000);
                }
                return;
              }
              onSelectTable(t);
            };

            return (
              <button
                key={t.id}
                type="button"
                id={`table-card-${t.id}`}
                onClick={handleCardClick}
                style={{
                  background: cardBg,
                  border: isLockedByOther ? `1.5px dashed ${borderColor}` : `1.5px solid ${borderColor}`,
                  borderRadius: 'var(--radius-md)',
                  padding: '14px 10px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  textAlign: 'center',
                  boxShadow: 'var(--shadow-subtle)',
                  cursor: isLockedByOther ? 'not-allowed' : 'pointer',
                  opacity: isLockedByOther ? 0.82 : 1,
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
                        color: isLockedByOther ? '#64748b' : 'var(--text-primary)',
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

                {/* Bill Amount or Table Type / Waiter Subtitle */}
                {isLockedByOther ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.68rem', color: '#64748b', fontWeight: 800 }}>
                      Attended by {t.waiter_name || 'Staff'}
                    </span>
                    {billTotal > 0 && (
                      <span style={{ fontSize: '0.78rem', fontWeight: 800, color: '#94a3b8', marginTop: '2px' }}>
                        ₹{Number(billTotal).toLocaleString('en-IN')}
                      </span>
                    )}
                  </div>
                ) : isCaptainAssist ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.68rem', color: 'var(--apple-blue)', fontWeight: 800 }}>
                      🛡️ {t.waiter_name || 'Staff'} (Assist)
                    </span>
                    {billTotal > 0 && (
                      <span style={{ fontSize: '0.86rem', fontWeight: 900, color: 'var(--apple-orange)', marginTop: '2px' }}>
                        ₹{Number(billTotal).toLocaleString('en-IN')}
                      </span>
                    )}
                  </div>
                ) : isOccupied && billTotal > 0 ? (
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
